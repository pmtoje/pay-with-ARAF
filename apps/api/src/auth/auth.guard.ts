import { disabledPortalPermissions, effectivePortalSettings } from '@araf/types';
import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { apiKeyEnvironment, isWellFormedApiKey, safeEqual, verifyApiKey } from '@araf/security';
import type { ApiScope, PermissionCode } from '@araf/types';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService, RateLimitService, type Actor } from '../common/core.services';

export type PortalName = 'ADMIN' | 'PARTNER';

export type AuthSpec =
  | { kind: 'public' }
  | { kind: 'portal'; portal: PortalName; permissions: PermissionCode[]; allowWithoutMfa?: boolean }
  | { kind: 'apiKey'; scope: ApiScope }
  | { kind: 'customer'; requireAuthenticated: boolean };

const AUTH_KEY = 'araf:auth';
export const Public = () => SetMetadata(AUTH_KEY, { kind: 'public' } satisfies AuthSpec);
export const Staff = (...permissions: PermissionCode[]) => SetMetadata(AUTH_KEY, { kind: 'portal', portal: 'ADMIN', permissions } satisfies AuthSpec);
export const PartnerUser = (...permissions: PermissionCode[]) => SetMetadata(AUTH_KEY, { kind: 'portal', portal: 'PARTNER', permissions } satisfies AuthSpec);
export const PortalSession = (portal: PortalName, allowWithoutMfa = false) =>
  SetMetadata(AUTH_KEY, { kind: 'portal', portal, permissions: [], allowWithoutMfa } satisfies AuthSpec);
export const ApiKey = (scope: ApiScope) => SetMetadata(AUTH_KEY, { kind: 'apiKey', scope } satisfies AuthSpec);
/** Customer checkout session. `authenticated` = OTP verified and active within the inactivity window. */
export const Customer = (authenticated = true) => SetMetadata(AUTH_KEY, { kind: 'customer', requireAuthenticated: authenticated } satisfies AuthSpec);

export const SESSION_COOKIES: Record<PortalName, string> = { ADMIN: 'araf_admin_session', PARTNER: 'araf_partner_session' };
export const CUSTOMER_COOKIE = 'araf_checkout_session';
export const CSRF_HEADER = 'x-csrf-token';

export const SESSION_IDLE_MS = 15 * 60_000;
export const CUSTOMER_IDLE_MS = 5 * 60_000; // SWR: five-minute inactivity timeout

export interface PortalContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  partnerId: string | null;
  roles: string[];
  permissions: Set<string>;
  mfaVerified: boolean;
}

export interface ApiContext {
  credentialId: string;
  partnerId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  scopes: string[];
}

export interface CustomerContext {
  sessionId: string;
  applicationId: string;
  authenticated: boolean;
}

export interface AuthedRequest extends Request {
  correlationId: string;
  actor: Actor;
  portal?: PortalContext;
  api?: ApiContext;
  customer?: CustomerContext;
  rawBody?: Buffer;
}

