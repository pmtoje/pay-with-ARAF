import { Inject, Injectable, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import { z } from 'zod';
import {
  MURABAHA_CONDITIONS,
  PRE_PAYMENT_CONDITIONS,
  PRE_RELEASE_CONDITIONS,
  evaluateReleaseGate,
  evaluateVendorPaymentPreconditions,
  formatNaira,
  EQUITY_PAYABLE_STATES,
  type PaymentStatus as GatePaymentStatus,
} from '@araf/business-rules';
import { ProviderError } from '@araf/integrations';
import { maskPhone, sha256Hex } from '@araf/security';
import { fulfilSchema, deliverSchema, cancelOrderSchema, returnOrderSchema } from '@araf/types';
import type { ApprovalRequest, Environment, FinancingApplication, PaymentStatus, VendorPaymentInstruction } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, ReferenceService, StateService, SYSTEM_ACTOR, toJsonRaw, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { JourneyService } from '../customer/journey.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderSimplePdf } from '../common/pdf';
import { ArafReportingService, WEBHOOK_TO_ARAF_REPORT } from '../araf/araf-reporting.service';
import { FeesService } from '../fees/fees.service';
import type { AuthedRequest } from '../auth/auth.guard';

const LIVE_PAYMENT_STATES: PaymentStatus[] = ['PENDING_APPROVAL', 'INITIATED', 'PROCESSING', 'CONFIRMED', 'UNKNOWN', 'RECONCILIATION_REQUIRED'];

/**
 * Proposed booking sequence (spec route: approval → documentation → mandate → booking → payment).
 * NOTE (documented conflict, DECISIONS.md D-011): a Murabaha structure may require the Bank to
 * acquire the asset BEFORE the receivable is booked. This flag must be set by Shariah governance.
 */
export const BOOKING_BEFORE_VENDOR_PAYMENT = true;

@Injectable()
export class OperationsService implements OnModuleInit {
  private readonly logger = new Logger('Operations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly refs: ReferenceService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly approvals: ApprovalsService,
    @Inject(forwardRef(() => JourneyService)) private readonly journey: JourneyService,
    private readonly notifications: NotificationsService,
    private readonly arafReports: ArafReportingService,
    private readonly fees: FeesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.approvals.register('VENDOR_PAYMENT', {
      onApprove: async (tx, req, checker) => {
        const ins = await tx.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: req.resourceId } });
        if (ins.initiatedById === checker.id) throw new AppError('MAKER_CHECKER_VIOLATION');
        if (ins.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE');
        await this.setPaymentStatus(tx, ins, 'INITIATED', 'APPROVAL', checker, { approvedById: checker.id, approvalId: req.id, initiatedAt: new Date() });
      },
      onReject: async (tx, req, checker) => {
        const ins = await tx.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: req.resourceId } });
        await this.setPaymentStatus(tx, ins, 'NOT_INITIATED', 'APPROVAL', checker, {});
        // A rejected instruction is closed out as FAILED so a corrected instruction can be raised.
        await tx.vendorPaymentInstruction.update({ where: { id: ins.id }, data: { status: 'FAILED', failureReason: `Approval rejected: ${req.checkerComment}` } });
        const app = await this.ctx.lockApplication(tx, ins.applicationId);
        await this.state.transitionApplication(tx, app, 'EXCEPTION', checker, { reason: 'PAYMENT_APPROVAL_REJECTED', data: { exceptionReturnState: 'FINANCING_BOOKED' } });
      },
      afterApprove: async (req) => {
        await this.executePayment(req.resourceId).catch((e) => this.logger.error(`execute payment: ${(e as Error).message}`));
      },
    });
    this.approvals.register('REFUND', {
      onApprove: async (tx, req, checker) => {
        const refund = await tx.refundRecord.findUniqueOrThrow({ where: { id: req.resourceId } });
        await tx.refundRecord.update({ where: { id: refund.id }, data: { status: 'VENDOR_REFUND_PENDING', approvalId: req.id } });
        await this.state.recordTransition(tx, 'REFUND', refund.id, 'REQUESTED', 'APPROVED', checker, refund.applicationId);
        await this.state.recordTransition(tx, 'REFUND', refund.id, 'APPROVED', 'VENDOR_REFUND_PENDING', checker, refund.applicationId);
        const app = await this.ctx.lockApplication(tx, refund.applicationId);
        await this.emit(tx, app, 'refund.initiated', { refund_reference: refund.reference, expected_amount: Number(refund.expectedAmountKobo) });
      },
      onReject: async (tx, req) => {
        await tx.refundRecord.update({ where: { id: req.resourceId }, data: { status: 'REJECTED' } });
      },
    });
  }

  private callCtx(app: FinancingApplication, correlationId = `ops-${Date.now()}`) {
    return { correlationId, applicationReference: app.reference, applicationId: app.id };
  }

  async emit(tx: Tx, app: FinancingApplication, type: Parameters<JourneyService['emitMerchant']>[2], data: Record<string, unknown> = {}) {
    await this.journey.emitMerchant(tx, app, type, data);
    // Execution steps are reported back to ARAF in the same transaction (D-013).
    const reportType = WEBHOOK_TO_ARAF_REPORT[type];
    if (reportType) await this.arafReports.record(tx, app, reportType, data);
  }

  private async conditions(tx: Tx | PrismaService, applicationId: string) {
    return (tx as Tx).contractualCondition.findMany({ where: { applicationId } });
  }

  private async satisfy(tx: Tx, applicationId: string, code: keyof typeof MURABAHA_CONDITIONS, actor: Actor, evidenceRef?: string) {
    await tx.contractualCondition.updateMany({
      where: { applicationId, code, status: 'PENDING' },
      data: { status: 'SATISFIED', satisfiedAt: new Date(), satisfiedById: actor.id ?? actor.type, evidenceRef },
    });
    await this.audit.record(actor, { action: 'condition.satisfied', resourceType: 'APPLICATION', resourceId: applicationId, after: { code, evidenceRef } }, tx);
  }

  // ---- Approval → documentation ---------------------------------------------------------

  private renderDocument(type: string, ctx: { reference: string; partner: string; customer: string; items: string; purchase: bigint; equity: bigint; financing: bigint; ratePa: number; profit: bigint; dsp: bigint; tenor: number; monthly: bigint; sandbox: boolean }): string {
    const k = (v: bigint) => formatNaira(v);
    const banner = ctx.sandbox ? '[SANDBOX — SYNTHETIC DOCUMENT — NOT LEGALLY BINDING]\n\n' : '';
    const draft = '\n\nTEMPLATE STATUS: Proposed wording pending approval by the Bank’s Legal and Shariah governance functions.';
    switch (type) {
      case 'PROMISE_TO_PURCHASE':
        return `${banner}PROMISE TO PURCHASE (WA’D)\nApplication ${ctx.reference}\n\nI, ${ctx.customer}, request The Alternative Bank to purchase the following asset from ${ctx.partner}: ${ctx.items}.\nI undertake that, once the Bank has acquired the asset, I will purchase it from the Bank under a Murabaha sale at a cost of ${k(ctx.financing)} plus a disclosed profit of ${k(ctx.profit)}, a deferred sale price of ${k(ctx.dsp)} payable over ${ctx.tenor} months.${ctx.equity > 0n ? `\nI will pay equity of ${k(ctx.equity)} directly to ${ctx.partner} towards the purchase price of ${k(ctx.purchase)}; the Bank finances only the remaining ${k(ctx.financing)}.` : ''}\nThis promise is not itself a sale contract.${draft}`;
      case 'OFFER_LETTER':
        return `${banner}FINANCING OFFER LETTER\nApplication ${ctx.reference}\n\nFinancing structure: Murabaha (cost-plus sale)\nPurchase price: ${k(ctx.purchase)}\nCustomer equity paid to ${ctx.partner}: ${k(ctx.equity)}\nAmount financed by the Bank (asset cost to the Bank): ${k(ctx.financing)}\nProfit rate: ${ctx.ratePa}% per annum, charged on the financed amount only\nProfit (total, disclosed): ${k(ctx.profit)}\nDeferred sale price: ${k(ctx.dsp)}\nTenor: ${ctx.tenor} months\nMonthly repayment: ${k(ctx.monthly)} (final instalment adjusted to reconcile exactly)\nConditions: signed promise to purchase; active repayment mandate; Bank acquisition of the asset; executed sale agreement.${draft}`;
      case 'VENDOR_INVOICE':
        return `${banner}PROFORMA INVOICE (Buyer: The Alternative Bank)\nRef INV-${ctx.reference}\nSeller: ${ctx.partner}\nItems: ${ctx.items}\nTotal payable by the Bank: ${k(ctx.financing)}\nDelivery: to the Bank’s customer as agent of the Bank, upon written release authorisation.`;
      case 'SALE_AGREEMENT':
        return `${banner}MURABAHA SALE AGREEMENT\nApplication ${ctx.reference}\n\nThe Alternative Bank (Seller) has acquired the asset (${ctx.items}) from ${ctx.partner} at a cost of ${k(ctx.financing)} and hereby sells it to ${ctx.customer} (Buyer).\nDisclosed acquisition cost: ${k(ctx.financing)}${ctx.equity > 0n ? ` (purchase price ${k(ctx.purchase)} less the Buyer's equity of ${k(ctx.equity)} paid to ${ctx.partner})` : ''}\nDisclosed profit: ${k(ctx.profit)}\nDeferred sale price: ${k(ctx.dsp)} payable in ${ctx.tenor} monthly instalments of ${k(ctx.monthly)} (final instalment adjusted).\nOwnership passes to the Buyer on execution of this agreement; the vendor will then be authorised to release the goods.${draft}`;
      default:
        return '';
    }
  }

  private async docContext(tx: Tx, app: FinancingApplication) {
    const [offer, partner, customer, items] = await Promise.all([
      tx.financingOffer.findFirstOrThrow({ where: { applicationId: app.id, status: 'ACCEPTED' } }),
      tx.partner.findUniqueOrThrow({ where: { id: app.partnerId } }),
      tx.customer.findUniqueOrThrow({ where: { id: app.customerId! } }),
      tx.orderItem.findMany({ where: { orderId: app.orderId } }),
    ]);
    return {
      reference: app.reference,
      partner: partner.tradingName,
      customer: `${customer.firstName} ${customer.lastName}`,
      items: items.map((i) => `${i.quantity} × ${i.name}`).join(', '),
      purchase: offer.purchaseAmountKobo,
      equity: offer.contributionKobo,
      financing: offer.financingAmountKobo,
      ratePa: offer.annualProfitRateBps / 100,
      profit: offer.profitKobo,
      dsp: offer.deferredSalePriceKobo,
      tenor: offer.tenorMonths,
      monthly: offer.monthlyRepaymentKobo,
      sandbox: app.environment === 'SANDBOX',
    };
  }

  private async issueDocument(tx: Tx, app: FinancingApplication, docType: string) {
    const content = this.renderDocument(docType, await this.docContext(tx, app));
    return tx.financingDocument.upsert({
      where: { applicationId_docType_version: { applicationId: app.id, docType, version: '1' } },
      create: { applicationId: app.id, docType, version: '1', status: 'ISSUED', contentHash: sha256Hex(content), content },
      update: {},
    });
  }

  async onFinancingApproved(tx: Tx, app: FinancingApplication, actor: Actor) {
    for (const code of PRE_RELEASE_CONDITIONS) {
      await tx.contractualCondition.upsert({
        where: { applicationId_code: { applicationId: app.id, code } },
        create: { applicationId: app.id, code, description: MURABAHA_CONDITIONS[code] },
        update: {},
      });
    }
    await this.issueDocument(tx, app, 'PROMISE_TO_PURCHASE');
    await this.issueDocument(tx, app, 'OFFER_LETTER');
    await this.issueDocument(tx, app, 'VENDOR_INVOICE');
    await tx.repaymentMandate.upsert({ where: { applicationId: app.id }, create: { applicationId: app.id, provider: 'REMITA', status: 'NOT_STARTED' }, update: {} });
    await this.state.transitionApplication(tx, app, 'DOCUMENTATION_PENDING', actor);
    await this.journey.notifyCustomer(tx, app, 'FINANCING_APPROVED');
    if (app.contributionAmountKobo > 0n && !app.contributionVerified) await this.journey.notifyCustomer(tx, app, 'EQUITY_PAYABLE');
  }

  async documentPdf(applicationId: string, documentId: string) {
    const doc = await this.prisma.financingDocument.findFirst({ where: { id: documentId, applicationId } });
    if (!doc) throw new AppError('NOT_FOUND');
    return renderSimplePdf(doc.docType.replace(/_/g, ' '), doc.content.split('\n').flatMap((l) => l.match(/.{1,95}(\s|$)/g)?.map((x) => x.trim()) ?? ['']));
  }

  async requestSigningOtp(applicationId: string, purpose: 'DOCUMENT_SIGNING' | 'SALE_CONTRACT', req: AuthedRequest) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const expected = purpose === 'DOCUMENT_SIGNING' ? 'DOCUMENTATION_PENDING' : 'VENDOR_PAYMENT_CONFIRMED';
    if (app.status !== expected) throw new AppError('INVALID_STATE');
    const idv = await this.prisma.identityVerification.findFirstOrThrow({ where: { applicationId, status: 'VERIFIED' } });
    const phone = this.crypto.decrypt(idv.phoneEncrypted!, `idv:${applicationId}`);
    await this.journey.issueOtp(app, purpose, phone, req);
    return { otp_sent_to: maskPhone(phone) };
  }

  /** Customer e-signs the promise to purchase and offer letter (OTP-confirmed). */
  async signDocuments(applicationId: string, body: unknown, req: AuthedRequest) {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(body);
    const app0 = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app0.status !== 'DOCUMENTATION_PENDING') throw new AppError('INVALID_STATE');
    await this.journey.consumeOtp(app0, 'DOCUMENT_SIGNING', code, req);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (app.status !== 'DOCUMENTATION_PENDING') throw new AppError('INVALID_STATE');
      const evidence = toJsonRaw({ method: 'OTP', ip: req.ip, user_agent: req.headers['user-agent']?.slice(0, 200), at: new Date().toISOString() });
      await tx.financingDocument.updateMany({ where: { applicationId, docType: { in: ['PROMISE_TO_PURCHASE', 'OFFER_LETTER'] }, status: 'ISSUED' }, data: { status: 'SIGNED', signedAt: new Date(), signatureEvidence: evidence } });
      await this.satisfy(tx, applicationId, 'PROMISE_TO_PURCHASE_SIGNED', req.actor, 'PROMISE_TO_PURCHASE v1');
      await this.state.transitionApplication(tx, app, 'MANDATE_PENDING', req.actor);
    });
    return this.journey.view(applicationId, req);
  }

  // ---- Repayment mandate (Remita) --------------------------------------------------------

  async startMandate(applicationId: string, req: AuthedRequest) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'MANDATE_PENDING') throw new AppError('INVALID_STATE');
    const mandate = await this.prisma.repaymentMandate.findUniqueOrThrow({ where: { applicationId } });
    if (mandate.status === 'AWAITING_AUTHORIZATION' && mandate.authorizationUrl) return { authorization_url: mandate.authorizationUrl };
    if (!['NOT_STARTED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(mandate.status)) throw new AppError('INVALID_STATE');
    const [offer, account, customer] = await Promise.all([
      this.prisma.financingOffer.findFirstOrThrow({ where: { applicationId, status: 'ACCEPTED' } }),
      this.prisma.customerAccount.findUniqueOrThrow({ where: { id: app.selectedAccountId! } }),
      this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } }),
    ]);
    const c = this.callCtx(app, req.correlationId);
    const res = await this.providers.call(app.environment, 'REMITA', 'initiate_mandate', c, () =>
      this.providers.for(app.environment).remita.initiate(
        {
          reference: app.reference,
          payerName: `${customer.firstName} ${customer.lastName}`,
          accountNumber: this.crypto.decrypt(account.accountNumberEncrypted, `acct:${account.customerId}`),
          bankCode: '000',
          instalmentAmount: offer.monthlyRepaymentKobo,
          instalments: offer.tenorMonths,
          startDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
          returnUrl: `${this.config.CHECKOUT_BASE_URL}/c/${app.checkoutSessionId}/mandate/return`,
        },
        c,
      ),
    );
    await this.prisma.$transaction(async (tx) => {
      await this.state.recordTransition(tx, 'MANDATE', mandate.id, mandate.status === 'NOT_STARTED' ? 'NOT_STARTED' : mandate.status, 'INITIATED', req.actor, applicationId);
      await this.state.recordTransition(tx, 'MANDATE', mandate.id, 'INITIATED', 'AWAITING_AUTHORIZATION', SYSTEM_ACTOR, applicationId);
      await tx.repaymentMandate.update({ where: { id: mandate.id }, data: { status: 'AWAITING_AUTHORIZATION', mandateReference: res.mandateReference, authorizationUrl: res.authorizationUrl, failureCode: null } });
      await this.journey.recordConsents(applicationId, ['MANDATE'], req, tx);
    });
    return { authorization_url: res.authorizationUrl };
  }

  /** Mandate activation is verified against the provider's authoritative record — never the redirect. */
  async verifyMandate(applicationId: string, actor: Actor, correlationId = `mandate-${Date.now()}`) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const mandate = await this.prisma.repaymentMandate.findUnique({ where: { applicationId } });
    if (!mandate?.mandateReference || mandate.status !== 'AWAITING_AUTHORIZATION') return mandate?.status ?? 'NOT_STARTED';
    const c = this.callCtx(app, correlationId);
    const res = await this.providers.call(app.environment, 'REMITA', 'mandate_status', c, () => this.providers.for(app.environment).remita.getStatus(mandate.mandateReference!, c));
    if (res.status === 'AWAITING_AUTHORIZATION') return res.status;
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      const m = await tx.repaymentMandate.findUniqueOrThrow({ where: { applicationId } });
      if (m.status !== 'AWAITING_AUTHORIZATION') return;
      if (res.status === 'ACTIVE') {
        await tx.repaymentMandate.update({ where: { id: m.id }, data: { status: 'ACTIVE', activatedAt: new Date(), verifiedAt: new Date() } });
        await this.state.recordTransition(tx, 'MANDATE', m.id, 'AWAITING_AUTHORIZATION', 'ACTIVE', actor, applicationId);
        await this.satisfy(tx, applicationId, 'MANDATE_ACTIVE', actor, m.mandateReference ?? undefined);
        await this.ctx.resolveExceptions(tx, applicationId, ['MANDATE_FAILURE'], 'Mandate activated', actor);
        if (locked.status === 'MANDATE_PENDING') await this.state.transitionApplication(tx, locked, 'BOOKING_PENDING', actor);
      } else {
        const status = res.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
        await tx.repaymentMandate.update({ where: { id: m.id }, data: { status: status === 'CANCELLED' ? 'FAILED' : 'FAILED', failureCode: res.failureCode ?? status } });
        await this.state.recordTransition(tx, 'MANDATE', m.id, 'AWAITING_AUTHORIZATION', 'FAILED', actor, applicationId, res.failureCode);
        await this.ctx.raiseException(tx, { code: 'MANDATE_FAILURE', category: 'MANDATE', application: locked, severity: 'MEDIUM', responsibleTeam: 'OPERATIONS', retryEligible: true, detail: `Remita mandate ${status}: ${res.failureCode ?? 'declined by payer'}. Customer may retry.`, customerMessage: 'Your repayment mandate could not be activated. Please try again or contact support.' }, actor);
      }
    });
    return res.status;
  }

  async pollMandates(): Promise<number> {
    const due = await this.prisma.repaymentMandate.findMany({ where: { status: 'AWAITING_AUTHORIZATION' }, take: 20 });
    for (const m of due) await this.verifyMandate(m.applicationId, SYSTEM_ACTOR).catch((e) => this.logger.error(`mandate ${m.id}: ${(e as Error).message}`));
    return due.length;
  }

  // ---- CAD: invoice verification, booking, possession evidence -------------------------

  async verifyInvoice(applicationId: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const doc = await tx.financingDocument.findFirst({ where: { applicationId, docType: 'VENDOR_INVOICE', status: 'ISSUED' } });
      if (!doc) throw new AppError('INVALID_STATE');
      await tx.financingDocument.update({ where: { id: doc.id }, data: { status: 'VERIFIED', signatureEvidence: toJsonRaw({ verified_by: actor.id, at: new Date().toISOString() }) } });
      await this.audit.record(actor, { action: 'cad.invoice_verified', resourceType: 'FINANCING_DOCUMENT', resourceId: doc.id }, tx);
    });
    return { ok: true };
  }

  async requestBooking(applicationId: string, actor: Actor) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'BOOKING_PENDING') throw new AppError('INVALID_STATE');
    const conds = await this.conditions(this.prisma, applicationId);
    const pending = PRE_PAYMENT_CONDITIONS.filter((c) => conds.find((x) => x.code === c)?.status !== 'SATISFIED');
    if (pending.length) throw new AppError('PRECONDITIONS_NOT_MET', { pending });
    const existing = await this.prisma.bookingRecord.findUnique({ where: { applicationId } });
    if (existing?.status === 'BOOKED') throw new AppError('INVALID_STATE');
    const offer = await this.prisma.financingOffer.findFirstOrThrow({ where: { applicationId, status: 'ACCEPTED' } });
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: app.selectedAccountId! } });
    const c = this.callCtx(app);
    const core = this.providers.for(app.environment).coreBanking;
    // Before any re-attempt, reconcile the previous attempt with the authoritative system.
    if (existing && ['FAILED', 'UNKNOWN', 'REQUESTED'].includes(existing.status)) {
      const prior = await this.providers.call(app.environment, 'CORE_BANKING', 'query_booking', c, () => core.queryBooking(existing.idempotencyKey, c));
      if (prior.status === 'BOOKED') return this.completeBooking(applicationId, prior.bookingReference!, actor);
    }
    const attempt = existing ? Number(existing.idempotencyKey.split('-').pop()) + 1 : 1;
    const idempotencyKey = `booking-${applicationId}-${attempt}`;
    const record = await this.prisma.bookingRecord.upsert({
      where: { applicationId },
      create: { applicationId, idempotencyKey, status: 'REQUESTED', arafApprovalReference: app.arafReference, financingAmountKobo: offer.financingAmountKobo, profitKobo: offer.profitKobo, deferredSalePriceKobo: offer.deferredSalePriceKobo, tenorMonths: offer.tenorMonths, requestedById: actor.id, requestedAt: new Date() },
      update: { idempotencyKey, status: 'REQUESTED', failureCode: null, requestedById: actor.id, requestedAt: new Date() },
    });
    await this.audit.record(actor, { action: 'booking.requested', resourceType: 'BOOKING', resourceId: record.id, partnerId: app.partnerId, after: { idempotencyKey } });
    let result;
    try {
      result = await this.providers.call(app.environment, 'CORE_BANKING', 'book_financing', c, () =>
        core.bookFinancing(
          { idempotencyKey, accountNumber: this.crypto.decrypt(account.accountNumberEncrypted, `acct:${account.customerId}`), financingAmount: offer.financingAmountKobo, profitAmount: offer.profitKobo, deferredSalePrice: offer.deferredSalePriceKobo, tenorMonths: offer.tenorMonths, arafReference: app.arafReference ?? '' },
          c,
        ),
      );
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'TIMEOUT') {
        await this.prisma.bookingRecord.update({ where: { id: record.id }, data: { status: 'UNKNOWN' } });
        return { status: 'UNKNOWN', message: 'Booking outcome unknown — it will be reconciled before any retry.' };
      }
      throw e;
    }
    if (result.status === 'BOOKED') return this.completeBooking(applicationId, result.bookingReference, actor);
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      await tx.bookingRecord.update({ where: { id: record.id }, data: { status: 'FAILED', failureCode: result.reason } });
      await this.arafReports.record(tx, locked, 'BOOKING_FAILED', { reason: result.reason });
      await this.state.transitionApplication(tx, locked, 'EXCEPTION', actor, { reason: 'BOOKING_FAILURE', data: { exceptionReturnState: 'BOOKING_PENDING' } });
      await this.ctx.raiseException(tx, { code: 'BOOKING_FAILURE', category: 'BOOKING', application: locked, severity: 'HIGH', responsibleTeam: 'CAD', retryEligible: true, detail: `Core banking rejected booking: ${result.reason}. Vendor payment is blocked.` }, actor);
    });
    return { status: 'FAILED', reason: result.reason };
  }

  private async completeBooking(applicationId: string, bookingReference: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      await tx.bookingRecord.update({ where: { applicationId }, data: { status: 'BOOKED', bookingReference, bookedAt: new Date() } });
      if (locked.status === 'EXCEPTION') await this.state.transitionApplication(tx, locked, 'BOOKING_PENDING', actor, { reason: 'RECONCILED_BOOKING' });
      await this.state.transitionApplication(tx, locked, 'FINANCING_BOOKED', actor);
      await this.ctx.resolveExceptions(tx, applicationId, ['BOOKING_FAILURE'], 'Booking confirmed by core banking', actor);
      await this.emit(tx, locked, 'financing.booked', { booking_reference: bookingReference });
      await this.audit.record(actor, { action: 'booking.confirmed', resourceType: 'APPLICATION', resourceId: applicationId, partnerId: locked.partnerId, after: { bookingReference } }, tx);
    });
    return { status: 'BOOKED', booking_reference: bookingReference };
  }

  async recordPossession(applicationId: string, body: unknown, actor: Actor) {
    const { evidence } = z.object({ evidence: z.string().min(5).max(1000) }).strict().parse(body);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const conds = await tx.contractualCondition.findMany({ where: { applicationId } });
      if (conds.find((c) => c.code === 'ASSET_ACQUIRED')?.status !== 'SATISFIED') throw new AppError('PRECONDITIONS_NOT_MET', { pending: ['ASSET_ACQUIRED'] });
      await this.satisfy(tx, applicationId, 'POSSESSION_EVIDENCED', actor, evidence);
      if (app.status === 'VENDOR_PAYMENT_CONFIRMED') {
        await this.issueDocument(tx, app, 'SALE_AGREEMENT');
        await this.journey.notifyCustomer(tx, app, 'VENDOR_PAYMENT_CONFIRMED');
      }
    });
    return this.evaluateRelease(applicationId, actor);
  }

  /** Customer executes the Murabaha sale ONLY after the Bank has acquired the asset. */
  async signSaleContract(applicationId: string, body: unknown, req: AuthedRequest) {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(body);
    const app0 = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app0.status !== 'VENDOR_PAYMENT_CONFIRMED') throw new AppError('INVALID_STATE');
    const conds = await this.conditions(this.prisma, applicationId);
    const prereq = ['ASSET_ACQUIRED', 'POSSESSION_EVIDENCED'].filter((c) => conds.find((x) => x.code === c)?.status !== 'SATISFIED');
    if (prereq.length) throw new AppError('PRECONDITIONS_NOT_MET', { pending: prereq });
    await this.journey.consumeOtp(app0, 'SALE_CONTRACT', code, req);
    await this.prisma.$transaction(async (tx) => {
      await this.ctx.lockApplication(tx, applicationId);
      const doc = await tx.financingDocument.findFirst({ where: { applicationId, docType: 'SALE_AGREEMENT', status: 'ISSUED' } });
      if (!doc) throw new AppError('INVALID_STATE');
      await tx.financingDocument.update({ where: { id: doc.id }, data: { status: 'SIGNED', signedAt: new Date(), signatureEvidence: toJsonRaw({ method: 'OTP', ip: req.ip, at: new Date().toISOString() }) } });
      await this.satisfy(tx, applicationId, 'COST_AND_PROFIT_DISCLOSED', req.actor, 'SALE_AGREEMENT v1');
      await this.satisfy(tx, applicationId, 'SALE_CONTRACT_EXECUTED', req.actor, 'SALE_AGREEMENT v1');
    });
    await this.evaluateRelease(applicationId, SYSTEM_ACTOR);
    return this.journey.view(applicationId, req);
  }

  // ---- Vendor payment ---------------------------------------------------------------------

  private async beneficiary(app: FinancingApplication) {
    const acct = await this.prisma.vendorSettlementAccount.findFirst({ where: { vendorId: app.vendorId, status: 'ACTIVE', verificationStatus: 'VERIFIED' } });
    return acct;
  }

  async paymentPreconditions(applicationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const [booking, conds, invoice, live, order, acct] = await Promise.all([
      this.prisma.bookingRecord.findUnique({ where: { applicationId } }),
      this.conditions(this.prisma, applicationId),
      this.prisma.financingDocument.findFirst({ where: { applicationId, docType: 'VENDOR_INVOICE' } }),
      this.prisma.vendorPaymentInstruction.findFirst({ where: { applicationId, status: { in: LIVE_PAYMENT_STATES } } }),
      this.prisma.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } }),
      this.beneficiary(app),
    ]);
    return evaluateVendorPaymentPreconditions({
      financingApproved: ['FINANCING_BOOKED', 'BOOKING_PENDING'].includes(app.status) || app.status === 'EXCEPTION',
      bookingConfirmed: booking?.status === 'BOOKED',
      bookingRequiredBeforePayment: BOOKING_BEFORE_VENDOR_PAYMENT,
      beneficiaryVerified: !!acct,
      invoiceApproved: invoice?.status === 'VERIFIED',
      orderValid: !['CANCELLED', 'RETURNED'].includes(order.status),
      prePaymentConditions: PRE_PAYMENT_CONDITIONS.map((code) => ({ code, satisfied: conds.find((c) => c.code === code)?.status === 'SATISFIED' })),
      contribution: { required: app.contributionAmountKobo > 0n, verified: app.contributionVerified },
      existingLivePaymentInstruction: !!live,
      activeHolds: app.holds,
    });
  }

  /** Maker: create the payment instruction. Execution only follows checker approval. */
  async initiatePayment(applicationId: string, actor: Actor) {
    const blockers = await this.paymentPreconditions(applicationId);
    if (blockers.includes('DUPLICATE_PAYMENT_INSTRUCTION')) throw new AppError('DUPLICATE_PAYMENT_ATTEMPT');
    if (blockers.length) throw new AppError('PRECONDITIONS_NOT_MET', { blockers });
    const ins = await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (app.status !== 'FINANCING_BOOKED') throw new AppError('INVALID_STATE');
      const offer = await tx.financingOffer.findFirstOrThrow({ where: { applicationId, status: 'ACCEPTED' } });
      const acct = (await this.beneficiary(app))!;
      const prior = await tx.vendorPaymentInstruction.count({ where: { applicationId } });
      const reference = await this.refs.next('PAY', { tx });
      const created = await tx.vendorPaymentInstruction.create({
        data: {
          reference,
          applicationId,
          partnerId: app.partnerId,
          environment: app.environment,
          idempotencyKey: `vpay-${applicationId}-${prior + 1}`,
          // The Bank pays the vendor the financed cost; any customer contribution is settled separately.
          amountKobo: offer.financingAmountKobo,
          vendorId: app.vendorId,
          settlementAccountId: acct.id,
          beneficiaryName: acct.verifiedName ?? acct.accountName,
          beneficiaryAccountMasked: acct.accountNumberMasked,
          beneficiaryBankName: acct.bankName,
          status: 'PENDING_APPROVAL',
          isSimulated: this.providers.isSimulated(app.environment),
          initiatedById: actor.id!,
        },
      });
      await tx.vendorPaymentEvent.create({ data: { instructionId: created.id, status: 'PENDING_APPROVAL', source: 'INITIATION', amountKobo: created.amountKobo, detail: `Created by ${actor.label}` } });
      await this.state.recordTransition(tx, 'PAYMENT', created.id, 'NOT_INITIATED', 'PENDING_APPROVAL', actor, applicationId);
      await this.approvals.create(tx, { type: 'VENDOR_PAYMENT', resourceType: 'VENDOR_PAYMENT_INSTRUCTION', resourceId: created.id, partnerId: app.partnerId, payload: { amount_kobo: created.amountKobo.toString(), beneficiary: created.beneficiaryAccountMasked, application: app.reference }, summary: `Pay ${formatNaira(created.amountKobo)} to ${created.beneficiaryName} (${created.beneficiaryAccountMasked}) for ${app.reference}` }, actor);
      await this.state.transitionApplication(tx, app, 'VENDOR_PAYMENT_PENDING', actor);
      await this.emit(tx, app, 'vendor.payment_pending', { payment_reference: reference, vendor_payment_amount: Number(created.amountKobo) });
      return created;
    });
    return { id: ins.id, reference: ins.reference, status: ins.status };
  }

  private async setPaymentStatus(tx: Tx, ins: VendorPaymentInstruction, to: PaymentStatus, source: string, actor: Actor, data: Partial<VendorPaymentInstruction>, detail?: string) {
    if (ins.status !== to) await this.state.recordTransition(tx, 'PAYMENT', ins.id, ins.status, to, actor, ins.applicationId, detail);
    // ARAF merchant fee: accrues when the transaction is processed, reverses if the payment is reversed.
    if (to === 'CONFIRMED' && ins.status !== 'CONFIRMED') await this.fees.accrue(tx, await tx.financingApplication.findUniqueOrThrow({ where: { id: ins.applicationId } }));
    if (to === 'REVERSED') await this.fees.reverse(tx, ins.applicationId, 'VENDOR_PAYMENT_REVERSED');
    await tx.vendorPaymentInstruction.update({ where: { id: ins.id }, data: { ...data, status: to } as never });
    await tx.vendorPaymentEvent.create({ data: { instructionId: ins.id, status: to, source, providerReference: data.providerReference ?? ins.providerReference, amountKobo: ins.amountKobo, detail } });
    ins.status = to;
  }

  /** Execute an APPROVED instruction exactly once. A timeout is UNKNOWN — never retried blindly. */
  async executePayment(instructionId: string) {
    const ins = await this.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: instructionId } });
    if (ins.status !== 'INITIATED') return;
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: ins.applicationId } });
    const acct = await this.prisma.vendorSettlementAccount.findUniqueOrThrow({ where: { id: ins.settlementAccountId } });
    const c = this.callCtx(app);
    const payments = this.providers.for(app.environment).payments;
    try {
      const res = await this.providers.call(app.environment, 'PAYMENTS', 'initiate', c, () =>
        payments.initiate(
          { idempotencyKey: ins.idempotencyKey, reference: ins.reference, amount: ins.amountKobo, beneficiary: { bankCode: acct.bankCode, accountNumber: this.crypto.decrypt(acct.accountNumberEncrypted, `settlement:${acct.vendorId}`), accountName: acct.accountName }, narration: `ARAF ${app.reference}` },
          c,
        ),
      );
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: ins.id } });
        await this.setPaymentStatus(tx, fresh, 'PROCESSING', 'INITIATION', SYSTEM_ACTOR, { providerReference: res.providerReference });
      });
      await this.reconcileInstruction(ins.id);
    } catch (e) {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: ins.id } });
        await this.setPaymentStatus(tx, fresh, 'UNKNOWN', 'INITIATION', SYSTEM_ACTOR, {}, `Initiation outcome unknown: ${(e as Error).message}`.slice(0, 300));
        const locked = await this.ctx.lockApplication(tx, app.id);
        await this.ctx.raiseException(tx, { code: 'PAYMENT_STATUS_UNKNOWN', category: 'VENDOR_PAYMENT', application: locked, severity: 'CRITICAL', responsibleTeam: 'SETTLEMENT', retryEligible: false, detail: `Payment ${ins.reference} outcome unknown after initiation error. DO NOT re-initiate; reconcile with the payment system.` }, SYSTEM_ACTOR);
      });
    }
  }

  /** Query the authoritative payment system and apply the result (worker + manual reconciliation). */
  async reconcileInstruction(instructionId: string, actor: Actor = SYSTEM_ACTOR) {
    const ins = await this.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: instructionId } });
    if (!['INITIATED', 'PROCESSING', 'UNKNOWN', 'RECONCILIATION_REQUIRED', 'CONFIRMED'].includes(ins.status)) return ins.status;
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: ins.applicationId } });
    const acct = await this.prisma.vendorSettlementAccount.findUniqueOrThrow({ where: { id: ins.settlementAccountId } });
    const c = this.callCtx(app);
    const q = await this.providers.call(app.environment, 'PAYMENTS', 'query', c, () => this.providers.for(app.environment).payments.query(ins.idempotencyKey, c));
    if (q.status === 'NOT_FOUND') {
      if (ins.status === 'UNKNOWN' && Date.now() - ins.updatedAt.getTime() > 120_000) {
        await this.prisma.$transaction((tx) => this.setPaymentStatus(tx, ins, 'RECONCILIATION_REQUIRED', 'STATUS_QUERY', actor, {}, 'Payment not found at provider'));
      }
      return ins.status;
    }
    if (q.status === 'PROCESSING') return ins.status;
    if (q.status === 'REVERSED' && ins.status === 'CONFIRMED') return this.handleReversal(ins.id, actor);
    if (q.status === 'FAILED') {
      if (ins.status === 'CONFIRMED') return ins.status;
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, app.id);
        await this.setPaymentStatus(tx, ins, 'FAILED', 'STATUS_QUERY', actor, { failureReason: q.failureReason, providerReference: q.providerReference }, q.failureReason);
        await this.state.transitionApplication(tx, locked, 'EXCEPTION', actor, { reason: 'VENDOR_PAYMENT_FAILED', data: { exceptionReturnState: 'FINANCING_BOOKED' } });
        await this.ctx.resolveExceptions(tx, app.id, ['PAYMENT_STATUS_UNKNOWN'], 'Reconciled: payment failed at provider', actor);
        await this.ctx.raiseException(tx, { code: 'PAYMENT_FAILURE', category: 'VENDOR_PAYMENT', application: locked, severity: 'HIGH', responsibleTeam: 'SETTLEMENT', retryEligible: true, detail: `Vendor payment ${ins.reference} failed: ${q.failureReason}. A new instruction requires fresh approval.` }, actor);
        await this.emit(tx, locked, 'vendor.payment_failed', { payment_reference: ins.reference });
      });
      return 'FAILED';
    }
    if (q.status === 'CONFIRMED' && ins.status !== 'CONFIRMED') {
      const expectedAccount = this.crypto.decrypt(acct.accountNumberEncrypted, `settlement:${acct.vendorId}`);
      const mismatch = q.amount !== ins.amountKobo ? 'AMOUNT_MISMATCH' : q.beneficiaryAccountNumber !== expectedAccount ? 'BENEFICIARY_MISMATCH' : null;
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, app.id);
        if (mismatch) {
          await this.setPaymentStatus(tx, ins, 'RECONCILIATION_REQUIRED', 'STATUS_QUERY', actor, { reconciliationStatus: 'DISCREPANCY' }, mismatch);
          await this.ctx.raiseException(tx, { code: 'PAYMENT_STATUS_UNKNOWN', category: 'RECONCILIATION', application: locked, severity: 'CRITICAL', responsibleTeam: 'SETTLEMENT', retryEligible: false, detail: `Provider confirmation does not match instruction: ${mismatch}` }, actor);
          return;
        }
        await this.setPaymentStatus(tx, ins, 'CONFIRMED', 'STATUS_QUERY', actor, { providerReference: q.providerReference, confirmedByAuthoritativeSource: true, confirmedAt: new Date(), reconciliationStatus: 'MATCHED' });
        await this.ctx.resolveExceptions(tx, app.id, ['PAYMENT_STATUS_UNKNOWN'], 'Reconciled: payment confirmed by provider (no re-initiation)', actor);
        await this.state.transitionApplication(tx, locked, 'VENDOR_PAYMENT_CONFIRMED', actor);
        await this.satisfy(tx, app.id, 'ASSET_ACQUIRED', actor, `${ins.reference}/${q.providerReference}`);
        await this.emit(tx, locked, 'vendor.payment_confirmed', { payment_reference: ins.reference, vendor_payment_amount: Number(ins.amountKobo), payment_status: 'CONFIRMED' });
        await this.audit.record(actor, { action: 'payment.confirmed', resourceType: 'VENDOR_PAYMENT_INSTRUCTION', resourceId: ins.id, partnerId: ins.partnerId, after: { providerReference: q.providerReference, simulated: ins.isSimulated } }, tx);
      });
      if (!mismatch) await this.evaluateRelease(app.id, actor);
      return 'CONFIRMED';
    }
    return ins.status;
  }

  async pollPayments(): Promise<number> {
    const rows = await this.prisma.vendorPaymentInstruction.findMany({ where: { status: { in: ['PROCESSING', 'UNKNOWN', 'INITIATED'] } }, take: 25 });
    for (const r of rows) {
      if (r.status === 'INITIATED' && Date.now() - r.updatedAt.getTime() < 30_000) continue;
      if (r.status === 'INITIATED') {
        await this.executePayment(r.id).catch((e) => this.logger.error(`execute ${r.id}: ${(e as Error).message}`));
        continue;
      }
      await this.reconcileInstruction(r.id).catch((e) => this.logger.error(`reconcile ${r.id}: ${(e as Error).message}`));
    }
    return rows.length;
  }

  async handleReversal(instructionId: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const ins = await tx.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: instructionId } });
      if (ins.status !== 'CONFIRMED') return;
      const app = await this.ctx.lockApplication(tx, ins.applicationId);
      await this.setPaymentStatus(tx, ins, 'REVERSED', 'STATUS_QUERY', actor, {}, 'Reversal reported by payment system');
      const release = await tx.releaseAuthorization.findUnique({ where: { applicationId: app.id } });
      if (release && release.status === 'AUTHORIZED') {
        await tx.releaseAuthorization.update({ where: { id: release.id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: 'VENDOR_PAYMENT_REVERSED' } });
        await this.state.recordTransition(tx, 'RELEASE', release.id, 'AUTHORIZED', 'SUSPENDED', actor, app.id, 'VENDOR_PAYMENT_REVERSED');
        await this.emit(tx, app, 'goods.release_suspended', { release_reference: release.reference, status: 'ON_HOLD', release_authorized: false, reason: 'VENDOR_PAYMENT_REVERSED' });
        await this.notifications.enqueue(tx, { environment: app.environment, audience: 'PARTNER', channel: 'IN_APP', templateCode: 'PARTNER_RELEASE_SUSPENDED', destination: app.partnerId, partnerId: app.partnerId, applicationId: app.id, applicationReference: app.reference, vars: { order: app.reference } });
      }
      if (!['GOODS_DISPATCHED', 'GOODS_DELIVERED', 'COMPLETED'].includes(app.status)) {
        await this.state.transitionApplication(tx, app, 'EXCEPTION', actor, { reason: 'VENDOR_PAYMENT_REVERSED', data: { exceptionReturnState: 'VENDOR_PAYMENT_CONFIRMED' } });
      }
      await this.emit(tx, app, 'vendor.payment_reversed', { payment_reference: ins.reference });
      await this.ctx.raiseException(tx, { code: 'PAYMENT_FAILURE', category: 'VENDOR_PAYMENT', application: app, severity: 'CRITICAL', responsibleTeam: 'SETTLEMENT', retryEligible: false, detail: `Confirmed vendor payment ${ins.reference} was reversed. Release suspended.` }, actor);
    });
    return 'REVERSED';
  }

  // ---- Goods release gate -----------------------------------------------------------------

  async releaseGateInput(applicationId: string, tx: Tx | PrismaService = this.prisma) {
    const db = tx as Tx;
    const app = await db.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const [payment, conds, offer, order, acct] = await Promise.all([
      db.vendorPaymentInstruction.findFirst({ where: { applicationId, status: { in: LIVE_PAYMENT_STATES } }, orderBy: { createdAt: 'desc' } }),
      db.contractualCondition.findMany({ where: { applicationId } }),
      db.financingOffer.findFirst({ where: { applicationId, status: 'ACCEPTED' } }),
      db.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } }),
      db.vendorSettlementAccount.findFirst({ where: { vendorId: app.vendorId, status: 'ACTIVE', verificationStatus: 'VERIFIED' } }),
    ]);
    const openCancellation = await db.cancellationRequest.findFirst({ where: { applicationId, status: { in: ['REQUESTED', 'APPROVED'] } } });
    return {
      app,
      payment,
      input: {
        payment: payment ? { status: payment.status as GatePaymentStatus, confirmedByAuthoritativeSource: payment.confirmedByAuthoritativeSource, amount: payment.amountKobo, beneficiaryAccountId: payment.settlementAccountId } : null,
        expectedVendorPaymentAmount: offer?.financingAmountKobo ?? -1n,
        approvedBeneficiaryAccountId: acct?.id ?? 'none',
        requiredConditions: PRE_RELEASE_CONDITIONS.map((code) => ({ code, satisfied: conds.find((c) => c.code === code)?.status === 'SATISFIED' })),
        contribution: { required: app.contributionAmountKobo > 0n, verified: app.contributionVerified },
        activeHolds: [...app.holds, ...(openCancellation ? ['CANCELLATION_REQUESTED'] : [])],
        orderValid: !['CANCELLED', 'RETURNED'].includes(order.status),
        financingApproved: !!offer && !['DECLINED', 'CANCELLED', 'EXPIRED'].includes(app.status) && !!(await db.arafStatusEvent.findFirst({ where: { applicationId, stage: 'APPROVED', outcome: 'APPLIED' } })),
      },
    };
  }

  /** Re-evaluates the gate inside a locked transaction; creates the release authorisation iff every condition holds. */
  async evaluateRelease(applicationId: string, actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const { input, payment } = await this.releaseGateInput(applicationId, tx);
      const gate = evaluateReleaseGate(input);
      if (!gate.authorized || app.status !== 'VENDOR_PAYMENT_CONFIRMED') return { authorized: false, blockers: gate.blockers, pending_conditions: gate.pendingConditions };
      const existing = await tx.releaseAuthorization.findUnique({ where: { applicationId } });
      if (existing) return { authorized: existing.status === 'AUTHORIZED', reference: existing.reference, blockers: [] };
      const [order, items, vendor] = await Promise.all([
        tx.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } }),
        tx.orderItem.findMany({ where: { orderId: app.orderId } }),
        tx.vendor.findUniqueOrThrow({ where: { id: app.vendorId } }),
      ]);
      const reference = await this.refs.next('REL', { tx });
      const release = await tx.releaseAuthorization.create({
        data: {
          reference,
          applicationId,
          partnerId: app.partnerId,
          environment: app.environment,
          orderId: app.orderId,
          paymentInstructionId: payment!.id,
          vendorId: app.vendorId,
          authorizedItems: toJsonRaw(items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity }))),
          authorizedAmountKobo: app.purchaseAmountKobo,
          status: 'AUTHORIZED',
          conditionsSnapshot: toJsonRaw({ ...input, gate }),
          policyVersionId: app.creditPolicyVersionId,
          contractReferences: ['PROMISE_TO_PURCHASE v1', 'SALE_AGREEMENT v1'],
          isSimulated: payment!.isSimulated,
        },
      });
      await this.state.recordTransition(tx, 'RELEASE', release.id, null, 'AUTHORIZED', actor, applicationId);
      await this.state.transitionApplication(tx, app, 'RELEASE_AUTHORIZED', actor);
      await tx.exposureReservation.updateMany({ where: { applicationId, status: 'ACTIVE' }, data: { status: 'CONSUMED' } });
      await tx.merchantOrder.update({ where: { id: order.id }, data: { status: 'PAID' } });
      await this.emit(tx, app, 'goods.release_authorized', {
        currency: 'NGN',
        vendor_reference: vendor.vendorReference,
        vendor_payment_amount: Number(payment!.amountKobo),
        payment_reference: payment!.reference,
        payment_status: 'CONFIRMED',
        release_authorized: true,
        release_reference: reference,
        authorized_items: items.map((i) => ({ sku: i.sku, quantity: i.quantity })),
        simulated: payment!.isSimulated,
      });
      await this.notifications.enqueue(tx, { environment: app.environment, audience: 'PARTNER', channel: 'IN_APP', templateCode: 'PARTNER_RELEASE_AUTHORIZED', destination: app.partnerId, partnerId: app.partnerId, applicationId: app.id, applicationReference: app.reference, vars: { release: reference, order: order.merchantOrderReference } });
      await this.audit.record(actor, { action: 'release.authorized', resourceType: 'RELEASE_AUTHORIZATION', resourceId: release.id, partnerId: app.partnerId, after: { reference, payment: payment!.reference } }, tx);
      return { authorized: true, reference, blockers: [] };
    });
  }

  async suspendRelease(applicationId: string, reason: string, actor: Actor) {
    if (!reason || reason.length < 3) throw new AppError('VALIDATION_FAILED');
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const r = await tx.releaseAuthorization.findUnique({ where: { applicationId } });
      if (!r || r.status !== 'AUTHORIZED') throw new AppError('INVALID_STATE');
      await tx.releaseAuthorization.update({ where: { id: r.id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: reason } });
      await tx.financingApplication.update({ where: { id: app.id }, data: { holds: { push: 'COMPLIANCE_HOLD' } } });
      await this.state.recordTransition(tx, 'RELEASE', r.id, 'AUTHORIZED', 'SUSPENDED', actor, app.id, reason);
      await this.emit(tx, app, 'goods.release_suspended', { release_reference: r.reference, status: 'ON_HOLD', release_authorized: false });
      await this.audit.record(actor, { action: 'release.suspended', resourceType: 'RELEASE_AUTHORIZATION', resourceId: r.id, partnerId: app.partnerId, reason }, tx);
    });
    return { status: 'SUSPENDED' };
  }

  async reinstateRelease(applicationId: string, reason: string, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const r = await tx.releaseAuthorization.findUnique({ where: { applicationId } });
      if (!r || r.status !== 'SUSPENDED') throw new AppError('INVALID_STATE');
      await tx.financingApplication.update({ where: { id: app.id }, data: { holds: app.holds.filter((h) => h !== 'COMPLIANCE_HOLD') } });
      const { input } = await this.releaseGateInput(applicationId, tx);
      const gate = evaluateReleaseGate({ ...input, activeHolds: input.activeHolds.filter((h) => h !== 'COMPLIANCE_HOLD') });
      if (!gate.authorized) throw new AppError('PRECONDITIONS_NOT_MET', { blockers: gate.blockers });
      await tx.releaseAuthorization.update({ where: { id: r.id }, data: { status: 'AUTHORIZED', suspendedAt: null, suspensionReason: null } });
      await this.state.recordTransition(tx, 'RELEASE', r.id, 'SUSPENDED', 'AUTHORIZED', actor, app.id, reason);
      await this.emit(tx, app, 'goods.release_authorized', { release_reference: r.reference, release_authorized: true, reinstated: true });
      await this.audit.record(actor, { action: 'release.reinstated', resourceType: 'RELEASE_AUTHORIZATION', resourceId: r.id, partnerId: app.partnerId, reason }, tx);
    });
    return { status: 'AUTHORIZED' };
  }

  // ---- Fulfilment ------------------------------------------------------------------------

  private async appForOrder(tx: Tx, partnerId: string, environment: Environment, merchantOrderReference: string) {
    const order = await tx.merchantOrder.findUnique({ where: { partnerId_environment_merchantOrderReference: { partnerId, environment, merchantOrderReference } } });
    if (!order) throw new AppError('NOT_FOUND');
    const app = await tx.financingApplication.findFirst({ where: { orderId: order.id, status: { notIn: ['CANCELLED', 'EXPIRED', 'DECLINED'] } }, orderBy: { createdAt: 'desc' } });
    if (!app) throw new AppError('NOT_FOUND');
    return { order, app: await this.ctx.lockApplication(tx, app.id) };
  }

  /**
   * The merchant confirms it has received the customer's equity towards the item (a down payment
   * collected by the merchant, not by the Bank). The amount must equal the agreed equity exactly.
   * Only after this may the Bank pay the vendor — and it pays only the financed remainder.
   */
  async confirmEquity(partnerId: string, environment: Environment, orderRef: string, body: unknown, actor: Actor) {
    const input = z.object({ amount: z.number().int().positive(), payment_reference: z.string().trim().regex(/^[A-Za-z0-9._\-]{4,64}$/) }).strict().parse(body);
    return this.prisma.$transaction(async (tx) => {
      const { app } = await this.appForOrder(tx, partnerId, environment, orderRef);
      if (app.contributionAmountKobo <= 0n) throw new AppError('EQUITY_NOT_REQUIRED');
      if (app.contributionVerified) {
        if (app.contributionReference === input.payment_reference && BigInt(input.amount) === app.contributionAmountKobo) return { status: 'CONFIRMED', idempotent_replay: true };
        throw new AppError('EQUITY_ALREADY_CONFIRMED');
      }
      if (!(EQUITY_PAYABLE_STATES as readonly string[]).includes(app.status)) throw new AppError('INVALID_STATE', { reason: 'Equity is payable once the Bank has approved the financing and before vendor payment.' });
      if (BigInt(input.amount) !== app.contributionAmountKobo) {
        await this.audit.record(actor, { action: 'equity.confirmation_rejected', resourceType: 'APPLICATION', resourceId: app.id, partnerId, outcome: 'DENIED', reason: 'AMOUNT_MISMATCH' }, tx);
        throw new AppError('EQUITY_AMOUNT_MISMATCH');
      }
      await tx.financingApplication.update({ where: { id: app.id }, data: { contributionVerified: true, contributionReference: input.payment_reference, contributionConfirmedAt: new Date() } });
      await this.audit.record(actor, { action: 'equity.confirmed', resourceType: 'APPLICATION', resourceId: app.id, partnerId, after: { amount_kobo: app.contributionAmountKobo.toString(), payment_reference: input.payment_reference } }, tx);
      await this.emit(tx, app, 'application.equity_confirmed', { equity_amount: Number(app.contributionAmountKobo), equity_payment_reference: input.payment_reference });
      await this.journey.notifyCustomer(tx, app, 'EQUITY_CONFIRMED');
      return { status: 'CONFIRMED', idempotent_replay: false };
    });
  }

  async fulfil(partnerId: string, environment: Environment, orderRef: string, body: unknown, actor: Actor) {
    const input = fulfilSchema.parse(body);
    await this.prisma.$transaction(async (tx) => {
      const { order, app } = await this.appForOrder(tx, partnerId, environment, orderRef);
      const release = await tx.releaseAuthorization.findUnique({ where: { applicationId: app.id } });
      // Fulfilment is impossible without an ACTIVE release authorisation.
      if (!release || release.status !== 'AUTHORIZED' || app.status !== 'RELEASE_AUTHORIZED') {
        await this.audit.record(actor, { action: 'fulfilment.blocked', resourceType: 'APPLICATION', resourceId: app.id, partnerId, outcome: 'DENIED', reason: 'RELEASE_NOT_AUTHORIZED' }, tx);
        throw new AppError('RELEASE_NOT_AUTHORIZED');
      }
      const exists = await tx.fulfilmentRecord.findUnique({ where: { applicationId_status: { applicationId: app.id, status: input.status } } });
      if (exists) throw new AppError('FULFILMENT_DUPLICATE');
      await tx.fulfilmentRecord.create({ data: { applicationId: app.id, releaseId: release.id, status: input.status, trackingReference: input.tracking_reference, carrier: input.carrier, note: input.note, actorType: actor.type, actorId: actor.id ?? 'unknown' } });
      if (input.status === 'PREPARED') return;
      await tx.releaseAuthorization.update({ where: { id: release.id }, data: { status: 'CONSUMED' } });
      await this.state.recordTransition(tx, 'RELEASE', release.id, 'AUTHORIZED', 'CONSUMED', actor, app.id);
      await this.state.transitionApplication(tx, app, 'GOODS_DISPATCHED', actor, { reason: input.status });
      await tx.merchantOrder.update({ where: { id: order.id }, data: { status: 'FULFILLED' } });
      await this.emit(tx, app, 'goods.dispatched', { tracking_reference: input.tracking_reference ?? null, carrier: input.carrier ?? null, collected: input.status === 'COLLECTED' });
      await this.journey.notifyCustomer(tx, app, 'GOODS_DISPATCHED');
      if (input.status === 'COLLECTED') await this.completeDelivery(tx, app, actor, 'Customer collected');
    });
    return { ok: true };
  }

  private async completeDelivery(tx: Tx, app: FinancingApplication, actor: Actor, note?: string) {
    const release = await tx.releaseAuthorization.findUniqueOrThrow({ where: { applicationId: app.id } });
    const has = await tx.fulfilmentRecord.findUnique({ where: { applicationId_status: { applicationId: app.id, status: 'DELIVERED' } } });
    if (!has) await tx.fulfilmentRecord.create({ data: { applicationId: app.id, releaseId: release.id, status: 'DELIVERED', note, actorType: actor.type, actorId: actor.id ?? 'unknown' } });
    await this.state.transitionApplication(tx, app, 'GOODS_DELIVERED', actor);
    await this.emit(tx, app, 'goods.delivered');
    await this.journey.notifyCustomer(tx, app, 'GOODS_DELIVERED');
    // Origination lifecycle complete; repayment continues in core banking per the schedule.
    await this.state.transitionApplication(tx, app, 'COMPLETED', SYSTEM_ACTOR, { data: { completedAt: new Date() } });
  }

  async deliver(partnerId: string, environment: Environment, orderRef: string, body: unknown, actor: Actor) {
    const input = deliverSchema.parse(body);
    await this.prisma.$transaction(async (tx) => {
      const { app } = await this.appForOrder(tx, partnerId, environment, orderRef);
      if (app.status !== 'GOODS_DISPATCHED') throw new AppError('INVALID_STATE');
      if (input.exception) {
        const release = await tx.releaseAuthorization.findUniqueOrThrow({ where: { applicationId: app.id } });
        const exists = await tx.fulfilmentRecord.findUnique({ where: { applicationId_status: { applicationId: app.id, status: 'DELIVERY_EXCEPTION' } } });
        if (!exists) await tx.fulfilmentRecord.create({ data: { applicationId: app.id, releaseId: release.id, status: 'DELIVERY_EXCEPTION', note: input.note, actorType: actor.type, actorId: actor.id ?? 'unknown' } });
        await this.ctx.raiseException(tx, { code: 'DELIVERY_EXCEPTION', category: 'DELIVERY', application: app, severity: 'MEDIUM', responsibleTeam: 'OPERATIONS', retryEligible: true, detail: `Delivery exception reported by partner: ${input.note ?? 'no note'}` }, actor);
        return;
      }
      await this.completeDelivery(tx, app, actor, input.note);
    });
    return { ok: true };
  }

  async customerConfirmDelivery(applicationId: string, req: AuthedRequest) {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (app.status !== 'GOODS_DISPATCHED') throw new AppError('INVALID_STATE');
      await this.completeDelivery(tx, app, req.actor, 'Confirmed by customer');
    });
    return this.journey.view(applicationId, req);
  }

  // ---- Cancellations, returns, refunds --------------------------------------------------

  async cancelOrder(partnerId: string, environment: Environment, orderRef: string, body: unknown, actor: Actor) {
    const { reason } = cancelOrderSchema.parse(body);
    return this.prisma.$transaction(async (tx) => {
      const { order, app } = await this.appForOrder(tx, partnerId, environment, orderRef);
      const payment = await tx.vendorPaymentInstruction.findFirst({ where: { applicationId: app.id, status: { in: LIVE_PAYMENT_STATES } } });
      if (!payment) {
        const { canTransition } = await import('@araf/business-rules');
        if (!canTransition('APPLICATION', app.status, 'CANCELLED')) throw new AppError('INVALID_STATE');
        await this.state.transitionApplication(tx, app, 'CANCELLED', actor, { reason: `PARTNER_CANCELLED: ${reason}` });
        await tx.exposureReservation.updateMany({ where: { applicationId: app.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
        await tx.merchantOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
        await tx.cancellationRequest.create({ data: { applicationId: app.id, initiatedBy: 'PARTNER', actorId: actor.id, stage: app.status, reason, status: 'COMPLETED', requiresReversal: false } });
        await this.emit(tx, app, 'order.cancelled', { reason });
        return { status: 'CANCELLED', requires_reversal: false };
      }
      // After a payment instruction exists, cancellation becomes a controlled reversal workflow.
      const c = await tx.cancellationRequest.create({ data: { applicationId: app.id, initiatedBy: 'PARTNER', actorId: actor.id, stage: app.status, reason, status: 'REQUESTED', requiresReversal: true } });
      await this.ctx.raiseException(tx, { code: 'CANCELLATION_AFTER_PAYMENT', category: 'REFUND', application: app, severity: 'HIGH', responsibleTeam: 'OPERATIONS', retryEligible: false, detail: `Partner requested cancellation after vendor payment instruction ${payment.reference}: ${reason}` }, actor);
      const release = await tx.releaseAuthorization.findUnique({ where: { applicationId: app.id } });
      if (release?.status === 'AUTHORIZED') {
        await tx.releaseAuthorization.update({ where: { id: release.id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspensionReason: 'CANCELLATION_REQUESTED' } });
        await this.emit(tx, app, 'goods.release_suspended', { release_reference: release.reference, status: 'ON_HOLD', release_authorized: false, reason: 'CANCELLATION_REQUESTED' });
      }
      return { status: 'CANCELLATION_REQUESTED', requires_reversal: true, cancellation_id: c.id };
    });
  }

  async requestReturn(partnerId: string, environment: Environment, orderRef: string, body: unknown, actor: Actor) {
    const input = returnOrderSchema.parse(body);
    return this.prisma.$transaction(async (tx) => {
      const { app } = await this.appForOrder(tx, partnerId, environment, orderRef);
      if (!['GOODS_DISPATCHED', 'GOODS_DELIVERED', 'COMPLETED', 'RELEASE_AUTHORIZED'].includes(app.status)) throw new AppError('INVALID_STATE');
      const r = await tx.returnRequest.create({ data: { applicationId: app.id, type: input.type, items: toJsonRaw(input.items ?? []), reason: input.reason, status: 'REQUESTED', initiatedBy: 'PARTNER', actorId: actor.id } });
      await this.ctx.raiseException(tx, { code: 'RETURN_REQUESTED', category: 'REFUND', application: app, severity: 'MEDIUM', responsibleTeam: 'OPERATIONS', retryEligible: false, detail: `${input.type}: ${input.reason}` }, actor);
      await this.audit.record(actor, { action: 'return.requested', resourceType: 'RETURN_REQUEST', resourceId: r.id, partnerId, after: input }, tx);
      return { return_id: r.id, status: r.status };
    });
  }

  /** Bank maker: start a vendor refund for an approved cancellation/return (checker approval required). */
  async startRefund(applicationId: string, body: unknown, actor: Actor) {
    const input = z.object({ cancellation_id: z.string().uuid().optional(), return_id: z.string().uuid().optional(), amount_naira: z.number().positive().optional() }).strict().parse(body);
    return this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const payment = await tx.vendorPaymentInstruction.findFirst({ where: { applicationId, status: 'CONFIRMED' } });
      if (!payment) throw new AppError('PRECONDITIONS_NOT_MET', { reason: 'No confirmed vendor payment to refund' });
      const expected = input.amount_naira ? BigInt(Math.round(input.amount_naira * 100)) : payment.amountKobo;
      if (expected > payment.amountKobo) throw new AppError('VALIDATION_FAILED');
      const reference = await this.refs.next('RFD', { tx });
      const refund = await tx.refundRecord.create({ data: { reference, applicationId, cancellationId: input.cancellation_id, returnRequestId: input.return_id, expectedAmountKobo: expected, status: 'REQUESTED', isSimulated: payment.isSimulated } });
      if (input.cancellation_id) await tx.cancellationRequest.update({ where: { id: input.cancellation_id }, data: { status: 'APPROVED', decidedById: actor.id, decidedAt: new Date() } });
      if (input.return_id) await tx.returnRequest.update({ where: { id: input.return_id }, data: { status: 'APPROVED' } });
      await this.state.recordTransition(tx, 'REFUND', refund.id, null, 'REQUESTED', actor, applicationId);
      await this.approvals.create(tx, { type: 'REFUND', resourceType: 'REFUND', resourceId: refund.id, partnerId: app.partnerId, payload: { expected_kobo: expected.toString() }, summary: `Vendor refund ${formatNaira(expected)} for ${app.reference}` }, actor);
      return { reference, status: 'REQUESTED' };
    });
  }

  async pollRefunds(): Promise<number> {
    const rows = await this.prisma.refundRecord.findMany({ where: { status: 'VENDOR_REFUND_PENDING' }, take: 20 });
    for (const r of rows) {
      const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: r.applicationId } });
      const c = this.callCtx(app);
      const res = await this.providers.call(app.environment, 'PAYMENTS', 'vendor_refund', c, () => this.providers.for(app.environment).payments.queryVendorRefund(r.reference, c)).catch(() => null);
      if (!res || res.status !== 'RECEIVED') continue;
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, app.id);
        if (res.amount !== r.expectedAmountKobo) {
          await tx.refundRecord.update({ where: { id: r.id }, data: { status: 'FAILED', receivedAmountKobo: res.amount, providerReference: res.providerReference } });
          await this.ctx.raiseException(tx, { code: 'REFUND_DISCREPANCY', category: 'REFUND', application: locked, severity: 'HIGH', responsibleTeam: 'SETTLEMENT', retryEligible: false, detail: `Vendor refund received ${res.amount} kobo; expected ${r.expectedAmountKobo} kobo.` }, SYSTEM_ACTOR);
          return;
        }
        // Reconcile the refund BEFORE adjusting financing (spec §39).
        await tx.refundRecord.update({ where: { id: r.id }, data: { status: 'COMPLETED', receivedAmountKobo: res.amount, providerReference: res.providerReference } });
        for (const [from, to] of [['VENDOR_REFUND_PENDING', 'VENDOR_REFUND_RECEIVED'], ['VENDOR_REFUND_RECEIVED', 'RECONCILED'], ['RECONCILED', 'COMPLETED']]) {
          await this.state.recordTransition(tx, 'REFUND', r.id, from, to, SYSTEM_ACTOR, app.id);
        }
        await tx.bookingRecord.updateMany({ where: { applicationId: app.id, status: 'BOOKED' }, data: { status: 'REVERSED' } });
        const release = await tx.releaseAuthorization.findUnique({ where: { applicationId: app.id } });
        if (release && ['AUTHORIZED', 'SUSPENDED'].includes(release.status)) await tx.releaseAuthorization.update({ where: { id: release.id }, data: { status: 'REVOKED' } });
        await tx.exposureReservation.updateMany({ where: { applicationId: app.id, status: { in: ['ACTIVE', 'CONSUMED'] } }, data: { status: 'RELEASED', releasedAt: new Date() } });
        if (r.cancellationId) {
          await tx.cancellationRequest.update({ where: { id: r.cancellationId }, data: { status: 'COMPLETED' } });
          if (locked.status !== 'EXCEPTION' && !['COMPLETED', 'CANCELLED'].includes(locked.status)) await this.state.transitionApplication(tx, locked, 'EXCEPTION', SYSTEM_ACTOR, { reason: 'CANCELLATION_REVERSAL' });
          if (locked.status === 'EXCEPTION') await this.state.transitionApplication(tx, locked, 'CANCELLED', SYSTEM_ACTOR, { reason: 'CANCELLED_AFTER_REFUND' });
          await tx.merchantOrder.update({ where: { id: locked.orderId }, data: { status: 'CANCELLED' } });
          await this.emit(tx, locked, 'order.cancelled');
        }
        if (r.returnRequestId) {
          await tx.returnRequest.update({ where: { id: r.returnRequestId }, data: { status: 'COMPLETED' } });
          await tx.merchantOrder.update({ where: { id: locked.orderId }, data: { status: 'RETURNED' } });
        }
        await this.ctx.resolveExceptions(tx, app.id, ['CANCELLATION_AFTER_PAYMENT', 'RETURN_REQUESTED'], `Vendor refund ${r.reference} reconciled`, SYSTEM_ACTOR);
        await this.fees.reverse(tx, app.id, r.cancellationId ? 'CANCELLED_AFTER_PAYMENT' : 'GOODS_RETURNED');
        await this.emit(tx, locked, 'refund.completed', { refund_reference: r.reference, amount: Number(res.amount) });
      });
    }
    return rows.length;
  }

  // ---- Exception resolution ----------------------------------------------------------

  async resolveException(id: string, body: unknown, actor: Actor) {
    const input = z.object({ action: z.enum(['RESOLVE', 'RESUME', 'ESCALATE', 'ASSIGN_TO_ME', 'CLOSE_APPLICATION']), note: z.string().min(3).max(1000) }).strict().parse(body);
    return this.prisma.$transaction(async (tx) => {
      const exc = await tx.operationalException.findUnique({ where: { id } });
      if (!exc) throw new AppError('NOT_FOUND');
      const history = [...((exc.history as unknown[]) ?? []), { at: new Date().toISOString(), by: actor.label, action: input.action, note: input.note }];
      if (input.action === 'ASSIGN_TO_ME') {
        await tx.operationalException.update({ where: { id }, data: { assignedToId: actor.id, status: 'IN_PROGRESS', history: toJsonRaw(history) } });
      } else if (input.action === 'ESCALATE') {
        await tx.operationalException.update({ where: { id }, data: { status: 'ESCALATED', escalated: true, history: toJsonRaw(history) } });
      } else {
        if (exc.applicationId && (input.action === 'RESUME' || input.action === 'CLOSE_APPLICATION')) {
          const app = await this.ctx.lockApplication(tx, exc.applicationId);
          if (app.status === 'EXCEPTION') {
            if (input.action === 'CLOSE_APPLICATION') {
              await this.state.transitionApplication(tx, app, 'CANCELLED', actor, { reason: `EXCEPTION_CLOSED: ${input.note}` });
              await tx.exposureReservation.updateMany({ where: { applicationId: app.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
              await this.emit(tx, app, 'application.cancelled');
            } else {
              const target = app.exceptionReturnState;
              if (!target) throw new AppError('INVALID_STATE');
              await this.state.transitionApplication(tx, app, target, actor, { reason: `EXCEPTION_RESOLVED: ${input.note}`, data: { exceptionReturnState: null } });
            }
          }
        }
        await tx.operationalException.update({ where: { id }, data: { status: 'RESOLVED', resolution: input.note, resolvedAt: new Date(), history: toJsonRaw(history) } });
      }
      await this.audit.record(actor, { action: `exception.${input.action.toLowerCase()}`, resourceType: 'OPERATIONAL_EXCEPTION', resourceId: id, partnerId: exc.partnerId, reason: input.note }, tx);
      return { ok: true };
    });
  }

  // ---- Reconciliation (spec §50) ------------------------------------------------------

  async runReconciliation(actor: Actor) {
    const run = await this.prisma.reconciliationRun.create({ data: { triggeredBy: actor.label ?? actor.type } });
    const findings: Array<{ applicationId?: string; instructionId?: string; type: string; severity: string; detail: string }> = [];
    const payments = await this.prisma.vendorPaymentInstruction.findMany({ where: { status: { not: 'PENDING_APPROVAL' } } });
    for (const p of payments.filter((x) => ['PROCESSING', 'UNKNOWN', 'RECONCILIATION_REQUIRED', 'CONFIRMED'].includes(x.status))) {
      await this.reconcileInstruction(p.id, actor).catch(() => undefined);
    }
    const fresh = await this.prisma.vendorPaymentInstruction.findMany({ where: { status: { not: 'PENDING_APPROVAL' } } });
    const byApp = new Map<string, typeof fresh>();
    for (const p of fresh) byApp.set(p.applicationId, [...(byApp.get(p.applicationId) ?? []), p]);
    for (const [appId, list] of byApp) {
      const confirmed = list.filter((p) => p.status === 'CONFIRMED');
      if (confirmed.length > 1) findings.push({ applicationId: appId, type: 'DUPLICATE_PAYMENT', severity: 'CRITICAL', detail: `${confirmed.length} confirmed payments` });
    }
    const offers = new Map((await this.prisma.financingOffer.findMany({ where: { status: 'ACCEPTED' } })).map((o) => [o.applicationId, o]));
    const accounts = new Map((await this.prisma.vendorSettlementAccount.findMany()).map((a) => [a.id, a]));
    for (const p of fresh) {
      if (p.status === 'CONFIRMED' && offers.get(p.applicationId) && offers.get(p.applicationId)!.financingAmountKobo !== p.amountKobo) findings.push({ applicationId: p.applicationId, instructionId: p.id, type: 'AMOUNT_MISMATCH', severity: 'CRITICAL', detail: `Paid ${p.amountKobo} vs financed ${offers.get(p.applicationId)!.financingAmountKobo}` });
      if (accounts.get(p.settlementAccountId)?.status !== 'ACTIVE' && p.status !== 'FAILED') findings.push({ applicationId: p.applicationId, instructionId: p.id, type: 'BENEFICIARY_MISMATCH', severity: 'HIGH', detail: 'Paid account is no longer the active approved settlement account' });
      if (['UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(p.status)) findings.push({ applicationId: p.applicationId, instructionId: p.id, type: 'MISSING_CONFIRMATION', severity: 'CRITICAL', detail: `Payment ${p.reference} is ${p.status}` });
    }
    const bookings = await this.prisma.bookingRecord.findMany({ where: { status: 'BOOKED' } });
    for (const b of bookings) {
      const ps = byApp.get(b.applicationId) ?? [];
      const app = await this.prisma.financingApplication.findUnique({ where: { id: b.applicationId } });
      if (!ps.some((p) => p.status === 'CONFIRMED') && app && Date.now() - (b.bookedAt?.getTime() ?? 0) > 3 * 86_400_000) findings.push({ applicationId: b.applicationId, type: 'BOOKING_WITHOUT_PAYMENT', severity: 'MEDIUM', detail: 'Booked > 3 days without confirmed vendor payment' });
    }
    for (const p of fresh.filter((x) => x.status === 'CONFIRMED')) {
      if (BOOKING_BEFORE_VENDOR_PAYMENT && !bookings.some((b) => b.applicationId === p.applicationId) && !(await this.prisma.bookingRecord.findFirst({ where: { applicationId: p.applicationId, status: 'REVERSED' } }))) findings.push({ applicationId: p.applicationId, instructionId: p.id, type: 'PAYMENT_WITHOUT_BOOKING', severity: 'CRITICAL', detail: 'Confirmed payment without valid booking' });
      const rel = await this.prisma.releaseAuthorization.findUnique({ where: { applicationId: p.applicationId } });
      if (!rel && p.confirmedAt && Date.now() - p.confirmedAt.getTime() > 2 * 86_400_000) findings.push({ applicationId: p.applicationId, instructionId: p.id, type: 'PAYMENT_WITHOUT_RELEASE', severity: 'MEDIUM', detail: 'Confirmed > 2 days without release authorisation (conditions pending)' });
    }
    const releases = await this.prisma.releaseAuthorization.findMany({ where: { status: { in: ['AUTHORIZED', 'CONSUMED'] } } });
    for (const r of releases) {
      const p = await this.prisma.vendorPaymentInstruction.findUnique({ where: { id: r.paymentInstructionId } });
      if (!p || p.status !== 'CONFIRMED') findings.push({ applicationId: r.applicationId, type: 'RELEASE_WITHOUT_CONFIRMED_PAYMENT', severity: 'CRITICAL', detail: `Release ${r.reference} references payment in status ${p?.status}` });
    }
    const refunds = await this.prisma.refundRecord.findMany({ where: { status: 'FAILED' } });
    for (const r of refunds) findings.push({ applicationId: r.applicationId, type: 'REFUND_DISCREPANCY', severity: 'HIGH', detail: `Refund ${r.reference} amount mismatch` });
    if (findings.length) await this.prisma.reconciliationFinding.createMany({ data: findings.map((f) => ({ ...f, runId: run.id })) });
    await this.prisma.reconciliationRun.update({ where: { id: run.id }, data: { completedAt: new Date(), checked: fresh.length + bookings.length + releases.length, discrepancies: findings.length } });
    await this.audit.record(actor, { action: 'reconciliation.run', resourceType: 'RECONCILIATION_RUN', resourceId: run.id, after: { findings: findings.length } });
    return { run_id: run.id, checked: fresh.length + bookings.length + releases.length, discrepancies: findings.length };
  }
}
