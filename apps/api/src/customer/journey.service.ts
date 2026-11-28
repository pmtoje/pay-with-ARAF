import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Response } from 'express';
import { z } from 'zod';
import { classifyScore, customerCreditMessage, isAgeEligible, isValidBvnFormat, type ApplicationState } from '@araf/business-rules';
import { ProviderError, APP_IDENTITY } from '@araf/integrations';
import { generateNumericOtp, hashOtp, maskAccountNumber, maskEmail, maskPhone, randomToken, safeEqual, sha256Hex, signStateToken, verifyOtp, verifyStateToken, hmacSha256Hex } from '@araf/security';
import type { FinancingApplication } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError, fail } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, RateLimitService, StateService, SYSTEM_ACTOR, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { customerStatus, equityView, n } from '../applications/presenters';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ArafReportingService } from '../araf/araf-reporting.service';
import { CUSTOMER_COOKIE, type AuthedRequest } from '../auth/auth.guard';

export const CONSENTS = {
  IDENTITY_VERIFICATION: { version: '2026-11.1', required: true, basis: 'CONSENT', provider: 'BVN identity service', text: 'I authorise The Alternative Bank to verify my identity using my BVN and date of birth.' },
  CREDIT_ASSESSMENT: { version: '2026-11.1', required: true, basis: 'CONSENT', provider: 'SeedFi', text: 'I authorise The Alternative Bank to obtain my credit report and score from SeedFi to assess this financing request.' },
  APPLICATION_PROCESSING: { version: '2026-11.1', required: true, basis: 'CONTRACT', provider: null, text: 'I understand The Alternative Bank will process my information to evaluate this financing application under the Privacy Notice.' },
  STATEMENT_ACCESS: { version: '2026-11.1', required: false, basis: 'CONSENT', provider: 'AltBank / Mono', text: 'I authorise access to my bank statements for the required period to assess affordability.' },
  THIRD_PARTY_ANALYSIS: { version: '2026-11.1', required: false, basis: 'CONSENT', provider: 'Periculum', text: 'I authorise Periculum to analyse my statement on behalf of The Alternative Bank.' },
  DATA_SHARING: { version: '2026-11.1', required: false, basis: 'CONSENT', provider: 'Merchant', text: 'I agree that the merchant will be told the status of my application (never my credit details).' },
  FINANCING_TERMS: { version: '2026-11.1', required: false, basis: 'CONTRACT', provider: null, text: 'I have read the indicative offer and request The Alternative Bank to process my financing application.' },
  MANDATE: { version: '2026-11.1', required: false, basis: 'CONSENT', provider: 'Remita', text: 'I authorise a direct debit mandate for my repayments.' },
  MARKETING: { version: '2026-11.1', required: false, basis: 'CONSENT', provider: null, text: 'Send me news and offers from The Alternative Bank (optional).' },
} as const;

export type ConsentType = keyof typeof CONSENTS;

const OTP_TTL_MS = 5 * 60_000; // SWR: five-minute, single-use OTPs
const OTP_RESEND_MS = 60_000;
const OTP_MAX_ATTEMPTS = 5;
const IDENTITY_MAX_LOOKUPS = 5;

/**
 * Fair-credit / thin-file review: ask only what the Bank does not already have. Income and existing repayments
 * come from SeedFi and the statement analysis, the address from the merchant or the BVN record. The older optional
 * fields are still accepted (earlier clients) but never required.
 */
const enhancedSchema = z
  .object({
    employment_status: z.enum(['EMPLOYED', 'SELF_EMPLOYED', 'CONTRACT', 'OTHER']),
    employer_name: z.string().trim().max(120).optional(),
    employment_duration_months: z.number().int().min(0).max(600).optional(),
    business_name: z.string().trim().max(120).optional(),
    nature_of_business: z.string().trim().max(200).optional(),
    business_duration_months: z.number().int().min(0).max(600).optional(),
    job_role: z.string().trim().max(120).optional(),
    monthly_income_naira: z.number().int().min(0).max(1_000_000_000).optional(),
    residential_address: z.string().trim().min(5).max(300).optional(),
    accommodation_type: z.enum(['OWNED', 'RENTED', 'FAMILY', 'EMPLOYER_PROVIDED', 'OTHER']).optional(),
    dependants: z.number().int().min(0).max(30).optional(),
    existing_obligations_naira: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.employment_status === 'EMPLOYED' || v.employment_status === 'CONTRACT') && !v.employer_name) ctx.addIssue({ code: 'custom', path: ['employer_name'], message: 'Required' });
    if (v.employment_status === 'SELF_EMPLOYED' && !v.business_name) ctx.addIssue({ code: 'custom', path: ['business_name'], message: 'Required' });
  });

export interface MerchantPrefill {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  bvn?: string;
  gender?: 'male' | 'female';
  income_type?: 'SALARY' | 'BUSINESS';
  employer_name?: string;
  business_name?: string;
  nature_of_business?: string;
  equity_amount?: number;
  address?: { line1: string; city: string; state: string };
}