export const Ctx = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>());

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<AuthSpec | undefined>(AUTH_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    req.actor = { type: 'SYSTEM', ip: req.ip, userAgent: req.headers['user-agent'], correlationId: req.correlationId };
    // Fail closed: routes without an explicit auth declaration are denied.
    if (!spec) throw new AppError('FORBIDDEN');
    switch (spec.kind) {
      case 'public':
        return true;
      case 'portal':
        return this.portal(req, spec);
      case 'apiKey':
        return this.apiKey(req, spec.scope);
      case 'customer':
        return this.customer(req, spec.requireAuthenticated);
    }
  }

  private async portal(req: AuthedRequest, spec: Extract<AuthSpec, { kind: 'portal' }>): Promise<boolean> {
    const token = req.cookies?.[SESSION_COOKIES[spec.portal]];
    if (!token || typeof token !== 'string') throw new AppError('UNAUTHENTICATED');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.tokenHash(token) },
      include: { user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } },
    });
    const now = Date.now();
    if (!session || session.revokedAt || session.portal !== spec.portal || session.expiresAt.getTime() < now) throw new AppError('UNAUTHENTICATED');
    if (now - session.lastSeenAt.getTime() > SESSION_IDLE_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'IDLE_TIMEOUT' } });
      throw new AppError('SESSION_EXPIRED');
    }
    const user = session.user;
    if (user.status !== 'ACTIVE') throw new AppError('UNAUTHENTICATED');
    if (spec.portal === 'PARTNER' && (user.type !== 'PARTNER' || !user.partnerId)) throw new AppError('FORBIDDEN');
    if (spec.portal === 'ADMIN' && user.type !== 'STAFF') throw new AppError('FORBIDDEN');
    if (!session.mfaVerified && !spec.allowWithoutMfa) throw new AppError('MFA_REQUIRED');
    if (MUTATING.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(this.crypto.tokenHash(header), session.csrfTokenHash)) throw new AppError('CSRF_FAILED');
    }
    const activeRoles = user.roles.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now);
    const permissions = new Set(activeRoles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)));
    if (spec.portal === 'PARTNER' && user.partnerId) {
      // Sections the Bank switched off for this partner are removed whatever the user's role.
      const partner = await this.prisma.partner.findUnique({ where: { id: user.partnerId }, select: { portalSettings: true } });
      for (const p of disabledPortalPermissions(effectivePortalSettings(partner?.portalSettings))) permissions.delete(p);
    }
    req.portal = {
      sessionId: session.id,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      partnerId: user.partnerId,
      roles: activeRoles.map((r) => r.role.code),
      permissions,
      mfaVerified: session.mfaVerified,
    };
    req.actor = {
      type: spec.portal === 'ADMIN' ? 'STAFF' : 'PARTNER_USER',
      id: user.id,
      label: user.fullName,
      roles: req.portal.roles,
      permissions: [...permissions],
      partnerId: user.partnerId ?? undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      correlationId: req.correlationId,
    };
    const missing = spec.permissions.filter((p) => !permissions.has(p));
    if (missing.length) {
      await this.audit.record(req.actor, { action: 'access.denied', resourceType: 'ROUTE', resourceId: `${req.method} ${req.route?.path ?? req.path}`, outcome: 'DENIED', reason: `missing ${missing.join(',')}` });
      throw new AppError('FORBIDDEN');
    }
    // Sliding idle window (throttled writes).
    if (now - session.lastSeenAt.getTime() > 30_000) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return true;
  }

  private async apiKey(req: AuthedRequest, scope: ApiScope): Promise<boolean> {
    const header = req.headers.authorization;
    const secret = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!isWellFormedApiKey(secret)) throw new AppError('INVALID_API_KEY');
    await this.rateLimit.hit(`apikey:${secret.slice(0, 16)}`, 600, 60);
    const cred = await this.prisma.partnerApiCredential.findUnique({ where: { lookupPrefix: secret.slice(0, 16) }, include: { partner: true } });
    if (!cred || !verifyApiKey(secret, this.config.API_KEY_PEPPER, cred.keyHash)) throw new AppError('INVALID_API_KEY');
    if (cred.status !== 'ACTIVE' || (cred.expiresAt && cred.expiresAt.getTime() < Date.now())) throw new AppError('INVALID_API_KEY');
    const env = apiKeyEnvironment(secret);
    if (env !== cred.environment || env !== this.config.PLATFORM_ENVIRONMENT) throw new AppError('API_KEY_ENVIRONMENT_MISMATCH');
    const okStatuses = env === 'SANDBOX' ? ['SANDBOX_ACTIVE', 'PRODUCTION_PENDING', 'PRODUCTION_ACTIVE'] : ['PRODUCTION_ACTIVE'];
    if (!okStatuses.includes(cred.partner.status)) throw new AppError('PARTNER_NOT_ACTIVE');
    if (cred.ipAllowlist.length && !cred.ipAllowlist.includes(req.ip ?? '')) throw new AppError('IP_NOT_ALLOWED');
    if (!cred.scopes.includes(scope)) throw new AppError('INSUFFICIENT_SCOPE');
    req.api = { credentialId: cred.id, partnerId: cred.partnerId, environment: cred.environment, scopes: cred.scopes };
    req.actor = { type: 'PARTNER_API', id: cred.id, label: `API key …${cred.last4}`, partnerId: cred.partnerId, ip: req.ip, userAgent: req.headers['user-agent'], correlationId: req.correlationId };
    if (!cred.lastUsedAt || Date.now() - cred.lastUsedAt.getTime() > 60_000) {
      await this.prisma.partnerApiCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date(), lastUsedIp: req.ip } });
    }
    return true;
  }

  private async customer(req: AuthedRequest, requireAuthenticated: boolean): Promise<boolean> {
    const token = req.cookies?.[CUSTOMER_COOKIE];
    if (!token || typeof token !== 'string') throw new AppError('SESSION_EXPIRED');
    const session = await this.prisma.customerSession.findUnique({ where: { tokenHash: this.crypto.tokenHash(token) } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) throw new AppError('SESSION_EXPIRED');
    // The session must belong to the checkout session named in the URL (no cross-application access).
    const csId = req.params?.sessionId;
    const app = await this.prisma.financingApplication.findUnique({ where: { id: session.applicationId }, select: { checkoutSessionId: true } });
    if (!app || (csId && app.checkoutSessionId !== csId)) throw new AppError('SESSION_EXPIRED');
    if (MUTATING.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(this.crypto.tokenHash(header), session.csrfTokenHash)) throw new AppError('CSRF_FAILED');
    }
    const idle = Date.now() - session.lastActivityAt.getTime() > CUSTOMER_IDLE_MS;
    let authenticated = session.authenticated;
    if (idle && authenticated) {
      authenticated = false;
      await this.prisma.customerSession.update({ where: { id: session.id }, data: { authenticated: false } });
    }
    if (requireAuthenticated && !authenticated) throw new AppError('SESSION_EXPIRED');
    await this.prisma.customerSession.update({ where: { id: session.id }, data: { lastActivityAt: new Date() } });
    req.customer = { sessionId: session.id, applicationId: session.applicationId, authenticated };
    req.actor = { type: 'CUSTOMER', id: session.applicationId, label: 'Customer', ip: req.ip, userAgent: req.headers['user-agent'], correlationId: req.correlationId };
    return true;
  }
}
