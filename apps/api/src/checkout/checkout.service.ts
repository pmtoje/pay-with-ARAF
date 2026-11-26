import { Inject, Injectable } from '@nestjs/common';
import { validateCart, type CartLine } from '@araf/business-rules';
import { randomToken, sha256Hex } from '@araf/security';
import { createCheckoutSessionSchema } from '@araf/types';
import type { Environment } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError, fail } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AuditService, ReferenceService, StateService, SYSTEM_ACTOR, toJsonRaw, type Actor } from '../common/core.services';
import { AppContextService } from '../applications/app-context.service';
import { CryptoService } from '../common/crypto.service';
import { merchantTimeline, n, presentMerchantApplication } from '../applications/presenters';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ApiContext } from '../auth/auth.guard';

const REVISABLE_STATES = [
  'CREATED', 'IDENTITY_PENDING', 'IDENTITY_VERIFIED', 'CREDIT_CHECK_PENDING', 'CREDIT_CHECK_COMPLETED', 'ENHANCED_REVIEW_REQUIRED',
  'ENHANCED_REVIEW_PENDING', 'ENHANCED_REVIEW_CLEARED', 'ACCOUNT_VERIFICATION_PENDING', 'ACCOUNT_OPENING_PENDING', 'ACCOUNT_VERIFIED',
  'STATEMENT_PENDING', 'STATEMENT_RECEIVED', 'STATEMENT_VALIDATION_PENDING', 'STATEMENT_ANALYSIS_PENDING', 'STATEMENT_ANALYSIS_COMPLETED',
  'AFFORDABILITY_REVIEW_REQUIRED', 'ELIGIBLE', 'OFFER_PRESENTED',
] as const;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly ctx: AppContextService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async createSession(api: ApiContext, body: unknown, actor: Actor) {
    const input = createCheckoutSessionSchema.parse(body);
    const env = api.environment;
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: api.partnerId } });
    const config = await this.ctx.partnerConfig(api.partnerId);

    // Return / cancel URLs must be on the partner's approved origins (prevents open redirects).
    const origins = await this.prisma.partnerDomain.findMany({ where: { partnerId: api.partnerId, environment: env, kind: 'RETURN_URL_ORIGIN', approved: true } });
    for (const u of [input.return_url, input.cancel_url]) {
      const url = new URL(u);
      if (!origins.some((o) => o.value === url.origin)) throw new AppError('RETURN_URL_NOT_APPROVED', { url: url.origin });
      if (url.protocol !== 'https:' && !this.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS) throw new AppError('RETURN_URL_NOT_APPROVED');
    }

    // Vendors must belong to this partner, be approved, and have an active verified settlement account.
    const vendorRefs = [...new Set(input.items.map((i) => i.vendor_reference))];
    const vendors = await this.prisma.vendor.findMany({
      where: { partnerId: api.partnerId, environment: env, vendorReference: { in: vendorRefs } },
      include: { settlementAccounts: { where: { status: 'ACTIVE', verificationStatus: 'VERIFIED' } } },
    });
    for (const ref of vendorRefs) {
      const v = vendors.find((x) => x.vendorReference === ref);
      if (!v || v.status !== 'APPROVED' || v.settlementAccounts.length === 0) throw new AppError('VENDOR_NOT_ELIGIBLE', { vendor_reference: ref });
    }
    for (const item of input.items) {
      const v = vendors.find((x) => x.vendorReference === item.vendor_reference)!;
      if (v.categories.length && !v.categories.includes(item.category.toLowerCase())) {
        throw new AppError('CART_INVALID', { errors: ['CATEGORY_NOT_PERMITTED_FOR_VENDOR'], sku: item.sku });
      }
    }

    const lines: CartLine[] = input.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitAmount: BigInt(i.unit_amount),
      category: i.category.toLowerCase(),
      vendorReference: i.vendor_reference,
    }));
    const errors = validateCart(lines, BigInt(input.amount), {
      eligibleCategories: config.eligibleCategories,
      minAmount: config.minTransactionKobo,
      maxAmount: config.maxTransactionKobo,
      allowMultipleVendors: config.allowMultipleVendors,
    });
    if (errors.length) throw new AppError('CART_INVALID', { errors });

    const cartSnapshot = {
      merchant_order_reference: input.merchant_order_reference,
      currency: input.currency,
      amount: input.amount,
      items: input.items.map((i) => ({ ...i, category: i.category.toLowerCase(), line_amount: i.unit_amount * i.quantity })),
    };
    const cartHash = sha256Hex(JSON.stringify(cartSnapshot));
    const policyVersion = await this.ctx.activePolicyVersion();
    const expiresAt = new Date(Date.now() + config.applicationExpiryMinutes * 60_000);
    const sessionId = randomToken(env === 'SANDBOX' ? 'cs_test_' : 'cs_live_', 24);
    const reference = await this.refs.next('ARAF', { yearly: true });

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialise per (partner, order) to make the duplicate-checkout check race free.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${api.partnerId}:${env}:${input.merchant_order_reference}`);
      let order = await tx.merchantOrder.findUnique({
        where: { partnerId_environment_merchantOrderReference: { partnerId: api.partnerId, environment: env, merchantOrderReference: input.merchant_order_reference } },
        include: { checkoutSessions: { include: { application: true } } },
      });
      let revises: { sessionId: string; applicationId: string } | null = null;
      if (order) {
        const live = order.checkoutSessions.filter((s) => ['CREATED', 'OPEN'].includes(s.status) && s.expiresAt > new Date() && s.application && !['DECLINED', 'CANCELLED', 'EXPIRED'].includes(s.application.status));
        const progressed = order.checkoutSessions.find((s) => s.application && !REVISABLE_STATES.includes(s.application.status as never) && !['DECLINED', 'CANCELLED', 'EXPIRED'].includes(s.application.status));
        if (progressed) throw new AppError('DUPLICATE_CHECKOUT', { application_reference: progressed.application!.reference }, 'A financing application for this order has already been submitted.');
        if (input.revises_session_id) {
          const target = live.find((s) => s.id === input.revises_session_id);
          if (!target) throw new AppError('INVALID_STATE', undefined, 'revises_session_id must reference an active session for this order.');
          revises = { sessionId: target.id, applicationId: target.application!.id };
        } else if (live.length) {
          throw new AppError('DUPLICATE_CHECKOUT', { session_id: live[0].id });
        }
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        await tx.merchantOrder.update({ where: { id: order.id }, data: { amountKobo: BigInt(input.amount), customerEmail: input.customer.email, customerPhone: input.customer.phone, status: 'FINANCING_IN_PROGRESS' } });
      } else {
        if (input.revises_session_id) throw new AppError('INVALID_STATE');
        order = await tx.merchantOrder.create({
          data: { partnerId: api.partnerId, environment: env, merchantOrderReference: input.merchant_order_reference, amountKobo: BigInt(input.amount), customerEmail: input.customer.email, customerPhone: input.customer.phone, status: 'FINANCING_IN_PROGRESS' },
          include: { checkoutSessions: { include: { application: true } } },
        });
      }
      await tx.orderItem.createMany({
        data: lines.map((l) => ({
          orderId: order!.id,
          sku: l.sku,
          name: l.name,
          quantity: l.quantity,
          unitAmountKobo: l.unitAmount,
          lineAmountKobo: l.unitAmount * BigInt(l.quantity),
          category: l.category,
          vendorId: vendors.find((v) => v.vendorReference === l.vendorReference)!.id,
        })),
      });
      const session = await tx.checkoutSession.create({
        data: {
          id: sessionId,
          partnerId: api.partnerId,
          environment: env,
          orderId: order.id,
          status: 'CREATED',
          amountKobo: BigInt(input.amount),
          cartSnapshot: toJsonRaw(cartSnapshot),
          cartHash,
          returnUrl: input.return_url,
          cancelUrl: input.cancel_url,
          revisesSessionId: revises?.sessionId,
          expiresAt,
        },
      });
      // Details the merchant already has: encrypted (bound to this session) and never returned to it.
      const given = Object.fromEntries(Object.entries(input.customer ?? {}).filter(([, v]) => v !== undefined && v !== ''));
      let prefill: Record<string, unknown> | null = Object.keys(given).length ? given : null;
      if (!prefill && revises) {
        const old = await tx.checkoutSession.findUniqueOrThrow({ where: { id: revises.sessionId }, select: { customerPrefillEncrypted: true } });
        if (old.customerPrefillEncrypted) prefill = this.crypto.decryptJson<Record<string, unknown>>(old.customerPrefillEncrypted, `prefill:${revises.sessionId}`);
      }
      if (prefill) await tx.checkoutSession.update({ where: { id: session.id }, data: { customerPrefillEncrypted: this.crypto.encryptJson(prefill, `prefill:${session.id}`) } });
      const app = await tx.financingApplication.create({
        data: {
          reference,
          partnerId: api.partnerId,
          environment: env,
          checkoutSessionId: session.id,
          orderId: order.id,
          status: 'CREATED',
          purchaseAmountKobo: BigInt(input.amount),
          vendorId: vendors[0].id,
          creditPolicyVersionId: policyVersion.id,
          // Product pricing is fixed for the life of the application.
          annualProfitRateBps: config.annualProfitRateBps,
          revisesApplicationId: revises?.applicationId,
          expiresAt,
        },
      });
      await tx.stateTransition.create({ data: { applicationId: app.id, machine: 'APPLICATION', entityId: app.id, fromState: null, toState: 'CREATED', actorType: actor.type, actorId: actor.id } });
      if (revises) {
        await tx.checkoutSession.update({ where: { id: revises.sessionId }, data: { status: 'SUPERSEDED', supersededById: session.id } });
        const old = await tx.financingApplication.findUniqueOrThrow({ where: { id: revises.applicationId } });
        await this.state.transitionApplication(tx, old, 'CANCELLED', actor, { reason: 'SUPERSEDED_BY_REVISED_CART' });
        await tx.exposureReservation.updateMany({ where: { applicationId: old.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
      }
      await this.webhooks.emit(tx, {
        partnerId: api.partnerId,
        environment: env,
        type: 'application.created',
        applicationReference: reference,
        merchantOrderReference: input.merchant_order_reference,
        resourceVersion: 0,
        data: { status: 'CUSTOMER_ACTION_REQUIRED', amount: input.amount, currency: 'NGN', checkout_session_id: session.id },
      });
      await this.notifications.enqueue(tx, {
        environment: env, audience: 'PARTNER', channel: 'IN_APP', templateCode: 'PARTNER_NEW_APPLICATION', destination: api.partnerId, partnerId: api.partnerId,
        applicationId: app.id, applicationReference: reference, vars: { reference, order: input.merchant_order_reference },
      });
      await this.audit.record(actor, { action: 'checkout.session_created', resourceType: 'CHECKOUT_SESSION', resourceId: session.id, partnerId: api.partnerId, after: { reference, amount: input.amount, order: input.merchant_order_reference, revises: revises?.sessionId } }, tx);
      return { session, app };
    });

    return {
      status: 201,
      body: {
        object: 'checkout_session',
        session_id: result.session.id,
        application_reference: result.app.reference,
        checkout_url: `${this.config.CHECKOUT_BASE_URL}/c/${result.session.id}`,
        status: result.session.status,
        amount: input.amount,
        currency: 'NGN',
        expires_at: result.session.expiresAt.toISOString(),
        livemode: env === 'PRODUCTION',
        partner: { id: partner.id, name: partner.tradingName },
      },
    };
  }

  // ---- Tenant-scoped reads (every query filters by partnerId AND environment) ------------

  async getSession(api: ApiContext, id: string) {
    const s = await this.prisma.checkoutSession.findFirst({ where: { id, partnerId: api.partnerId, environment: api.environment }, include: { application: true, order: true } });
    if (!s) throw new AppError('NOT_FOUND');
    return {
      object: 'checkout_session',
      session_id: s.id,
      status: s.status,
      application_reference: s.application?.reference,
      application_status: s.application ? presentMerchantApplication(s.application, { merchantOrderReference: s.order.merchantOrderReference, checkoutSessionId: s.id }).status : null,
      merchant_order_reference: s.order.merchantOrderReference,
      amount: n(s.amountKobo),
      currency: s.currency,
      checkout_url: `${this.config.CHECKOUT_BASE_URL}/c/${s.id}`,
      expires_at: s.expiresAt,
      superseded_by: s.supersededById,
    };
  }

  async getApplication(partnerId: string, environment: Environment, reference: string) {
    const app = await this.prisma.financingApplication.findFirst({ where: { reference, partnerId, environment } });
    if (!app) throw new AppError('NOT_FOUND');
    return this.presentForMerchant(app.id);
  }

  async presentForMerchant(applicationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const [order, payment, release, history, fulfilment] = await Promise.all([
      this.prisma.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } }),
      this.prisma.vendorPaymentInstruction.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.releaseAuthorization.findUnique({ where: { applicationId } }),
      this.prisma.stateTransition.findMany({ where: { applicationId, machine: 'APPLICATION' }, orderBy: { createdAt: 'asc' } }),
      this.prisma.fulfilmentRecord.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return presentMerchantApplication(app, {
      merchantOrderReference: order.merchantOrderReference,
      checkoutSessionId: app.checkoutSessionId,
      payment,
      release,
      timeline: merchantTimeline(history),
      fulfilment: fulfilment.map((f) => ({ status: f.status, at: f.createdAt, tracking_reference: f.trackingReference })),
    });
  }

  async getOrder(partnerId: string, environment: Environment, merchantOrderReference: string) {
    const order = await this.prisma.merchantOrder.findUnique({
      where: { partnerId_environment_merchantOrderReference: { partnerId, environment, merchantOrderReference } },
      include: { items: true, checkoutSessions: { include: { application: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!order) throw new AppError('NOT_FOUND');
    const current = order.checkoutSessions.find((s) => s.application)?.application;
    return {
      object: 'order',
      merchant_order_reference: order.merchantOrderReference,
      status: order.status,
      amount: n(order.amountKobo),
      currency: order.currency,
      items: order.items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, unit_amount: n(i.unitAmountKobo), line_amount: n(i.lineAmountKobo), category: i.category })),
      application: current ? await this.presentForMerchant(current.id) : null,
    };
  }

  async getRelease(partnerId: string, environment: Environment, reference: string) {
    const r = await this.prisma.releaseAuthorization.findFirst({ where: { reference, partnerId, environment } });
    if (!r) throw new AppError('NOT_FOUND');
    const [app, order, payment] = await Promise.all([
      this.prisma.financingApplication.findUniqueOrThrow({ where: { id: r.applicationId } }),
      this.prisma.merchantOrder.findUniqueOrThrow({ where: { id: r.orderId } }),
      this.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: r.paymentInstructionId } }),
    ]);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({ where: { id: r.vendorId } });
    return {
      object: 'release_authorization',
      reference: r.reference,
      status: r.status,
      release_authorized: r.status === 'AUTHORIZED',
      application_reference: app.reference,
      merchant_order_reference: order.merchantOrderReference,
      vendor_reference: vendor.vendorReference,
      currency: 'NGN',
      authorized_amount: n(r.authorizedAmountKobo),
      authorized_items: r.authorizedItems,
      payment_reference: payment.reference,
      payment_status: payment.status,
      vendor_payment_amount: n(payment.amountKobo),
      authorized_at: r.authorizedAt,
      suspended_at: r.suspendedAt,
      suspension_reason: r.suspensionReason,
      simulated: r.isSimulated,
      livemode: r.environment === 'PRODUCTION',
    };
  }

  async listSettlements(partnerId: string, environment: Environment, query: { status?: string; limit?: number }) {
    const rows = await this.prisma.vendorPaymentInstruction.findMany({
      where: { partnerId, environment, status: (query.status as never) || undefined },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 50, 200),
    });
    const apps = new Map((await this.prisma.financingApplication.findMany({ where: { id: { in: rows.map((r) => r.applicationId) } }, select: { id: true, reference: true, orderId: true } })).map((a) => [a.id, a]));
    const orders = new Map((await this.prisma.merchantOrder.findMany({ where: { id: { in: [...apps.values()].map((a) => a.orderId) } }, select: { id: true, merchantOrderReference: true } })).map((o) => [o.id, o]));
    const vendors = new Map((await this.prisma.vendor.findMany({ where: { id: { in: rows.map((r) => r.vendorId) } } })).map((v) => [v.id, v]));
    return {
      object: 'list',
      data: rows.map((p) => {
        const app = apps.get(p.applicationId);
        return {
          payment_reference: p.reference,
          application_reference: app?.reference,
          merchant_order_reference: app ? orders.get(app.orderId)?.merchantOrderReference : null,
          vendor_reference: vendors.get(p.vendorId)?.vendorReference,
          vendor_name: vendors.get(p.vendorId)?.name,
          amount: n(p.amountKobo),
          currency: p.currency,
          status: p.status,
          beneficiary_account: p.beneficiaryAccountMasked,
          beneficiary_bank: p.beneficiaryBankName,
          provider_reference: p.providerReference,
          reconciliation_status: p.reconciliationStatus,
          initiated_at: p.initiatedAt,
          confirmed_at: p.confirmedAt,
          simulated: p.isSimulated,
        };
      }),
    };
  }

  async listWebhookEvents(partnerId: string, environment: Environment, query: { type?: string; limit?: number }) {
    const rows = await this.prisma.webhookEvent.findMany({
      where: { partnerId, environment, type: query.type || undefined },
      include: { deliveries: { include: { endpoint: { select: { url: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 50, 200),
    });
    return {
      object: 'list',
      data: rows.map((e) => ({
        id: e.id,
        event: e.type,
        created_at: e.createdAt,
        application_reference: e.applicationRef,
        merchant_order_reference: e.merchantOrderReference,
        payload: e.payload,
        deliveries: e.deliveries.map((d) => ({ id: d.id, endpoint: d.endpoint.url, status: d.status, attempts: d.attemptCount, last_status_code: d.lastStatusCode, last_error: d.lastError, next_attempt_at: d.nextAttemptAt, succeeded_at: d.succeededAt })),
      })),
    };
  }

  async expireStaleSessions(): Promise<number> {
    const stale = await this.prisma.financingApplication.findMany({
      // Applications waiting on the Bank (manual reviews) do not expire through customer inactivity.
      where: { expiresAt: { lt: new Date() }, status: { in: REVISABLE_STATES.filter((s) => s !== 'ENHANCED_REVIEW_PENDING' && s !== 'AFFORDABILITY_REVIEW_REQUIRED') } },
      take: 100,
    });
    for (const app of stale) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, app.id);
        if (!REVISABLE_STATES.includes(locked.status as never) || ['ENHANCED_REVIEW_PENDING', 'AFFORDABILITY_REVIEW_REQUIRED'].includes(locked.status)) return;
        await this.state.transitionApplication(tx, locked, 'EXPIRED', SYSTEM_ACTOR, { reason: 'INACTIVITY_EXPIRY' });
        await tx.checkoutSession.update({ where: { id: locked.checkoutSessionId }, data: { status: 'EXPIRED' } });
        await tx.exposureReservation.updateMany({ where: { applicationId: locked.id, status: 'ACTIVE' }, data: { status: 'EXPIRED', releasedAt: new Date() } });
        await tx.financingOffer.updateMany({ where: { applicationId: locked.id, status: 'PRESENTED' }, data: { status: 'EXPIRED' } });
        const order = await tx.merchantOrder.findUniqueOrThrow({ where: { id: locked.orderId } });
        await this.webhooks.emit(tx, { partnerId: locked.partnerId, environment: locked.environment, type: 'application.expired', applicationReference: locked.reference, merchantOrderReference: order.merchantOrderReference, resourceVersion: locked.version, data: { status: 'EXPIRED' } });
      });
    }
    return stale.length;
  }
}
