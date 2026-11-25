import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { z } from 'zod';
import {
  assessSalary,
  compareEligibilityToCart,
  computeEligibility,
  exposureAmountFor,
  formatNaira,
  isApprovedTenor,
  isOfferAffordable,
  priceDeferredSale,
  remainingExposure,
  requiredMonths,
  resolveExistingObligations,
  scheduleWithDates,
  addMonths,
  type CreditPolicyRules,
  type StatementCredit,
} from '@araf/business-rules';
import { sha256Hex } from '@araf/security';
import type { FinancingApplication } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, OutboxService, ReferenceService, StateService, SYSTEM_ACTOR, toJsonRaw, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JourneyService } from '../customer/journey.service';
import { renderSimplePdf } from '../common/pdf';
import type { AuthedRequest } from '../auth/auth.guard';

export const TERMS_VERSION = 'ARAF-MURABAHA-INDICATIVE-2026.11';
const TERMS_TEXT =
  'This is an indicative financing offer for a Murabaha (cost-plus sale) asset financing. It is not final approval and not a sale contract. Final approval is subject to the Bank’s review, documentation, repayment mandate and acquisition of the asset by the Bank. The profit markup is a disclosed profit on the sale of the asset, not interest.';

@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly outbox: OutboxService,
    private readonly refs: ReferenceService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => JourneyService)) private readonly journey: JourneyService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async otherReservations(tx: Tx, customerId: string, applicationId: string): Promise<bigint> {
    const agg = await tx.exposureReservation.aggregate({
      _sum: { amountKobo: true },
      where: { customerId, applicationId: { not: applicationId }, OR: [{ status: 'ACTIVE', expiresAt: { gt: new Date() } }, { status: 'CONSUMED' }] },
    });
    return agg._sum.amountKobo ?? 0n;
  }

  /**
   * Bank-derived affordability (spec §25–29). Provider data feeds the Bank's own deterministic rules;
   * the provider never overrides policy. Concurrency-safe: the obligor row is locked while exposure
   * is reserved so concurrent applications cannot exceed the single obligor limit.
   */
  async evaluate(applicationId: string, actor: Actor, correlationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'STATEMENT_ANALYSIS_COMPLETED' && app.status !== 'ELIGIBLE') return;
    const policy = await this.ctx.policyFor(app.creditPolicyVersionId);
    const config = await this.ctx.partnerConfig(app.partnerId);
    const result = await this.prisma.statementAnalysisResult.findFirstOrThrow({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
    const credit = await this.prisma.creditAssessment.findFirst({ where: { applicationId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
    const policyVersionId = app.creditPolicyVersionId;

    if (app.incomeProfile === 'BUSINESS_OWNER' && policy.businessOwnerManualReview) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, applicationId);
        await tx.affordabilityAssessment.create({ data: { applicationId, policyVersionId, analysisResultId: result.id, incomeProfile: 'BUSINESS_OWNER', outcome: 'MANUAL_REVIEW', reasons: ['BUSINESS_OWNER_MANUAL_REVIEW'] } });
        await this.routeToReview(tx, locked, 'BUSINESS_OWNER', `Business owner — 12-month statement analysis requires manual review (${policy.businessOwnerContactWindowHours.min}–${policy.businessOwnerContactWindowHours.max}h contact target).`, policy);
      });
      return;
    }

    const credits = this.crypto.decryptJson<StatementCredit[]>(result.salaryCreditsEncrypted, `analysis:${applicationId}`);
    const months = requiredMonths(new Date(), policy.statementMonths.SALARY_EARNER);
    const salary = assessSalary(credits, { periodStart: result.periodStart, periodEnd: result.periodEnd, reliable: result.reliable }, months, result.accountHolderName);
    const monthBreakdown = salary.months.map((m) => ({ month: m.month, status: m.status, consolidated: Number(m.consolidated) }));

    if (salary.kind === 'DECLINE_MISSING_SALARY') {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, applicationId);
        await tx.affordabilityAssessment.create({ data: { applicationId, policyVersionId, analysisResultId: result.id, incomeProfile: 'SALARY_EARNER', outcome: 'DECLINED', reasons: ['MISSING_SALARY_MONTH'], monthBreakdown: toJsonRaw(monthBreakdown) } });
        await this.decline(tx, locked, 'MISSING_SALARY_MONTH');
      });
      return;
    }
    if (salary.kind === 'REVIEW_REQUIRED') {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, applicationId);
        await tx.affordabilityAssessment.create({ data: { applicationId, policyVersionId, analysisResultId: result.id, incomeProfile: 'SALARY_EARNER', outcome: 'MANUAL_REVIEW', reasons: salary.reasons, monthBreakdown: toJsonRaw(monthBreakdown) } });
        await this.routeToReview(tx, locked, salary.reasons.includes('UNCERTAIN_SALARY_CLASSIFICATION') ? 'BORDERLINE_AFFORDABILITY' : 'INCONSISTENT_STATEMENT', `Salary assessment needs review: ${salary.reasons.join(', ')}`, policy);
      });
      return;
    }

    const obligations = resolveExistingObligations(credit?.bureauMonthlyObligationsKobo ?? null, result.recurringObligationsKobo, policy);
    const bvn = await this.journey.customerBvn(app.customerId!);
    const c = { correlationId, applicationReference: app.reference, applicationId };
    const exposure = await this.providers.call(app.environment, 'CORE_BANKING', 'customer_exposure', c, () => this.providers.for(app.environment).coreBanking.getCustomerExposure(bvn, c));
    await this.computeAndReserve(applicationId, {
      recognisedIncome: salary.recognisedMonthlySalary,
      obligations,
      existingExposure: exposure.totalExposure,
      analysisResultId: result.id,
      monthBreakdown,
    });
  }

  /** Shared by automatic evaluation and by reviewers clearing an affordability review. */
  async computeAndReserve(
    applicationId: string,
    input: { recognisedIncome: bigint; obligations: bigint; existingExposure: bigint; analysisResultId: string | null; monthBreakdown?: unknown },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const policy = await this.ctx.policyFor(app.creditPolicyVersionId, tx);
      const config = await this.ctx.partnerConfig(app.partnerId, tx);
      // Lock the obligor so concurrent applications serialise their exposure reservations.
      await tx.$queryRawUnsafe('SELECT id FROM customers WHERE id = $1 FOR UPDATE', app.customerId);
      const others = await this.otherReservations(tx, app.customerId!, app.id);
      const elig = computeEligibility(
        {
          recognisedMonthlyIncome: input.recognisedIncome,
          existingMonthlyObligations: input.obligations,
          exposure: { existingBankExposure: input.existingExposure, otherActiveReservations: others },
          partnerMaxAmount: config.maxTransactionKobo,
          permittedTenors: config.permittedTenors,
        },
        policy,
      );
      const partial = policy.partialFinancingEnabled && config.partialFinancingEnabled;
      const cmp = compareEligibilityToCart(elig.maxEligibleAmount, app.purchaseAmountKobo, partial, BigInt(policy.minimumFinancingKobo));
      const outcome = cmp.outcome === 'FULL_FINANCING' ? 'ELIGIBLE' : cmp.outcome === 'PARTIAL_FINANCING' ? 'PARTIAL' : cmp.outcome;
      const reasons = [
        ...(cmp.outcome === 'DECLINED' ? [elig.capacity === 0n ? 'NO_REPAYMENT_CAPACITY' : elig.remainingExposure === 0n ? 'EXPOSURE_LIMIT_REACHED' : cmp.reason] : []),
        ...(cmp.outcome === 'CART_REVISION_REQUIRED' ? ['CART_REVISION_REQUIRED'] : []),
        ...(cmp.outcome === 'PARTIAL_FINANCING' ? ['PARTIAL_FINANCING'] : []),
      ];
      await tx.affordabilityAssessment.create({
        data: {
          applicationId,
          policyVersionId: app.creditPolicyVersionId,
          analysisResultId: input.analysisResultId,
          incomeProfile: app.incomeProfile ?? 'SALARY_EARNER',
          outcome,
          reasons,
          recognisedMonthlyIncomeKobo: input.recognisedIncome,
          existingMonthlyObligationsKobo: input.obligations,
          capacityKobo: elig.capacity,
          existingExposureKobo: input.existingExposure + others,
          remainingExposureKobo: elig.remainingExposure,
          maxEligibleKobo: elig.maxEligibleAmount,
          tenorBreakdown: elig.tenors.map((t) => ({ tenor_months: t.tenorMonths, markup_bps: t.markupBps, max_affordable: Number(t.maxAffordable), eligible_amount: Number(t.eligibleAmount), limiting_factor: t.limitingFactor })),
          monthBreakdown: input.monthBreakdown ? toJsonRaw(input.monthBreakdown) : undefined,
        },
      });
      if (cmp.outcome === 'DECLINED') {
        await this.decline(tx, app, reasons[0]);
        return;
      }
      if (app.status === 'STATEMENT_ANALYSIS_COMPLETED' || app.status === 'AFFORDABILITY_REVIEW_REQUIRED') {
        await this.state.transitionApplication(tx, app, 'ELIGIBLE', SYSTEM_ACTOR, { data: { eligibleAmountKobo: elig.maxEligibleAmount } });
      } else {
        await tx.financingApplication.update({ where: { id: app.id }, data: { eligibleAmountKobo: elig.maxEligibleAmount } });
      }
      if (cmp.outcome === 'CART_REVISION_REQUIRED') {
        await tx.exposureReservation.updateMany({ where: { applicationId, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
        await this.journey.emitMerchant(tx, app, 'application.action_required', { reason: 'CART_REVISION_REQUIRED' });
        return;
      }
      const financing = cmp.financingAmount;
      const reserveAmount = exposureAmountFor(financing, Math.max(...elig.tenors.filter((t) => t.eligibleAmount >= financing).map((t) => t.tenorMonths)), policy);
      await tx.exposureReservation.upsert({
        where: { applicationId },
        create: { applicationId, customerId: app.customerId!, amountKobo: reserveAmount, status: 'ACTIVE', expiresAt: new Date(Date.now() + policy.offerValidityMinutes * 60_000 + 7 * 86_400_000) },
        update: { amountKobo: reserveAmount, status: 'ACTIVE', releasedAt: null },
      });
      await tx.financingApplication.update({ where: { id: app.id }, data: { contributionAmountKobo: cmp.contributionAmount } });
      await this.journey.emitMerchant(tx, app, 'application.eligible');
    });
  }

  private async decline(tx: Tx, app: FinancingApplication, reason: string) {
    await this.state.transitionApplication(tx, app, 'DECLINED', SYSTEM_ACTOR, { reason, data: { declineReasonCode: reason } });
    await tx.exposureReservation.updateMany({ where: { applicationId: app.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
    await this.journey.emitMerchant(tx, app, 'application.declined');
    await this.journey.notifyCustomer(tx, app, 'FINANCING_DECLINED');
  }

  private async routeToReview(tx: Tx, app: FinancingApplication, queue: string, detail: string, policy: CreditPolicyRules) {
    if (app.status === 'STATEMENT_ANALYSIS_COMPLETED') await this.state.transitionApplication(tx, app, 'AFFORDABILITY_REVIEW_REQUIRED', SYSTEM_ACTOR, { reason: queue });
    await tx.enhancedReview.create({ data: { applicationId: app.id, queue, status: 'PENDING', requestedFields: [], clarificationNote: detail, slaDueAt: new Date(Date.now() + policy.businessOwnerContactWindowHours.max * 3600_000) } });
    await this.notifications.enqueue(tx, { environment: app.environment, audience: 'BANK', channel: 'IN_APP', templateCode: 'BANK_MANUAL_REVIEW', destination: 'review.perform', applicationId: app.id, applicationReference: app.reference, vars: { reference: app.reference, queue } });
    await this.journey.emitMerchant(tx, app, 'application.under_review');
  }

  // ---- Offers -----------------------------------------------------------------------------

  private async latestAssessment(applicationId: string) {
    const a = await this.prisma.affordabilityAssessment.findFirst({ where: { applicationId, outcome: { in: ['ELIGIBLE', 'PARTIAL'] } }, orderBy: { createdAt: 'desc' } });
    if (!a) throw new AppError('INVALID_STATE');
    return a;
  }

  /** Compare approved tenors (indicative, not persisted). Unaffordable options are flagged, not hidden. */
  async offerOptions(applicationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (!['ELIGIBLE', 'OFFER_PRESENTED'].includes(app.status)) throw new AppError('INVALID_STATE');
    const policy = await this.ctx.policyFor(app.creditPolicyVersionId);
    const config = await this.ctx.partnerConfig(app.partnerId);
    const a = await this.latestAssessment(applicationId);
    const financing = app.purchaseAmountKobo - app.contributionAmountKobo;
    return {
      purchase_amount: Number(app.purchaseAmountKobo),
      financing_amount: Number(financing),
      contribution: Number(app.contributionAmountKobo),
      max_eligible_amount: Number(a.maxEligibleKobo),
      options: policy.approvedTenorsMonths
        .filter((t) => config.permittedTenors.includes(t))
        .map((t) => {
          const p = priceDeferredSale(financing, t, policy);
          const affordable = isOfferAffordable(financing, t, a.capacityKobo!, a.remainingExposureKobo! , policy);
          return { tenor_months: t, markup_percent_total: p.markupBps / 100, profit: Number(p.profitAmount), deferred_sale_price: Number(p.deferredSalePrice), monthly_repayment: Number(p.monthlyRepayment), final_instalment: Number(p.instalments[p.instalments.length - 1].amount), affordable };
        }),
    };
  }

  async selectTenor(applicationId: string, body: unknown, req: AuthedRequest) {
    const { tenor_months } = z.object({ tenor_months: z.number().int().positive() }).strict().parse(body);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (!['ELIGIBLE', 'OFFER_PRESENTED'].includes(app.status)) throw new AppError('INVALID_STATE');
      const policy = await this.ctx.policyFor(app.creditPolicyVersionId, tx);
      const config = await this.ctx.partnerConfig(app.partnerId, tx);
      if (!isApprovedTenor(tenor_months, policy) || !config.permittedTenors.includes(tenor_months)) throw new AppError('TENOR_NOT_SUPPORTED');
      const latest = await tx.affordabilityAssessment.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
      if (latest?.outcome === 'CART_REVISION_REQUIRED') throw new AppError('OFFER_NOT_AFFORDABLE', { reason: 'CART_REVISION_REQUIRED' });
      const a = latest && ['ELIGIBLE', 'PARTIAL'].includes(latest.outcome) ? latest : null;
      if (!a) throw new AppError('INVALID_STATE');
      const financing = app.purchaseAmountKobo - app.contributionAmountKobo;
      // Server-side re-verification: the customer cannot select an unaffordable option.
      if (!isOfferAffordable(financing, tenor_months, a.capacityKobo!, a.remainingExposureKobo!, policy)) throw new AppError('OFFER_NOT_AFFORDABLE');
      const pricing = priceDeferredSale(financing, tenor_months, policy);
      await tx.financingOffer.updateMany({ where: { applicationId, status: 'PRESENTED' }, data: { status: 'SUPERSEDED' } });
      const reference = await this.refs.next('OFR', { tx });
      const firstDue = addMonths(new Date(), 1);
      const offer = await tx.financingOffer.create({
        data: {
          reference,
          applicationId,
          policyVersionId: app.creditPolicyVersionId,
          status: 'PRESENTED',
          purchaseAmountKobo: app.purchaseAmountKobo,
          financingAmountKobo: financing,
          contributionKobo: app.contributionAmountKobo,
          tenorMonths: tenor_months,
          markupBps: pricing.markupBps,
          profitKobo: pricing.profitAmount,
          deferredSalePriceKobo: pricing.deferredSalePrice,
          monthlyRepaymentKobo: pricing.monthlyRepayment,
          termsVersion: TERMS_VERSION,
          expiresAt: new Date(Date.now() + policy.offerValidityMinutes * 60_000),
        },
      });
      await tx.repaymentInstalment.createMany({
        data: scheduleWithDates(pricing, firstDue).map((i) => ({ offerId: offer.id, number: i.number, dueDate: i.dueDate, amountKobo: i.amount })),
      });
      if (app.status === 'ELIGIBLE') await this.state.transitionApplication(tx, app, 'OFFER_PRESENTED', req.actor);
      await this.audit.record(req.actor, { action: 'offer.presented', resourceType: 'FINANCING_OFFER', resourceId: offer.id, after: { tenor_months, financing: financing.toString(), dsp: pricing.deferredSalePrice.toString() } }, tx);
    });
    return this.journey.view(applicationId, req);
  }

  async acceptOffer(applicationId: string, body: unknown, req: AuthedRequest) {
    const input = z.object({ offer_id: z.string().uuid(), accept_terms: z.literal(true), share_status_with_merchant: z.boolean().default(true) }).strict().parse(body);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (app.status !== 'OFFER_PRESENTED') throw new AppError('INVALID_STATE');
      const offer = await tx.financingOffer.findFirst({ where: { id: input.offer_id, applicationId, status: 'PRESENTED' } });
      if (!offer) throw new AppError('NOT_FOUND');
      if (offer.expiresAt.getTime() < Date.now()) {
        await tx.financingOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
        throw new AppError('OFFER_EXPIRED');
      }
      // Pricing changes never alter an offer: acceptance is bound to the offer's own policy version.
      const policy = await this.ctx.policyFor(offer.policyVersionId, tx);
      const a = await tx.affordabilityAssessment.findFirst({ where: { applicationId, outcome: { in: ['ELIGIBLE', 'PARTIAL'] } }, orderBy: { createdAt: 'desc' } });
      if (!a || !isOfferAffordable(offer.financingAmountKobo, offer.tenorMonths, a.capacityKobo!, a.remainingExposureKobo!, policy)) throw new AppError('OFFER_NOT_AFFORDABLE');
      // Cart integrity: the order must still match the session snapshot.
      const session = await tx.checkoutSession.findUniqueOrThrow({ where: { id: app.checkoutSessionId } });
      const order = await tx.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } });
      if (order.amountKobo !== app.purchaseAmountKobo || session.amountKobo !== app.purchaseAmountKobo || offer.purchaseAmountKobo !== app.purchaseAmountKobo) throw new AppError('CART_INVALID', { errors: ['CART_CHANGED'] });
      const reservation = await tx.exposureReservation.findUnique({ where: { applicationId } });
      if (!reservation || reservation.status !== 'ACTIVE') throw new AppError('EXPOSURE_LIMIT_EXCEEDED');
      await this.journey.recordConsents(applicationId, ['FINANCING_TERMS', ...(input.share_status_with_merchant ? ['DATA_SHARING'] : [])], req, tx);
      await tx.financingOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      await tx.offerAcceptance.create({ data: { offerId: offer.id, applicationId, termsVersion: offer.termsVersion, termsHash: sha256Hex(TERMS_TEXT), ipAddress: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) } });
      await this.state.transitionApplication(tx, app, 'OFFER_ACCEPTED', req.actor, { data: { financingAmountKobo: offer.financingAmountKobo } });
      await this.state.transitionApplication(tx, app, 'ARAF_SUBMISSION_PENDING', SYSTEM_ACTOR);
      await tx.arafSubmission.create({ data: { applicationId, idempotencyKey: `araf-submit-${applicationId}`, status: 'PENDING', payloadHash: 'pending' } });
      await this.outbox.add(tx, { aggregateType: 'APPLICATION', aggregateId: applicationId, type: 'araf.submit', payload: { applicationId } });
      await this.audit.record(req.actor, { action: 'offer.accepted', resourceType: 'FINANCING_OFFER', resourceId: offer.id, after: { terms_version: offer.termsVersion } }, tx);
      void policy;
    });
    return this.journey.view(applicationId, req);
  }

  async offerSummaryPdf(applicationId: string, offerId: string): Promise<Buffer> {
    const offer = await this.prisma.financingOffer.findFirst({ where: { id: offerId, applicationId }, include: { instalments: { orderBy: { number: 'asc' } } } });
    if (!offer) throw new AppError('NOT_FOUND');
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: app.partnerId } });
    const items = await this.prisma.orderItem.findMany({ where: { orderId: app.orderId } });
    const k = (v: bigint) => formatNaira(v).replace('₦', 'NGN ');
    const lines = [
      `Application: ${app.reference}    Offer: ${offer.reference}`,
      `Merchant: ${partner.tradingName}`,
      `Status: ${offer.status === 'ACCEPTED' ? 'Indicative offer accepted - application submitted for review (NOT final approval)' : 'Indicative offer (NOT final approval)'}`,
      app.environment === 'SANDBOX' ? '*** SANDBOX - SIMULATED - NOT A REAL FINANCING OFFER ***' : '',
      '',
      'Items',
      ...items.map((i) => `  ${i.quantity} x ${i.name} - ${k(i.lineAmountKobo)}`),
      '',
      `Purchase amount:          ${k(offer.purchaseAmountKobo)}`,
      `Customer contribution:    ${k(offer.contributionKobo)}`,
      `Financing amount (cost):  ${k(offer.financingAmountKobo)}`,
      `Profit markup (total):    ${offer.markupBps / 100}% = ${k(offer.profitKobo)}`,
      `Deferred sale price:      ${k(offer.deferredSalePriceKobo)}`,
      `Tenor:                    ${offer.tenorMonths} months`,
      `Monthly repayment:        ${k(offer.monthlyRepaymentKobo)}`,
      `Fees:                     ${k(offer.feesKobo)}`,
      `Offer valid until:        ${offer.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
      '',
      'Repayment schedule',
      ...offer.instalments.map((i) => `  ${String(i.number).padStart(2, ' ')}. ${i.dueDate}   ${k(i.amountKobo)}`),
      '',
      ...TERMS_TEXT.match(/.{1,95}(\s|$)/g)!.map((s) => s.trim()),
      '',
      `Terms version: ${offer.termsVersion}`,
    ];
    return renderSimplePdf('Pay with ARAF - Financing offer summary', lines);
  }
}
