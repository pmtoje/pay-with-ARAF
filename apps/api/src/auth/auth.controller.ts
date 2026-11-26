import { effectivePortalSettings } from '@araf/types';
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query, Res } from '@nestjs/common';
import { signArafRequest } from '@araf/integrations';
import type { Response } from 'express';
import { z } from 'zod';
import { generateTotpSecret, hashPassword, passwordPolicyErrors, randomToken, safeEqual, totpUri, verifyPassword, verifyTotp } from '@araf/security';
import { CONFIG, type AppConfig } from '../config';
import { AppError, fail } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService, RateLimitService } from '../common/core.services';
import { Ctx, Public, PortalSession, SESSION_COOKIES, type AuthedRequest, type PortalName } from './auth.guard';

const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).strict();
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const acceptSchema = z.object({ password: z.string().min(12).max(128) }).strict();

const SESSION_ABSOLUTE_MS = 8 * 3600_000;
const LOCK_THRESHOLD = 5;
const LOCK_MS = 15 * 60_000;

export const csrfCookieName = (portal: PortalName) => `araf_csrf_${portal.toLowerCase()}`;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  cookieOptions(httpOnly = true) {
    return { httpOnly, secure: this.config.COOKIE_SECURE, sameSite: 'strict' as const, path: '/', maxAge: SESSION_ABSOLUTE_MS };
  }

  private async issueSession(res: Response, portal: PortalName, userId: string, mfaVerified: boolean, req: AuthedRequest) {
    const token = randomToken('', 48);
    const csrf = randomToken('', 32);
    const session = await this.prisma.session.create({
      data: {
        userId,
        portal,
        tokenHash: this.crypto.tokenHash(token),
        csrfTokenHash: this.crypto.tokenHash(csrf),
        mfaVerified,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']?.slice(0, 300),
        expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
      },
    });
    res.cookie(SESSION_COOKIES[portal], token, this.cookieOptions());
    res.cookie(csrfCookieName(portal), csrf, this.cookieOptions(false));
    return { session, csrf };
  }

  async login(portal: PortalName, body: unknown, req: AuthedRequest, res: Response) {
    const { email, password } = loginSchema.parse(body);
    const normalized = email.toLowerCase();
    await this.rateLimit.hit(`login:ip:${req.ip}`, 30, 300);
    await this.rateLimit.hit(`login:email:${normalized}`, 10, 300);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    const expectedType = portal === 'ADMIN' ? 'STAFF' : 'PARTNER';
    // Constant work whether or not the user exists (mitigates account enumeration).
    const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    if (portal === 'ADMIN' && !this.config.staffEmailDomains.some((d) => normalized.endsWith(`@${d}`))) {
      await this.audit.record({ ...req.actor, label: normalized }, { action: 'auth.login', resourceType: 'USER', outcome: 'FAILURE', reason: 'STAFF_DOMAIN' });
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (!user || user.type !== expectedType) {
      await this.audit.record({ ...req.actor, label: normalized }, { action: 'auth.login', resourceType: 'USER', outcome: 'FAILURE', reason: 'UNKNOWN_USER_OR_PORTAL' });
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new AppError('ACCOUNT_LOCKED');
    if (!ok || user.status !== 'ACTIVE') {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failed, lockedUntil: failed >= LOCK_THRESHOLD ? new Date(Date.now() + LOCK_MS) : undefined },
      });
      await this.audit.record({ ...req.actor, id: user.id, label: user.email }, { action: 'auth.login', resourceType: 'USER', resourceId: user.id, outcome: 'FAILURE', reason: failed >= LOCK_THRESHOLD ? 'LOCKED' : 'BAD_PASSWORD' });
      throw new AppError(failed >= LOCK_THRESHOLD ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS');
    }
    const mfa = await this.prisma.mfaCredential.findFirst({ where: { userId: user.id, verifiedAt: { not: null } } });
    if (!mfa) throw new AppError('MFA_REQUIRED', undefined, 'MFA enrolment is required. Use your invitation link to enrol.');
    await this.issueSession(res, portal, user.id, false, req);
    await this.audit.record({ ...req.actor, id: user.id, label: user.email }, { action: 'auth.password_verified', resourceType: 'USER', resourceId: user.id });
    return { mfa_required: true };
  }

  async verifyMfa(portal: PortalName, body: unknown, req: AuthedRequest, res: Response) {
    const { code } = codeSchema.parse(body);
    const ctx = req.portal!;
    await this.rateLimit.hit(`mfa:${ctx.userId}`, 10, 300);
    const cred = await this.prisma.mfaCredential.findFirst({ where: { userId: ctx.userId, verifiedAt: { not: null } } });
    if (!cred) throw new AppError('MFA_REQUIRED');
    const step = verifyTotp(this.crypto.decrypt(cred.secretEncrypted, `mfa:${ctx.userId}`), code);
    // Reject codes from the same or an earlier time-step (replay protection).
    if (step === null || (cred.lastUsedStep !== null && BigInt(step) <= cred.lastUsedStep)) {
      await this.audit.record(req.actor, { action: 'auth.mfa', resourceType: 'USER', resourceId: ctx.userId, outcome: 'FAILURE' });
      throw new AppError('MFA_INVALID');
    }
    await this.prisma.mfaCredential.update({ where: { id: cred.id }, data: { lastUsedStep: BigInt(step) } });
    // Rotate the session after MFA (session fixation protection).
    await this.prisma.session.update({ where: { id: ctx.sessionId }, data: { revokedAt: new Date(), revokedReason: 'ROTATED_AFTER_MFA' } });
    const { csrf } = await this.issueSession(res, portal, ctx.userId, true, req);
    await this.prisma.user.update({ where: { id: ctx.userId }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.record(req.actor, { action: 'auth.login', resourceType: 'USER', resourceId: ctx.userId });
    return { authenticated: true, csrf_token: csrf };
  }

  // ---- Sign in with ARAF (Bank staff, @altbank.ng) ------------------------------------------
  //
  // ARAF (the AltBank Retail Asset Factory) is the identity provider: staff sign in there with
  // their @altbank.ng email and one-time code; ARAF returns a single-use code that this API
  // exchanges server-to-server (signed). Roles and permissions stay in Pay with ARAF.

  ssoConfig() {
    return { enabled: this.config.ARAF_SSO_ENABLED, provider: 'ARAF', email_domains: this.config.staffEmailDomains };
  }

  private ssoRedirectUri() {
    return `${this.config.ADMIN_PORTAL_URL.replace(/\/$/, '')}/api/auth/admin/sso/callback`;
  }

  ssoStart(res: Response) {
    if (!this.config.ARAF_SSO_ENABLED || !this.config.ARAF_BASE_URL) throw new AppError('NOT_FOUND');
    const state = randomToken('', 32);
    res.cookie('araf_sso_state', this.crypto.tokenHash(state), { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'lax', path: '/api/auth/admin/sso', maxAge: 10 * 60_000 });
    const url = new URL('/sso/pay-with-araf', this.config.ARAF_BASE_URL);
    url.searchParams.set('redirect_uri', this.ssoRedirectUri());
    url.searchParams.set('state', state);
    res.redirect(302, url.toString());
  }

  async ssoCallback(query: Record<string, string | undefined>, req: AuthedRequest, res: Response) {
    const fail = (code: string) => res.redirect(302, `${this.config.ADMIN_PORTAL_URL.replace(/\/$/, '')}/login?sso_error=${code}`);
    res.clearCookie('araf_sso_state', { path: '/api/auth/admin/sso' });
    if (!this.config.ARAF_SSO_ENABLED || !this.config.ARAF_BASE_URL || !this.config.ARAF_INTEGRATION_SECRET) return fail('DISABLED');
    const stateCookie = req.cookies?.araf_sso_state;
    const { code, state } = query;
    if (!code || !state || typeof stateCookie !== 'string' || !safeEqual(stateCookie, this.crypto.tokenHash(state))) return fail('STATE');
    await this.rateLimit.hit(`sso:ip:${req.ip}`, 30, 300);
    let identity: { email?: string; name?: string; auth_time?: number; amr?: string[] };
    try {
      const path = '/api/sso/pay-with-araf/token';
      const body = JSON.stringify({ code, redirect_uri: this.ssoRedirectUri() });
      const { timestamp, signature } = signArafRequest(this.config.ARAF_INTEGRATION_SECRET, 'POST', path, body);
      const r = await fetch(new URL(path, this.config.ARAF_BASE_URL), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PWA-Timestamp': timestamp, 'X-PWA-Signature': signature }, body, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return fail('EXCHANGE');
      identity = (await r.json()) as typeof identity;
    } catch {
      return fail('UNAVAILABLE');
    }
    const email = (identity.email ?? '').toLowerCase();
    const domainOk = this.config.staffEmailDomains.some((d) => email.endsWith(`@${d}`));
    const fresh = typeof identity.auth_time === 'number' && Date.now() / 1000 - identity.auth_time < 12 * 3600;
    const user = domainOk ? await this.prisma.user.findUnique({ where: { email } }) : null;
    if (!domainOk || !fresh || !user || user.type !== 'STAFF' || user.status !== 'ACTIVE') {
      await this.audit.record({ ...req.actor, label: email || 'unknown' }, { action: 'auth.login', resourceType: 'USER', outcome: 'FAILURE', reason: !domainOk ? 'SSO_DOMAIN' : !fresh ? 'SSO_STALE' : 'SSO_NOT_PROVISIONED' });
      return fail(!domainOk ? 'DOMAIN' : !user ? 'NOT_PROVISIONED' : 'DENIED');
    }
    // ARAF's email one-time code is the second factor for this sign-in.
    await this.issueSession(res, 'ADMIN', user.id, true, req);
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.record({ ...req.actor, id: user.id, label: user.email }, { action: 'auth.login', resourceType: 'USER', resourceId: user.id, after: { method: 'ARAF_SSO', amr: identity.amr ?? [] } });
    res.redirect(302, `${this.config.ADMIN_PORTAL_URL.replace(/\/$/, '')}/`);
  }

  async logout(portal: PortalName, req: AuthedRequest, res: Response) {
    await this.prisma.session.update({ where: { id: req.portal!.sessionId }, data: { revokedAt: new Date(), revokedReason: 'LOGOUT' } });
    res.clearCookie(SESSION_COOKIES[portal], { path: '/' });
    res.clearCookie(csrfCookieName(portal), { path: '/' });
    await this.audit.record(req.actor, { action: 'auth.logout', resourceType: 'USER', resourceId: req.portal!.userId });
    return { ok: true };
  }

  async me(req: AuthedRequest) {
    const p = req.portal!;
    const found = p.partnerId ? await this.prisma.partner.findUnique({ where: { id: p.partnerId }, select: { id: true, partnerCode: true, tradingName: true, status: true, portalSettings: true } }) : null;
    const partner = found ? { id: found.id, partnerCode: found.partnerCode, tradingName: found.tradingName, status: found.status, portal_settings: effectivePortalSettings(found.portalSettings) } : null;
    return {
      user: { id: p.userId, email: p.email, full_name: p.fullName, roles: p.roles, permissions: [...p.permissions].sort() },
      partner,
      mfa_verified: p.mfaVerified,
      environment: this.config.PLATFORM_ENVIRONMENT,
      sandbox: this.config.isSandbox,
    };
  }

  // ---- Invitations (partner and staff users) -----------------------------------------

  private async findInvitation(token: string) {
    const inv = await this.prisma.userInvitation.findUnique({ where: { tokenHash: this.crypto.tokenHash(token) } });
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt.getTime() < Date.now()) throw new AppError('NOT_FOUND');
    return inv;
  }

  async invitationInfo(token: string) {
    const inv = await this.findInvitation(token);
    const partner = inv.partnerId ? await this.prisma.partner.findUnique({ where: { id: inv.partnerId }, select: { tradingName: true } }) : null;
    return { email: inv.email, full_name: inv.fullName, type: inv.type, partner_name: partner?.tradingName ?? null, roles: inv.roleCodes };
  }

  async acceptInvitation(token: string, body: unknown, req: AuthedRequest) {
    const { password } = acceptSchema.parse(body);
    const policy = passwordPolicyErrors(password);
    if (policy.length) fail('VALIDATION_FAILED', { fields: policy.map((m) => ({ path: 'password', message: m })) });
    const inv = await this.findInvitation(token);
    await this.rateLimit.hit(`invite:${inv.id}`, 10, 600);
    const roles = await this.prisma.role.findMany({ where: { code: { in: inv.roleCodes }, scope: inv.type } });
    const secret = generateTotpSecret();
    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: inv.email } });
      if (existing && existing.status !== 'PENDING_MFA') throw new AppError('CONFLICT');
      const u = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password) } })
        : await tx.user.create({
            data: { email: inv.email, fullName: inv.fullName, type: inv.type, partnerId: inv.partnerId, status: 'PENDING_MFA', passwordHash: await hashPassword(password) },
          });
      await tx.userRole.deleteMany({ where: { userId: u.id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: u.id, roleId: r.id, grantedById: inv.invitedById })) });
      await tx.mfaCredential.deleteMany({ where: { userId: u.id, verifiedAt: null } });
      await tx.mfaCredential.create({ data: { userId: u.id, type: 'TOTP', secretEncrypted: this.crypto.encrypt(secret, `mfa:${u.id}`) } });
      return u;
    });
    await this.audit.record({ ...req.actor, id: user.id, label: user.email }, { action: 'user.invitation_accepted', resourceType: 'USER', resourceId: user.id, partnerId: user.partnerId });
    return { totp_secret: secret, otpauth_uri: totpUri(secret, user.email) };
  }

  async activateInvitation(token: string, body: unknown, req: AuthedRequest) {
    const { code } = codeSchema.parse(body);
    const inv = await this.findInvitation(token);
    await this.rateLimit.hit(`invite:${inv.id}`, 10, 600);
    const user = await this.prisma.user.findUnique({ where: { email: inv.email } });
    if (!user || user.status !== 'PENDING_MFA') throw new AppError('INVALID_STATE');
    const cred = await this.prisma.mfaCredential.findFirst({ where: { userId: user.id, verifiedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!cred) throw new AppError('INVALID_STATE');
    const step = verifyTotp(this.crypto.decrypt(cred.secretEncrypted, `mfa:${user.id}`), code);
    if (step === null) throw new AppError('MFA_INVALID');
    await this.prisma.$transaction([
      this.prisma.mfaCredential.update({ where: { id: cred.id }, data: { verifiedAt: new Date(), lastUsedStep: BigInt(step) } }),
      this.prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } }),
      this.prisma.userInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
    ]);
    await this.audit.record({ ...req.actor, id: user.id, label: user.email }, { action: 'user.mfa_enrolled', resourceType: 'USER', resourceId: user.id, partnerId: user.partnerId });
    return { activated: true, portal: user.type === 'STAFF' ? 'ADMIN' : 'PARTNER' };
  }

  async listSessions(req: AuthedRequest) {
    const rows = await this.prisma.session.findMany({ where: { userId: req.portal!.userId, revokedAt: null, mfaVerified: true, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((s) => ({ id: s.id, created_at: s.createdAt, last_seen_at: s.lastSeenAt, ip_address: s.ipAddress, user_agent: s.userAgent, current: s.id === req.portal!.sessionId })) };
  }

  async revokeSession(id: string, req: AuthedRequest) {
    const s = await this.prisma.session.findFirst({ where: { id, userId: req.portal!.userId } });
    if (!s) throw new AppError('NOT_FOUND');
    await this.prisma.session.update({ where: { id }, data: { revokedAt: new Date(), revokedReason: 'USER_REVOKED' } });
    await this.audit.record(req.actor, { action: 'auth.session_revoked', resourceType: 'SESSION', resourceId: id });
    return { ok: true };
  }
}

const portalParam = (p: string): PortalName => {
  if (p === 'admin') return 'ADMIN';
  if (p === 'partner') return 'PARTNER';
  throw new AppError('NOT_FOUND');
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('admin/sso/config')
  @Public()
  ssoConfig() {
    return this.auth.ssoConfig();
  }

  @Get('admin/sso/start')
  @Public()
  ssoStart(@Res() res: Response) {
    return this.auth.ssoStart(res);
  }

  @Get('admin/sso/callback')
  @Public()
  ssoCallback(@Query() q: Record<string, string | undefined>, @Ctx() req: AuthedRequest, @Res() res: Response) {
    return this.auth.ssoCallback(q, req, res);
  }

  @Post(':portal/login')
  @HttpCode(200)
  @Public()
  login(@Param('portal') portal: string, @Body() body: unknown, @Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(portalParam(portal), body, req, res);
  }

  @Post('admin/mfa')
  @HttpCode(200)
  @PortalSession('ADMIN', true)
  mfaAdmin(@Body() body: unknown, @Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyMfa('ADMIN', body, req, res);
  }

  @Post('partner/mfa')
  @HttpCode(200)
  @PortalSession('PARTNER', true)
  mfaPartner(@Body() body: unknown, @Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.verifyMfa('PARTNER', body, req, res);
  }

  @Post('admin/logout')
  @HttpCode(200)
  @PortalSession('ADMIN', true)
  logoutAdmin(@Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout('ADMIN', req, res);
  }

  @Post('partner/logout')
  @HttpCode(200)
  @PortalSession('PARTNER', true)
  logoutPartner(@Ctx() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout('PARTNER', req, res);
  }

  @Get('admin/me')
  @PortalSession('ADMIN')
  meAdmin(@Ctx() req: AuthedRequest) {
    return this.auth.me(req);
  }

  @Get('partner/me')
  @PortalSession('PARTNER')
  mePartner(@Ctx() req: AuthedRequest) {
    return this.auth.me(req);
  }

  @Get('admin/sessions')
  @PortalSession('ADMIN')
  sessionsAdmin(@Ctx() req: AuthedRequest) {
    return this.auth.listSessions(req);
  }

  @Post('admin/sessions/:id/revoke')
  @HttpCode(200)
  @PortalSession('ADMIN')
  revokeAdmin(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.auth.revokeSession(id, req);
  }

  @Get('partner/sessions')
  @PortalSession('PARTNER')
  sessionsPartner(@Ctx() req: AuthedRequest) {
    return this.auth.listSessions(req);
  }

  @Post('partner/sessions/:id/revoke')
  @HttpCode(200)
  @PortalSession('PARTNER')
  revokePartner(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.auth.revokeSession(id, req);
  }

  @Get('invitations/:token')
  @Public()
  invitation(@Param('token') token: string) {
    return this.auth.invitationInfo(token);
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  @Public()
  accept(@Param('token') token: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.auth.acceptInvitation(token, body, req);
  }

  @Post('invitations/:token/activate')
  @HttpCode(200)
  @Public()
  activate(@Param('token') token: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.auth.activateInvitation(token, body, req);
  }
}