@Injectable()
export class JourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly rateLimit: RateLimitService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly moduleRef: ModuleRef,
    private readonly arafReports: ArafReportingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- Helpers ---------------------------------------------------------------------------

  private async appBySession(sessionId: string) {
    const session = await this.prisma.checkoutSession.findUnique({ where: { id: sessionId }, include: { application: true, order: { include: { items: true } } } });
    if (!session || !session.application) throw new AppError('NOT_FOUND');
    return { session, app: session.application };
  }

  private callCtx(app: FinancingApplication, req: AuthedRequest) {
    return { correlationId: req.correlationId, applicationReference: app.reference, applicationId: app.id };
  }

  async emitMerchant(tx: Tx, app: FinancingApplication, type: Parameters<WebhooksService['emit']>[1]['type'], data: Record<string, unknown> = {}) {
    const order = await tx.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } });
    const { deriveMerchantStatus } = await import('@araf/business-rules');
    await this.webhooks.emit(tx, {
      partnerId: app.partnerId,
      environment: app.environment,
      type,
      applicationReference: app.reference,
      merchantOrderReference: order.merchantOrderReference,
      resourceVersion: app.version,
      data: { status: deriveMerchantStatus(app.status as ApplicationState), ...data },
    });
  }

  async notifyCustomer(tx: Tx, app: FinancingApplication, templateCode: string) {
    const session = await tx.checkoutSession.findUniqueOrThrow({ where: { id: app.checkoutSessionId }, include: { order: true } });
    const email = session.order.customerEmail;
    if (!email) return;
    await this.notifications.enqueue(tx, {
      environment: app.environment, audience: 'CUSTOMER', channel: 'EMAIL', templateCode, destination: email, partnerId: app.partnerId,
      applicationId: app.id, applicationReference: app.reference, vars: { reference: app.reference },
    });
  }

  // ---- Public summary & session ----------------------------------------------------------

  /** Merchant-supplied customer details for this checkout (server-side only). */
  async prefillFor(sessionId: string): Promise<MerchantPrefill> {
    const s = await this.prisma.checkoutSession.findUnique({ where: { id: sessionId }, select: { customerPrefillEncrypted: true } });
    return s?.customerPrefillEncrypted ? this.crypto.decryptJson<MerchantPrefill>(s.customerPrefillEncrypted, `prefill:${sessionId}`) : {};
  }

  async summary(sessionId: string) {
    const { session, app } = await this.appBySession(sessionId);
    const pre = await this.prefillFor(session.id);
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: session.partnerId }, select: { tradingName: true, websiteUrl: true } });
    // Websites allowed to embed this checkout (approved partner origins for this environment).
    const embedOrigins = (await this.prisma.partnerDomain.findMany({ where: { partnerId: session.partnerId, environment: session.environment, kind: 'RETURN_URL_ORIGIN', approved: true }, select: { value: true } })).map((d) => d.value);
    const { EXPIRABLE_APPLICATION_STATES } = await import('@araf/business-rules');
    const expired = session.status === 'SUPERSEDED' || (EXPIRABLE_APPLICATION_STATES.includes(app.status as never) && (session.expiresAt.getTime() < Date.now() || ['EXPIRED', 'CANCELLED'].includes(session.status)));
    return {
      session_id: session.id,
      application_reference: app.reference,
      partner: { name: partner.tradingName, website: partner.websiteUrl },
      currency: 'NGN',
      amount: n(session.amountKobo),
      items: session.order.items.map((i) => ({ name: i.name, quantity: i.quantity, unit_amount: n(i.unitAmountKobo), line_amount: n(i.lineAmountKobo), category: i.category })),
      cancel_url: session.cancelUrl,
      return_url: session.returnUrl,
      embed_origins: embedOrigins,
      // Which details the merchant already provided. Values are never sent to the browser before
      // the customer proves who they are; the BVN shows only its last two digits.
      prefill: {
        from: partner.tradingName,
        bvn: !!pre.bvn,
        bvn_hint: pre.bvn ? `•••••••••${pre.bvn.slice(-2)}` : null,
        date_of_birth: !!pre.date_of_birth,
        gender: !!pre.gender,
        income_type: !!pre.income_type,
        equity: typeof pre.equity_amount === 'number',
        name: !!(pre.first_name && pre.last_name),
        email: !!pre.email,
        phone: !!pre.phone,
        address: !!pre.address,
      },
      expires_at: session.expiresAt,
      expired,
      superseded_by: session.supersededById,
      sandbox: app.environment === 'SANDBOX',
      identity_verified: !['CREATED', 'IDENTITY_PENDING'].includes(app.status),
    };
  }

  /** Start (or restart) the hosted-checkout browser session. */
  async open(sessionId: string, req: AuthedRequest, res: Response) {
    const { session, app } = await this.appBySession(sessionId);
    // Checkout expiry only limits the origination window. Once an offer has been accepted, the
    // customer must always be able to return (with OTP re-authentication) to track and act.
    const { EXPIRABLE_APPLICATION_STATES } = await import('@araf/business-rules');
    const originating = EXPIRABLE_APPLICATION_STATES.includes(app.status as never);
    if (['SUPERSEDED'].includes(session.status) || (originating && (session.expiresAt.getTime() < Date.now() || ['EXPIRED', 'CANCELLED'].includes(session.status)))) {
      throw new AppError('CHECKOUT_EXPIRED');
    }
    await this.rateLimit.hit(`cx-open:${req.ip}`, 60, 300);
    const token = randomToken('', 48);
    const csrf = randomToken('', 32);
    await this.prisma.$transaction(async (tx) => {
      // One active browser session per application; opening elsewhere requires OTP re-verification.
      await tx.customerSession.updateMany({ where: { applicationId: app.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.customerSession.create({
        data: { applicationId: app.id, tokenHash: this.crypto.tokenHash(token), csrfTokenHash: this.crypto.tokenHash(csrf), expiresAt: new Date(Date.now() + 24 * 3600_000) },
      });
      if (session.status === 'CREATED') await tx.checkoutSession.update({ where: { id: session.id }, data: { status: 'OPEN', openedAt: new Date() } });
      if (app.status === 'CREATED') await this.state.transitionApplication(tx, app, 'IDENTITY_PENDING', { ...req.actor, type: 'CUSTOMER' });
    });
    // Over HTTPS the checkout may be embedded in a merchant page (a cross-site iframe), so the cookie
    // is SameSite=None and Partitioned (CHIPS): it is only ever sent to this checkout inside THAT
    // merchant's page and cannot be used for tracking across sites. CSRF protection is the
    // per-session header token, not SameSite. Local HTTP development keeps SameSite=Lax.
    res.cookie(CUSTOMER_COOKIE, token, this.config.COOKIE_SECURE ? { httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: '/', maxAge: 24 * 3600_000 } : { httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 24 * 3600_000 });
    return { csrf_token: csrf, identity_verified: !['CREATED', 'IDENTITY_PENDING'].includes(app.status) };
  }

  // ---- Consent ---------------------------------------------------------------------------

  consentCatalogue() {
    return Object.entries(CONSENTS).map(([type, c]) => ({ type, version: c.version, required: c.required, lawful_basis: c.basis, provider: c.provider, text: c.text }));
  }

  async recordConsents(applicationId: string, types: string[], req: AuthedRequest, tx?: Tx) {
    const valid = types.filter((t): t is ConsentType => t in CONSENTS);
    const db = tx ?? this.prisma;
    for (const t of valid) {
      const c = CONSENTS[t];
      await db.customerConsent.create({
        data: { applicationId, consentType: t, lawfulBasis: c.basis, version: c.version, provider: c.provider, textHash: sha256Hex(c.text), ipAddress: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) },
      });
    }
    return valid;
  }

  async submitConsents(applicationId: string, body: unknown, req: AuthedRequest) {
    const { consents } = z.object({ consents: z.array(z.string()).max(20) }).strict().parse(body);
    const required = (Object.keys(CONSENTS) as ConsentType[]).filter((k) => CONSENTS[k].required);
    if (!required.every((r) => consents.includes(r))) throw new AppError('CONSENT_REQUIRED', { required });
    const recorded = await this.recordConsents(applicationId, consents, req);
    await this.audit.record(req.actor, { action: 'customer.consent_recorded', resourceType: 'APPLICATION', resourceId: applicationId, after: { consents: recorded } });
    return { recorded };
  }

  private async hasConsents(applicationId: string, types: ConsentType[]) {
    const rows = await this.prisma.customerConsent.findMany({ where: { applicationId, consentType: { in: types }, withdrawnAt: null } });
    return types.every((t) => rows.some((r) => r.consentType === t));
  }

  // ---- Identity verification ------------------------------------------------------------

  async submitIdentity(applicationId: string, body: unknown, req: AuthedRequest) {
    const given = z.object({ bvn: z.string().optional(), date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), gender: z.enum(['male', 'female']).optional() }).strict().parse(body);
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    // Use what the merchant already provided; the customer only supplies what is missing (or overrides it).
    const pre = await this.prefillFor(app.checkoutSessionId);
    const input = { bvn: given.bvn || pre.bvn || '', date_of_birth: given.date_of_birth || pre.date_of_birth || '' };
    const missing = [!input.bvn && 'bvn', !input.date_of_birth && 'date_of_birth'].filter(Boolean) as string[];
    if (missing.length) fail('VALIDATION_FAILED', { fields: missing.map((path) => ({ path, message: 'Required' })) });
    if (app.status !== 'IDENTITY_PENDING') throw new AppError('INVALID_STATE');
    if (!(await this.hasConsents(applicationId, ['IDENTITY_VERIFICATION', 'CREDIT_ASSESSMENT', 'APPLICATION_PROCESSING']))) throw new AppError('CONSENT_REQUIRED');
    if (!isValidBvnFormat(input.bvn)) throw new AppError('INVALID_BVN');
    const bvnHash = this.crypto.bvnIndex(input.bvn);
    await this.rateLimit.hit(`idv-ip:${req.ip}`, 20, 3600);
    await this.rateLimit.hit(`idv-bvn:${bvnHash}`, 10, 24 * 3600);
    const attempts = await this.prisma.identityVerification.count({ where: { applicationId, status: { in: ['FAILED', 'LOCKED'] } } });
    if (attempts >= IDENTITY_MAX_LOOKUPS) throw new AppError('IDENTITY_LOCKED');
    const policy = await this.ctx.policyFor(app.creditPolicyVersionId);
    let ageOk = false;
    try {
      ageOk = isAgeEligible(input.date_of_birth, new Date(), policy);
    } catch {
      fail('VALIDATION_FAILED', { fields: [{ path: 'date_of_birth', message: 'Enter a valid date' }] });
    }

    let lookup;
    try {
      lookup = await this.providers.call(app.environment, 'IDENTITY', 'bvn_lookup', this.callCtx(app, req), () =>
        this.providers.for(app.environment).identity.lookupBvn(input.bvn, input.date_of_birth, this.callCtx(app, req)),
      );
    } catch (e) {
      if (e instanceof ProviderError) throw new AppError('IDENTITY_PROVIDER_UNAVAILABLE');
      throw e;
    }
    if (lookup.status !== 'MATCH') {
      await this.prisma.identityVerification.create({ data: { applicationId, bvnHash, bvnLast4: input.bvn.slice(-4), status: 'FAILED', failureCode: lookup.status, providerReference: lookup.providerReference } });
      await this.audit.record(req.actor, { action: 'customer.identity_failed', resourceType: 'APPLICATION', resourceId: applicationId, outcome: 'FAILURE', reason: lookup.status });
      throw new AppError('IDENTITY_MISMATCH');
    }
    // The credit check (SeedFi) needs the gender on the BVN record: the BVN service's value when it returns one,
    // otherwise what the customer (or the merchant) gave.
    const gender = lookup.gender ?? given.gender ?? pre.gender ?? null;
    if (!gender) fail('VALIDATION_FAILED', { fields: [{ path: 'gender', message: 'Choose the gender on your BVN record' }] });
    if (!ageOk) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, applicationId);
        await this.state.transitionApplication(tx, locked, 'DECLINED', req.actor, { reason: 'AGE_NOT_ELIGIBLE', data: { declineReasonCode: 'AGE_NOT_ELIGIBLE' } });
        await this.emitMerchant(tx, locked, 'application.declined');
      });
      throw new AppError('AGE_NOT_ELIGIBLE');
    }
    const verification = await this.prisma.identityVerification.create({
      data: {
        applicationId,
        bvnHash,
        bvnLast4: input.bvn.slice(-4),
        status: 'OTP_SENT',
        providerReference: lookup.providerReference,
        phoneMasked: maskPhone(lookup.phone),
        bvnEncrypted: this.crypto.encrypt(input.bvn, `idv:${applicationId}`),
        phoneEncrypted: this.crypto.encrypt(lookup.phone, `idv:${applicationId}`),
        dobEncrypted: this.crypto.encrypt(input.date_of_birth, `idv:${applicationId}`),
        firstNameEnc: this.crypto.encrypt(lookup.firstName, `idv:${applicationId}`),
        lastNameEnc: this.crypto.encrypt(lookup.lastName, `idv:${applicationId}`),
        gender,
      },
    });
    const sent = await this.issueOtp(app, 'IDENTITY', lookup.phone, req, verification.id);
    return { otp_sent_to: sent.sentTo, expires_in_seconds: OTP_TTL_MS / 1000, resend_available_in_seconds: OTP_RESEND_MS / 1000, challenge_id: sent.id };
  }

  async issueOtp(app: FinancingApplication, purpose: 'IDENTITY' | 'RESUME' | 'DOCUMENT_SIGNING' | 'SALE_CONTRACT', phone: string, req: AuthedRequest, identityVerificationId?: string) {
    const last = await this.prisma.otpChallenge.findFirst({ where: { applicationId: app.id, purpose, consumedAt: null, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
    if (last && last.resendAvailableAt.getTime() > Date.now()) throw new AppError('OTP_RESEND_COOLDOWN', { retry_after_seconds: Math.ceil((last.resendAvailableAt.getTime() - Date.now()) / 1000) });
    await this.rateLimit.hit(`otp-send:${app.id}`, 6, 3600);
    // Codes go to the phone linked to the BVN record — that is what proves the shopper holds the BVN. A
    // sandbox demo without an SMS gateway may opt in to the merchant-supplied email (never for production).
    const emailAllowed = app.environment === 'SANDBOX' && this.config.SANDBOX_OTP_VIA_MERCHANT_EMAIL;
    const order = emailAllowed ? await this.prisma.merchantOrder.findUnique({ where: { id: app.orderId }, select: { customerEmail: true } }) : null;
    const email = order?.customerEmail?.trim() || null;
    const channel = email ? 'EMAIL' : 'SMS';
    const destination = email ?? phone;
    const destinationMasked = email ? maskEmail(email) : maskPhone(phone);
    const code = generateNumericOtp(6);
    const id = crypto.randomUUID();
    await this.prisma.$transaction(async (tx) => {
      // A new challenge invalidates earlier ones (replay prevention).
      await tx.otpChallenge.updateMany({ where: { applicationId: app.id, purpose, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: new Date() } });
      await tx.otpChallenge.create({
        data: {
          id,
          purpose,
          applicationId: app.id,
          identityVerificationId: identityVerificationId ?? null,
          customerSessionId: req.customer!.sessionId,
          codeHash: hashOtp(code, id, this.config.OTP_PEPPER),
          channel,
          destinationMasked,
          maxAttempts: OTP_MAX_ATTEMPTS,
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
          resendAvailableAt: new Date(Date.now() + OTP_RESEND_MS),
        },
      });
    });
    // Sent synchronously (never through the outbox) so the code is not persisted anywhere.
    await this.providers.call(app.environment, 'NOTIFICATIONS', 'send_otp', this.callCtx(app, req), () =>
      this.providers.for(app.environment).notifications.send(
        { channel, destination, subject: 'Pay with ARAF verification code', body: `Your Pay with ARAF code is ${code}. It expires in 5 minutes. Never share this code.`, applicationReference: app.reference },
        this.callCtx(app, req),
      ),
    );
    await this.audit.record(req.actor, { action: 'customer.otp_sent', resourceType: 'APPLICATION', resourceId: app.id, after: { purpose, destination: destinationMasked } });
    return { id, sentTo: destinationMasked, channel };
  }

  /** Validate and consume an OTP bound to this application, purpose and browser session. */
  async consumeOtp(app: FinancingApplication, purpose: string, code: string, req: AuthedRequest) {
    const ch = await this.prisma.otpChallenge.findFirst({ where: { applicationId: app.id, purpose, consumedAt: null, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!ch) throw new AppError('OTP_EXPIRED');
    if (ch.customerSessionId !== req.customer!.sessionId) throw new AppError('OTP_INVALID');
    if (ch.expiresAt.getTime() < Date.now()) throw new AppError('OTP_EXPIRED');
    if (ch.attempts >= ch.maxAttempts) throw new AppError('OTP_ATTEMPTS_EXCEEDED');
    if (!verifyOtp(code, ch.id, this.config.OTP_PEPPER, ch.codeHash)) {
      const updated = await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
      await this.audit.record(req.actor, { action: 'customer.otp_failed', resourceType: 'APPLICATION', resourceId: app.id, outcome: 'FAILURE', after: { purpose, attempts: updated.attempts } });
      if (updated.attempts >= ch.maxAttempts) {
        await this.prisma.otpChallenge.update({ where: { id: ch.id }, data: { invalidatedAt: new Date() } });
        throw new AppError('OTP_ATTEMPTS_EXCEEDED');
      }
      throw new AppError('OTP_INVALID', { attempts_remaining: ch.maxAttempts - updated.attempts });
    }
    // Single use: atomically consume.
    const consumed = await this.prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new AppError('OTP_INVALID');
    return ch;
  }

  async verifyIdentityOtp(applicationId: string, body: unknown, req: AuthedRequest) {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(body);
    let app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'IDENTITY_PENDING') throw new AppError('INVALID_STATE');
    await this.rateLimit.hit(`otp-verify:${applicationId}`, 20, 900);
    const ch = await this.consumeOtp(app, 'IDENTITY', code, req);
    const verification = await this.prisma.identityVerification.findUniqueOrThrow({ where: { id: ch.identityVerificationId! } });
    if (!verification.bvnEncrypted) throw new AppError('SESSION_EXPIRED');
    const bvn = this.crypto.decrypt(verification.bvnEncrypted, `idv:${applicationId}`);
    const firstName = this.crypto.decrypt(verification.firstNameEnc!, `idv:${applicationId}`);
    const lastName = this.crypto.decrypt(verification.lastNameEnc!, `idv:${applicationId}`);

    app = await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      const customer = await tx.customer.upsert({
        where: { environment_bvnHash: { environment: locked.environment, bvnHash: verification.bvnHash } },
        create: { environment: locked.environment, bvnHash: verification.bvnHash, bvnEncrypted: this.crypto.encrypt(bvn, `customer-bvn`), bvnLast4: bvn.slice(-4), firstName, lastName, phoneMasked: verification.phoneMasked },
        update: { firstName, lastName, phoneMasked: verification.phoneMasked },
      });
      await tx.identityVerification.update({ where: { id: verification.id }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
      await tx.customerSession.update({ where: { id: req.customer!.sessionId }, data: { authenticated: true, lastActivityAt: new Date() } });
      req.customer!.authenticated = true;
      await this.state.transitionApplication(tx, locked, 'IDENTITY_VERIFIED', req.actor, { data: { customerId: customer.id } });
      locked.customerId = customer.id;
      await this.audit.record(req.actor, { action: 'customer.identity_verified', resourceType: 'APPLICATION', resourceId: applicationId, after: { bvn: `•••••••${bvn.slice(-4)}` } }, tx);
      return locked;
    });
    if (app.environment === 'SANDBOX') await this.providers.simStore.put(APP_IDENTITY, app.reference, { bvn });
    // A revised cart reuses still-valid assessments (no repeated credit checks or statements).
    if (app.revisesApplicationId && (await this.tryReuseAssessments(app, req))) {
      // Recompute affordability and exposure for the NEW cart with the reused, still-valid inputs.
      const { EligibilityService } = await import('../credit/eligibility.service');
      await this.moduleRef.get(EligibilityService, { strict: false }).evaluate(app.id, SYSTEM_ACTOR, req.correlationId);
      return this.view(app.id, req);
    }
    await this.runCreditCheck(app.id, req);
    return this.view(app.id, req);
  }

  // ---- Resume (re-authentication) ----------------------------------------------------

  async requestResumeOtp(applicationId: string, req: AuthedRequest) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const verification = await this.prisma.identityVerification.findFirst({ where: { applicationId, status: 'VERIFIED' }, orderBy: { createdAt: 'desc' } });
    if (!verification?.phoneEncrypted) throw new AppError('INVALID_STATE');
    const phone = this.crypto.decrypt(verification.phoneEncrypted, `idv:${applicationId}`);
    const sent = await this.issueOtp(app, 'RESUME', phone, req);
    return { otp_sent_to: sent.sentTo, expires_in_seconds: OTP_TTL_MS / 1000 };
  }

  async verifyResumeOtp(applicationId: string, body: unknown, req: AuthedRequest) {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(body);
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    await this.rateLimit.hit(`otp-verify:${applicationId}`, 20, 900);
    await this.consumeOtp(app, 'RESUME', code, req);
    await this.prisma.customerSession.update({ where: { id: req.customer!.sessionId }, data: { authenticated: true, lastActivityAt: new Date() } });
    req.customer!.authenticated = true;
    await this.audit.record(req.actor, { action: 'customer.resumed', resourceType: 'APPLICATION', resourceId: applicationId });
    return this.view(applicationId, req);
  }

  async customerBvn(customerId: string): Promise<string> {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return this.crypto.decrypt(c.bvnEncrypted, 'customer-bvn');
  }

  // ---- Credit assessment (SeedFi) ------------------------------------------------------

  async runCreditCheck(applicationId: string, req: AuthedRequest) {
    let app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status === 'IDENTITY_VERIFIED') {
      app = await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, applicationId);
        await this.state.transitionApplication(tx, locked, 'CREDIT_CHECK_PENDING', req.actor);
        return locked;
      });
    }
    if (app.status !== 'CREDIT_CHECK_PENDING') throw new AppError('INVALID_STATE');
    await this.rateLimit.hit(`credit:${applicationId}`, 5, 3600);
    const policy = await this.ctx.policyFor(app.creditPolicyVersionId);
    const verification = await this.prisma.identityVerification.findFirstOrThrow({ where: { applicationId, status: 'VERIFIED' }, orderBy: { createdAt: 'desc' } });
    const bvn = await this.customerBvn(app.customerId!);
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } });
    const attempt = (await this.prisma.creditAssessment.count({ where: { applicationId } })) + 1;
    // Once and for all: a customer's still-valid SeedFi result (from any earlier application, same environment)
    // is reused instead of calling SeedFi again. It keeps its ORIGINAL expiry and is re-classified under this
    // application's credit policy.
    const sameEnvApps = (await this.prisma.financingApplication.findMany({ where: { customerId: customer.id, environment: app.environment, id: { not: applicationId } }, select: { id: true } })).map((a) => a.id);
    const reusable = sameEnvApps.length
      ? await this.prisma.creditAssessment.findFirst({
          where: { customerId: customer.id, provider: 'SEEDFI', status: 'COMPLETED', validUntil: { gt: new Date() }, applicationId: { in: sameEnvApps } },
          orderBy: { assessedAt: 'desc' },
        })
      : null;
    let response;
    try {
      response = reusable
        ? {
            providerReference: reusable.providerReference ?? 'reused',
            score: reusable.band === 'NO_SCORE' ? null : reusable.score,
            hasCreditHistory: reusable.band !== 'NO_SCORE',
            bureauMonthlyObligations: reusable.bureauMonthlyObligationsKobo,
            outstandingExposure: reusable.outstandingExposureKobo,
            delinquencyIndicators: reusable.delinquencyIndicators,
          }
        : await this.providers.call(app.environment, 'SEEDFI', 'credit_assessment', this.callCtx(app, req), () =>
            this.providers.for(app.environment).credit.assess(
              {
                bvn,
                firstName: customer.firstName,
                lastName: customer.lastName,
                dateOfBirth: this.crypto.decrypt(verification.dobEncrypted!, `idv:${applicationId}`),
                phone: verification.phoneEncrypted ? this.crypto.decrypt(verification.phoneEncrypted, `idv:${applicationId}`) : undefined,
                gender: verification.gender === 'male' || verification.gender === 'female' ? verification.gender : undefined,
                // Stable and non-identifying (never the BVN).
                customerId: `pwa-${customer.id}`,
              },
              this.callCtx(app, req),
            ),
          );
    } catch (e) {
      // A technical failure is NEVER interpreted as poor credit.
      await this.prisma.creditAssessment.create({
        data: { applicationId, customerId: customer.id, provider: 'SEEDFI', status: 'TECHNICAL_FAILURE', policyVersionId: app.creditPolicyVersionId, failureCode: e instanceof ProviderError ? e.code : 'UNEXPECTED', attempt, delinquencyIndicators: [] },
      });
      throw new AppError('CREDIT_PROVIDER_UNAVAILABLE');
    }
    const classification = classifyScore(response.score, policy);
    if (classification.kind === 'INVALID_RESPONSE') {
      await this.prisma.creditAssessment.create({
        data: { applicationId, customerId: customer.id, provider: 'SEEDFI', status: 'INVALID_RESPONSE', providerReference: response.providerReference, policyVersionId: app.creditPolicyVersionId, failureCode: classification.reason, attempt, delinquencyIndicators: [] },
      });
      throw new AppError('CREDIT_INVALID_RESPONSE');
    }
    const band = classification.kind === 'BAND' ? classification.band : 'NO_SCORE';
    const outcome = classification.action;
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      await tx.creditAssessment.create({
        data: {
          applicationId,
          customerId: customer.id,
          provider: 'SEEDFI',
          status: 'COMPLETED',
          score: classification.kind === 'BAND' ? classification.score : null,
          band,
          outcome,
          policyVersionId: locked.creditPolicyVersionId,
          providerReference: response.providerReference,
          bureauMonthlyObligationsKobo: response.bureauMonthlyObligations,
          outstandingExposureKobo: response.outstandingExposure,
          delinquencyIndicators: response.delinquencyIndicators,
          attempt,
          assessedAt: reusable?.assessedAt ?? new Date(),
          validUntil: reusable?.validUntil ?? new Date(Date.now() + policy.assessmentValidityDays * 86_400_000),
          reusedFromId: reusable?.id ?? null,
        },
      });
      await this.state.transitionApplication(tx, locked, 'CREDIT_CHECK_COMPLETED', SYSTEM_ACTOR, { metadata: { band } });
      if (reusable) await this.audit.record(SYSTEM_ACTOR, { action: 'credit.assessment_reused', resourceType: 'APPLICATION', resourceId: applicationId, after: { reusedFrom: reusable.id, validUntil: reusable.validUntil } }, tx);
      if (outcome === 'DECLINE') {
        await this.state.transitionApplication(tx, locked, 'DECLINED', SYSTEM_ACTOR, { reason: 'CREDIT_POLICY', data: { declineReasonCode: 'CREDIT_POLICY' } });
        await this.emitMerchant(tx, locked, 'application.declined');
        await this.notifyCustomer(tx, locked, 'FINANCING_DECLINED');
      } else if (outcome === 'ENHANCED_REVIEW' || outcome === 'MANUAL_REVIEW') {
        await this.state.transitionApplication(tx, locked, 'ENHANCED_REVIEW_REQUIRED', SYSTEM_ACTOR, { reason: band === 'NO_SCORE' ? 'THIN_FILE' : 'FAIR_CREDIT' });
        await tx.enhancedReview.create({
          data: { applicationId, queue: band === 'NO_SCORE' ? 'THIN_FILE' : 'FAIR_CREDIT', status: 'AWAITING_CUSTOMER', requestedFields: ['employment_status', 'employer_name', 'employment_duration_months', 'business_name', 'nature_of_business', 'business_duration_months'], slaDueAt: new Date(Date.now() + 48 * 3600_000) },
        });
        // The merchant already sent how the shopper earns and where: nothing to ask.
        const fromMerchant = this.enhancedFromPrefill(await this.prefillFor(locked.checkoutSessionId));
        if (fromMerchant) await this.recordEnhancedInfo(tx, await tx.financingApplication.findUniqueOrThrow({ where: { id: applicationId } }), fromMerchant, SYSTEM_ACTOR);
        else await this.emitMerchant(tx, locked, 'application.action_required');
      } else {
        await this.state.transitionApplication(tx, locked, 'ACCOUNT_VERIFICATION_PENDING', SYSTEM_ACTOR);
      }
    });
    return { message: customerCreditMessage(classification) };
  }

  // ---- Enhanced assessment (fair credit / thin file) -------------------------------------

  async submitEnhancedInfo(applicationId: string, body: unknown, req: AuthedRequest) {
    const input = enhancedSchema.parse(body);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      await this.recordEnhancedInfo(tx, app, input, req.actor);
    });
    return this.view(applicationId, req);
  }

  /** Store the eligibility answers and send the application on for checking (customer or merchant pre-fill). */
  private async recordEnhancedInfo(tx: Tx, app: FinancingApplication, input: z.infer<typeof enhancedSchema>, actor: Actor) {
    {
      const applicationId = app.id;
      if (app.status !== 'ENHANCED_REVIEW_REQUIRED') throw new AppError('INVALID_STATE');
      const review = await tx.enhancedReview.findFirst({ where: { applicationId, status: { in: ['AWAITING_CUSTOMER', 'CLARIFICATION_REQUESTED'] } }, orderBy: { createdAt: 'desc' } });
      if (!review) throw new AppError('INVALID_STATE');
      await tx.enhancedReview.update({ where: { id: review.id }, data: { status: 'PENDING', formDataEncrypted: this.crypto.encryptJson(input, `review:${review.id}`) } });
      await this.state.transitionApplication(tx, app, 'ENHANCED_REVIEW_PENDING', actor);
      await this.notifications.enqueue(tx, {
        environment: app.environment, audience: 'BANK', channel: 'IN_APP', templateCode: 'BANK_MANUAL_REVIEW', destination: 'review.perform',
        applicationId: app.id, applicationReference: app.reference, vars: { reference: app.reference, queue: review.queue },
      });
      await this.emitMerchant(tx, app, 'application.under_review');
      await this.audit.record(actor, { action: 'customer.enhanced_info_submitted', resourceType: 'ENHANCED_REVIEW', resourceId: review.id }, tx);
    }
  }

  /** Backup repayment card, masked (never the provider authorization). */
  private async repaymentCardView(applicationId: string) {
    const c = (await this.prisma.repaymentCard.findFirst({ where: { applicationId, status: 'ACTIVE' } })) ?? (await this.prisma.repaymentCard.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }));
    if (!c) return { status: 'NONE' as const, required: this.config.BACKUP_CARD_REQUIRED };
    return { status: c.status, required: this.config.BACKUP_CARD_REQUIRED, last4: c.last4, card_type: c.cardType, bank: c.bank, expires: c.expMonth && c.expYear ? `${c.expMonth}/${c.expYear.slice(-2)}` : null, failure: c.failureCode };
  }

  /** True while the equity in use is the amount the shopper agreed with the merchant. */
  private async equityFromMerchant(app: FinancingApplication): Promise<boolean> {
    const pre = await this.prefillFor(app.checkoutSessionId);
    return typeof pre.equity_amount === 'number' && pre.equity_amount > 0 && BigInt(pre.equity_amount) === app.contributionAmountKobo;
  }

  /** The eligibility answers the merchant already sent, if they are complete enough to skip the form. */
  private enhancedFromPrefill(pre: MerchantPrefill): z.infer<typeof enhancedSchema> | null {
    if (pre.income_type === 'SALARY' && pre.employer_name) return { employment_status: 'EMPLOYED', employer_name: pre.employer_name };
    if (pre.income_type === 'BUSINESS' && pre.business_name) return { employment_status: 'SELF_EMPLOYED', business_name: pre.business_name, ...(pre.nature_of_business ? { nature_of_business: pre.nature_of_business } : {}) };
    return null;
  }

  /** How the shopper earns, from the merchant: skips the "How do you earn?" step once the account is confirmed. */
  private async applyPrefilledIncome(tx: Tx, applicationId: string, sessionId: string, actor: Actor) {
    const pre = await this.prefillFor(sessionId);
    if (!pre.income_type) return;
    const fresh = await tx.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (fresh.status !== 'ACCOUNT_VERIFIED') return;
    await this.state.transitionApplication(tx, fresh, 'STATEMENT_PENDING', actor, { data: { incomeProfile: pre.income_type === 'BUSINESS' ? 'BUSINESS_OWNER' : 'SALARY_EARNER' }, reason: 'MERCHANT_PREFILL' });
  }

  // ---- AltBank account verification ----------------------------------------------------

  async listAccounts(applicationId: string, req: AuthedRequest) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (!['ACCOUNT_VERIFICATION_PENDING', 'ENHANCED_REVIEW_CLEARED'].includes(app.status)) throw new AppError('INVALID_STATE');
    if (app.status === 'ENHANCED_REVIEW_CLEARED') {
      await this.prisma.$transaction(async (tx) => this.state.transitionApplication(tx, await this.ctx.lockApplication(tx, applicationId), 'ACCOUNT_VERIFICATION_PENDING', SYSTEM_ACTOR));
    }
    const bvn = await this.customerBvn(app.customerId!);
    const accounts = await this.providers.call(app.environment, 'ALTBANK', 'accounts_by_bvn', this.callCtx(app, req), () =>
      this.providers.for(app.environment).bankAccounts.findAccountsByBvn(bvn, this.callCtx(app, req)),
    );
    const out = [];
    for (const a of accounts) {
      // Ownership: the core banking record must carry the verified BVN.
      if (a.bvn !== bvn) continue;
      const masked = maskAccountNumber(a.accountNumber);
      const row = await this.prisma.customerAccount.upsert({
        where: { customerId_accountNumberMasked_productName: { customerId: app.customerId!, accountNumberMasked: masked, productName: a.productName } },
        create: { customerId: app.customerId!, accountNumberEncrypted: this.crypto.encrypt(a.accountNumber, `acct:${app.customerId}`), accountNumberMasked: masked, accountName: a.accountName, productName: a.productName, status: a.status, source: 'EXISTING', openedAt: new Date(a.openedAt), verifiedAt: new Date() },
        update: { status: a.status, verifiedAt: new Date() },
      });
      out.push({ id: row.id, account_number: masked, account_name: a.accountName, product: a.productName, status: a.status, eligible: a.status === 'ACTIVE', ineligible_reason: a.status === 'ACTIVE' ? null : 'This account cannot be used for repayments.' });
    }
    return { accounts: out, can_open_account: true };
  }

  async selectAccount(applicationId: string, body: unknown, req: AuthedRequest) {
    const { account_id } = z.object({ account_id: z.string().uuid() }).strict().parse(body);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (app.status !== 'ACCOUNT_VERIFICATION_PENDING') throw new AppError('INVALID_STATE');
      const acct = await tx.customerAccount.findFirst({ where: { id: account_id, customerId: app.customerId! } });
      if (!acct || acct.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ELIGIBLE');
      await this.state.transitionApplication(tx, app, 'ACCOUNT_VERIFIED', req.actor, { data: { selectedAccountId: acct.id } });
      await this.audit.record(req.actor, { action: 'customer.account_selected', resourceType: 'APPLICATION', resourceId: applicationId, after: { account: acct.accountNumberMasked } }, tx);
      await this.applyPrefilledIncome(tx, applicationId, app.checkoutSessionId, SYSTEM_ACTOR);
    });
    return this.view(applicationId, req);
  }

  // ---- Account opening ----------------------------------------------------------------

  /** Contact details for account opening: merchant-provided values, falling back to the order. */
  private async accountOpeningPrefill(app: FinancingApplication) {
    const pre = await this.prefillFor(app.checkoutSessionId);
    const order = await this.prisma.merchantOrder.findUnique({ where: { id: app.orderId }, select: { customerEmail: true, customerPhone: true } });
    const out: { email?: string; phone?: string; address?: { line1: string; city: string; state: string } } = {};
    const email = pre.email ?? order?.customerEmail ?? undefined;
    const phone = pre.phone ?? order?.customerPhone ?? undefined;
    if (email) out.email = email;
    if (phone) out.phone = phone;
    if (pre.address) out.address = pre.address;
    return out;
  }

  async startAccountOpening(applicationId: string, req: AuthedRequest) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (!['ACCOUNT_VERIFICATION_PENDING', 'ACCOUNT_OPENING_PENDING'].includes(app.status)) throw new AppError('INVALID_STATE');
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } });
    const correlationRef = `AO-${randomToken('', 16)}`;
    const nonce = randomToken('', 24);
    const state = signStateToken({ ref: correlationRef, app: app.id, nonce }, this.config.STATE_TOKEN_KEY, 24 * 3600);
    const returnUrl = `${this.config.CHECKOUT_BASE_URL}/c/${app.checkoutSessionId}/account-opening/return?state=${encodeURIComponent(state)}`;
    const prefill = await this.accountOpeningPrefill(app);
    const { redirectUrl } = await this.providers.call(app.environment, 'ACCOUNT_OPENING', 'create_session', this.callCtx(app, req), () =>
      this.providers.for(app.environment).accountOpening.createSession({ correlationRef, returnUrl, firstName: customer.firstName, lastName: customer.lastName, prefill }, this.callCtx(app, req)),
    );
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      await tx.accountOpeningRequest.updateMany({ where: { applicationId, status: { in: ['INITIATED', 'REDIRECTED'] } }, data: { status: 'EXPIRED' } });
      await tx.accountOpeningRequest.create({ data: { applicationId, correlationRef, status: 'REDIRECTED', nonceHash: sha256Hex(nonce), expiresAt: new Date(Date.now() + 24 * 3600_000), redirectedAt: new Date() } });
      if (locked.status === 'ACCOUNT_VERIFICATION_PENDING') await this.state.transitionApplication(tx, locked, 'ACCOUNT_OPENING_PENDING', req.actor);
      await this.notifyCustomer(tx, locked, 'ACCOUNT_OPENING_PENDING');
    });
    return { redirect_url: redirectUrl };
  }

  /** Customer browser return. The redirect itself proves nothing: we verify server-side with the provider. */
  async completeAccountOpening(applicationId: string, body: unknown, req: AuthedRequest) {
    const { state } = z.object({ state: z.string().max(2000) }).strict().parse(body);
    const data = verifyStateToken<{ ref: string; app: string; nonce: string }>(state, this.config.STATE_TOKEN_KEY);
    if (!data || data.app !== applicationId) throw new AppError('ACCOUNT_OPENING_INCOMPLETE');
    const reqRow = await this.prisma.accountOpeningRequest.findUnique({ where: { correlationRef: data.ref } });
    if (!reqRow || reqRow.applicationId !== applicationId || !safeEqual(reqRow.nonceHash, sha256Hex(data.nonce))) throw new AppError('ACCOUNT_OPENING_INCOMPLETE');
    await this.verifyOpenedAccount(reqRow.correlationRef, req.actor, req.correlationId);
    return this.view(applicationId, req);
  }

  /** Authenticated server-to-server callback from the account opening platform. */
  async accountOpeningCallback(rawBody: Buffer | undefined, signature: string | undefined, actor: Actor) {
    if (!rawBody || !signature || !safeEqual(signature, hmacSha256Hex(this.config.INTERNAL_CALLBACK_SECRET, rawBody))) throw new AppError('UNAUTHENTICATED');
    const { correlation_ref } = z.object({ correlation_ref: z.string().max(80), status: z.string().optional() }).parse(JSON.parse(rawBody.toString('utf8')));
    const row = await this.prisma.accountOpeningRequest.findUnique({ where: { correlationRef: correlation_ref } });
    if (!row) throw new AppError('NOT_FOUND');
    if (row.status === 'REDIRECTED') await this.prisma.accountOpeningRequest.update({ where: { id: row.id }, data: { status: 'CALLBACK_RECEIVED', callbackAt: new Date() } });
    await this.verifyOpenedAccount(correlation_ref, actor, 'callback').catch((e) => {
      if (!(e instanceof AppError && e.code === 'ACCOUNT_OPENING_INCOMPLETE')) throw e;
    });
    return { received: true };
  }

  async verifyOpenedAccount(correlationRef: string, actor: Actor, correlationId: string) {
    const row = await this.prisma.accountOpeningRequest.findUniqueOrThrow({ where: { correlationRef } });
    if (row.status === 'VERIFIED') return;
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: row.applicationId } });
    const callCtx = { correlationId, applicationReference: app.reference, applicationId: app.id };
    const providers = this.providers.for(app.environment);
    const result = await this.providers.call(app.environment, 'ACCOUNT_OPENING', 'get_result', callCtx, () => providers.accountOpening.getResult(correlationRef, callCtx));
    if (result.status !== 'COMPLETED') throw new AppError('ACCOUNT_OPENING_INCOMPLETE');
    const account = await this.providers.call(app.environment, 'ALTBANK', 'get_account', callCtx, () => providers.bankAccounts.getAccount(result.accountNumber, callCtx));
    const bvn = await this.customerBvn(app.customerId!);
    if (!account || account.bvn !== bvn || account.status !== 'ACTIVE') {
      await this.prisma.accountOpeningRequest.update({ where: { id: row.id }, data: { status: 'FAILED', failureCode: 'ACCOUNT_OWNERSHIP_NOT_VERIFIED' } });
      await this.prisma.$transaction((tx) =>
        this.ctx.raiseException(tx, { code: 'ACCOUNT_NOT_ELIGIBLE', category: 'ACCOUNT_OPENING', application: app, severity: 'MEDIUM', responsibleTeam: 'OPERATIONS', retryEligible: true, detail: 'Newly opened account could not be verified against the customer BVN.' }, actor),
      );
      throw new AppError('ACCOUNT_NOT_ELIGIBLE');
    }
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, app.id);
      const masked = maskAccountNumber(account.accountNumber);
      const acct = await tx.customerAccount.upsert({
        where: { customerId_accountNumberMasked_productName: { customerId: locked.customerId!, accountNumberMasked: masked, productName: account.productName } },
        create: { customerId: locked.customerId!, accountNumberEncrypted: this.crypto.encrypt(account.accountNumber, `acct:${locked.customerId}`), accountNumberMasked: masked, accountName: account.accountName, productName: account.productName, status: account.status, source: 'NEWLY_OPENED', openedAt: new Date(account.openedAt), verifiedAt: new Date() },
        update: { status: account.status, verifiedAt: new Date() },
      });
      await tx.accountOpeningRequest.update({ where: { id: row.id }, data: { status: 'VERIFIED', verifiedAccountId: acct.id, verifiedAt: new Date() } });
      if (locked.status === 'ACCOUNT_OPENING_PENDING' || locked.status === 'ACCOUNT_VERIFICATION_PENDING') {
        await this.state.transitionApplication(tx, locked, 'ACCOUNT_VERIFIED', actor, { data: { selectedAccountId: acct.id }, reason: 'NEW_ACCOUNT_VERIFIED' });
        await this.applyPrefilledIncome(tx, locked.id, locked.checkoutSessionId, SYSTEM_ACTOR);
      }
      await this.audit.record(actor, { action: 'customer.account_opening_verified', resourceType: 'APPLICATION', resourceId: app.id, after: { account: masked } }, tx);
    });
  }

  async setIncomeProfile(applicationId: string, body: unknown, req: AuthedRequest) {
    const { income_profile } = z.object({ income_profile: z.enum(['SALARY_EARNER', 'BUSINESS_OWNER']) }).strict().parse(body);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (!['ACCOUNT_VERIFIED', 'STATEMENT_PENDING'].includes(app.status)) throw new AppError('INVALID_STATE');
      if (app.status === 'ACCOUNT_VERIFIED') await this.state.transitionApplication(tx, app, 'STATEMENT_PENDING', req.actor, { data: { incomeProfile: income_profile } });
      else await tx.financingApplication.update({ where: { id: app.id }, data: { incomeProfile: income_profile } });
    });
    return this.view(applicationId, req);
  }

  async cancelByCustomer(applicationId: string, req: AuthedRequest) {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const { canTransition } = await import('@araf/business-rules');
      if (!canTransition('APPLICATION', app.status, 'CANCELLED') || ['VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED'].includes(app.status)) throw new AppError('INVALID_STATE');
      await this.state.transitionApplication(tx, app, 'CANCELLED', req.actor, { reason: 'CUSTOMER_CANCELLED' });
      await tx.exposureReservation.updateMany({ where: { applicationId, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
      await tx.financingOffer.updateMany({ where: { applicationId, status: 'PRESENTED' }, data: { status: 'WITHDRAWN' } });
      await tx.checkoutSession.update({ where: { id: app.checkoutSessionId }, data: { status: 'CANCELLED' } });
      await tx.cancellationRequest.create({ data: { applicationId, initiatedBy: 'CUSTOMER', stage: app.status, reason: 'Customer cancelled', status: 'COMPLETED', requiresReversal: false } });
      await this.emitMerchant(tx, app, 'application.cancelled');
      await this.arafReports.record(tx, app, 'APPLICATION_CANCELLED', { reason: 'CUSTOMER_CANCELLED' });
    });
    return this.view(applicationId, req);
  }

  /** Revised carts: reuse still-valid credit assessment, account and analysis from the superseded application. */
  private async tryReuseAssessments(app: FinancingApplication, req: AuthedRequest): Promise<boolean> {
    const prev = await this.prisma.financingApplication.findUnique({ where: { id: app.revisesApplicationId! } });
    if (!prev || prev.customerId !== app.customerId || !prev.selectedAccountId || !prev.incomeProfile) return false;
    const credit = await this.prisma.creditAssessment.findFirst({ where: { applicationId: prev.id, status: 'COMPLETED', outcome: 'PROCEED', validUntil: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    const analysis = await this.prisma.statementAnalysisResult.findFirst({ where: { applicationId: prev.id }, orderBy: { createdAt: 'desc' } });
    if (!credit || !analysis) return false;
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, app.id);
      const { id: _cid, createdAt: _c, applicationId: _a, ...creditRest } = credit;
      await tx.creditAssessment.create({ data: { ...creditRest, applicationId: app.id, policyVersionId: locked.creditPolicyVersionId } });
      const job = await tx.statementAnalysisJob.findUniqueOrThrow({ where: { id: analysis.jobId } });
      const newJob = await tx.statementAnalysisJob.create({ data: { applicationId: app.id, connectionId: job.connectionId, provider: job.provider, providerJobRef: job.providerJobRef, status: 'COMPLETED', submittedAt: job.submittedAt, completedAt: job.completedAt } });
      const { id: _rid, jobId: _j, applicationId: _ra, createdAt: _rc, ...resultRest } = analysis;
      // Encrypted fields are bound (AAD) to their application: re-encrypt under the new application.
      const credits = this.crypto.decryptJson<unknown>(analysis.salaryCreditsEncrypted, `analysis:${prev.id}`);
      await tx.statementAnalysisResult.create({ data: { ...resultRest, salaryCreditsEncrypted: this.crypto.encryptJson(credits, `analysis:${app.id}`), jobId: newJob.id, applicationId: app.id } });
      await tx.financingApplication.update({ where: { id: app.id }, data: { selectedAccountId: prev.selectedAccountId, incomeProfile: prev.incomeProfile } });
      await this.state.transitionApplication(tx, locked, 'ELIGIBLE', req.actor, { reason: 'REVISED_CART_REUSED_ASSESSMENTS', metadata: { revises: prev.reference } });
    });
    return true;
  }

  // ---- Customer view --------------------------------------------------------------------

  async view(applicationId: string, req: AuthedRequest) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const authenticated = req.customer?.authenticated ?? false;
    const status = customerStatus(app.status);
    const base = {
      application_reference: app.reference,
      state: app.status,
      status,
      authenticated,
      needs_reauthentication: !authenticated && !['CREATED', 'IDENTITY_PENDING'].includes(app.status),
      sandbox: app.environment === 'SANDBOX',
    };
    if (!authenticated) return base;
    const [account, review, connections, jobs, offers, docs, mandate, payment, release, fulfilment, exception, assessment, idv] = await Promise.all([
      app.selectedAccountId ? this.prisma.customerAccount.findUnique({ where: { id: app.selectedAccountId } }) : null,
      this.prisma.enhancedReview.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.statementConnection.findMany({ where: { applicationId }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.statementAnalysisJob.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.financingOffer.findMany({ where: { applicationId, status: { in: ['PRESENTED', 'ACCEPTED'] } }, include: { instalments: { orderBy: { number: 'asc' } } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.financingDocument.findMany({ where: { applicationId, status: { not: 'VOID' } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.repaymentMandate.findUnique({ where: { applicationId } }),
      this.prisma.vendorPaymentInstruction.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.releaseAuthorization.findUnique({ where: { applicationId } }),
      this.prisma.fulfilmentRecord.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.operationalException.findFirst({ where: { applicationId, status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.affordabilityAssessment.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.identityVerification.findFirst({ where: { applicationId, status: 'VERIFIED' }, orderBy: { createdAt: 'desc' } }),
    ]);
    const customer = app.customerId ? await this.prisma.customer.findUnique({ where: { id: app.customerId } }) : null;
    const session = await this.prisma.checkoutSession.findUniqueOrThrow({ where: { id: app.checkoutSessionId } });
    const accepted = offers.find((o) => o.status === 'ACCEPTED');
    const presented = offers.find((o) => o.status === 'PRESENTED');
    const presentOffer = (o: (typeof offers)[number]) => ({
      id: o.id,
      reference: o.reference,
      status: o.status,
      purchase_amount: n(o.purchaseAmountKobo),
      financing_amount: n(o.financingAmountKobo),
      contribution: n(o.contributionKobo),
      tenor_months: o.tenorMonths,
      annual_profit_rate_percent: o.annualProfitRateBps / 100,
      markup_percent_total: (o.annualProfitRateBps * o.tenorMonths) / 1200,
      profit: n(o.profitKobo),
      deferred_sale_price: n(o.deferredSalePriceKobo),
      monthly_repayment: n(o.monthlyRepaymentKobo),
      fees: n(o.feesKobo),
      expires_at: o.expiresAt,
      terms_version: o.termsVersion,
      schedule: o.instalments.map((i) => ({ number: i.number, due_date: i.dueDate, amount: n(i.amountKobo) })),
    });
    // The Bank's question when it asked for more information (shown only to the verified customer).
    const infoRequest =
      app.status === 'ADDITIONAL_INFORMATION_REQUIRED'
        ? await this.prisma.arafStatusEvent.findFirst({ where: { applicationId: app.id, stage: 'INFO_REQUESTED', outcome: 'APPLIED' }, orderBy: { sequence: 'desc' }, select: { note: true, occurredAt: true } })
        : null;
    return {
      ...base,
      information_request: infoRequest ? { question: infoRequest.note ?? null, requested_at: infoRequest.occurredAt } : null,
      customer: customer ? { first_name: customer.firstName, bvn: `•••••••${customer.bvnLast4}`, phone: idv?.phoneMasked } : null,
      income_profile: app.incomeProfile,
      account: account ? { id: account.id, account_number: account.accountNumberMasked, account_name: account.accountName, product: account.productName, source: account.source } : null,
      enhanced_review: review ? { status: review.status, queue: review.queue, clarification_note: review.clarificationNote, requested_fields: review.requestedFields } : null,
      statement: {
        required_months: app.incomeProfile === 'BUSINESS_OWNER' ? 12 : 6,
        connections: connections.map((c) => ({ id: c.id, channel: c.channel, status: c.status, findings: c.validationFindings, failure: c.failureCode })),
        analysis_status: jobs?.status ?? null,
      },
      eligibility: assessment
        ? {
            outcome: assessment.outcome,
            max_eligible_amount: n(assessment.maxEligibleKobo),
            reasons: assessment.reasons.filter((r) => ['CART_REVISION_REQUIRED', 'BUSINESS_OWNER_MANUAL_REVIEW', 'PARTIAL_FINANCING', 'EQUITY_REQUIRED'].includes(r)),
          }
        : null,
      offer: accepted ? presentOffer(accepted) : presented ? presentOffer(presented) : null,
      // Equity is paid to the merchant (not the Bank) once the Bank approves; the customer returns to the merchant to pay.
      equity: { ...equityView(app), from_merchant: await this.equityFromMerchant(app), purchase_amount: n(app.purchaseAmountKobo), financed_amount: n(app.purchaseAmountKobo - app.contributionAmountKobo), pay_url: equityView(app).payable ? session.returnUrl : null },
      annual_profit_rate_percent: app.annualProfitRateBps / 100,
      documents: docs.map((d) => ({ id: d.id, type: d.docType, version: d.version, status: d.status, signed_at: d.signedAt })),
      mandate: mandate ? { status: mandate.status, reference: mandate.mandateReference, failure: mandate.failureCode } : null,
      repayment_card: await this.repaymentCardView(app.id),
      vendor_payment: payment ? { status: payment.status, confirmed_at: payment.confirmedAt, simulated: payment.isSimulated } : null,
      release: release ? { status: release.status, reference: release.reference, authorized_at: release.authorizedAt } : null,
      fulfilment: fulfilment.map((f) => ({ status: f.status, at: f.createdAt, tracking_reference: f.trackingReference, carrier: f.carrier })),
      exception: exception ? { message: exception.customerMessage } : null,
      contact_window_hours: app.incomeProfile === 'BUSINESS_OWNER' ? { min: 24, max: 48 } : null,
    };
  }
}
