import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { z } from 'zod';
import {
  assessSalary,
  compareEligibilityToCart,
  computeEligibility,
  equityBounds,
  exposureAmountFor,
  validateEquity,
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
  type ProductPricing,
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
/** Affordability outcomes that allow an offer (PARTIAL is the pre-equity legacy name). */
const OFFERABLE_OUTCOMES = ['ELIGIBLE', 'EQUITY_REQUIRED', 'PARTIAL'];
const pricingOf = (x: { annualProfitRateBps: number }): ProductPricing => ({ annualProfitRateBps: x.annualProfitRateBps });

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
    // Both checks are mandatory inputs: the SeedFi credit check (bureau obligations) and the
    // Periculum statement analysis. Affordability never runs on a missing check.
    const credit = await this.prisma.creditAssessment.findFirst({ where: { applicationId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
    const policyVersionId = app.creditPolicyVersionId;
    if (!credit) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, applicationId);
        await tx.affordabilityAssessment.create({ data: { applicationId, policyVersionId, analysisResultId: result.id, incomeProfile: app.incomeProfile ?? 'SALARY_EARNER', outcome: 'MANUAL_REVIEW', reasons: ['CREDIT_CHECK_MISSING'] } });
        await this.routeToReview(tx, locked, 'INCONSISTENT_STATEMENT', 'No completed SeedFi credit check is on file — affordability cannot be computed automatically.', policy);
      });
      return;
    }

    if (app.incomeProfile === 'BUSINESS_OWNER') {
      const turnover = result.businessRevenueMonthlyKobo;
      const reasons = policy.businessOwnerManualReview
        ? ['BUSINESS_OWNER_MANUAL_REVIEW']
        : !result.reliable
          ? ['STATEMENT_UNRELIABLE']
          : !turnover || turnover <= 0n
            ? ['BUSINESS_TURNOVER_NOT_VERIFIED']
            : [];
      if (reasons.length) {
        await this.prisma.$transaction(async (tx) => {
          const locked = await this.ctx.lockApplication(tx, applicationId);
          await tx.affordabilityAssessment.create({ data: { applicationId, policyVersionId, analysisResultId: result.id, incomeProfile: 'BUSINESS_OWNER', outcome: 'MANUAL_REVIEW', reasons } });
          await this.routeToReview(tx, locked, 'BUSINESS_OWNER', `Business owner — ${policy.statementMonths.BUSINESS_OWNER}-month statement analysis requires manual review (${reasons.join(', ')}; ${policy.businessOwnerContactWindowHours.min}–${policy.businessOwnerContactWindowHours.max}h contact target).`, policy);
        });
        return;
      }
      // Business owners: repayments (existing + proposed) may not exceed 10% of average monthly turnover.
      const obligations = resolveExistingObligations(credit.bureauMonthlyObligationsKobo ?? null, result.recurringObligationsKobo, policy);
      const bvn = await this.journey.customerBvn(app.customerId!);
      const c = { correlationId, applicationReference: app.reference, applicationId };
      const exposure = await this.providers.call(app.environment, 'CORE_BANKING', 'customer_exposure', c, () => this.providers.for(app.environment).coreBanking.getCustomerExposure(bvn, c));
      await this.computeAndReserve(applicationId, { recognisedIncome: turnover!, obligations, existingExposure: exposure.totalExposure, analysisResultId: result.id });
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

    const obligations = resolveExistingObligations(credit.bureauMonthlyObligationsKobo ?? null, result.recurringObligationsKobo, policy);
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
      const pricing = pricingOf(app);
      const incomeBasis = app.incomeProfile === 'BUSINESS_OWNER' ? 'BUSINESS_OWNER' : 'SALARY_EARNER';
      const elig = computeEligibility(
        {
          incomeBasis,
          pricing,
          recognisedMonthlyIncome: input.recognisedIncome,
          existingMonthlyObligations: input.obligations,
          exposure: { existingBankExposure: input.existingExposure, otherActiveReservations: others },
          partnerMaxAmount: config.maxTransactionKobo,
          permittedTenors: config.permittedTenors,
        },
        policy,
      );
      const equityEnabled = policy.customerEquityEnabled && config.partialFinancingEnabled;
      const cmp = compareEligibilityToCart(elig.maxEligibleAmount, app.purchaseAmountKobo, equityEnabled, BigInt(policy.minimumFinancingKobo));
      const outcome = cmp.outcome === 'FULL_FINANCING' ? 'ELIGIBLE' : cmp.outcome;
      const reasons = [
        ...(cmp.outcome === 'DECLINED' ? [elig.capacity === 0n ? 'NO_REPAYMENT_CAPACITY' : elig.remainingExposure === 0n ? 'EXPOSURE_LIMIT_REACHED' : cmp.reason] : []),
        ...(cmp.outcome === 'CART_REVISION_REQUIRED' ? ['CART_REVISION_REQUIRED'] : []),
        ...(cmp.outcome === 'EQUITY_REQUIRED' ? ['EQUITY_REQUIRED'] : []),
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
      // Keep a customer's earlier equity choice if it is still valid; otherwise start at the minimum.
      const bounds = equityBounds(app.purchaseAmountKobo, elig.maxEligibleAmount, BigInt(policy.minimumFinancingKobo), equityEnabled);
      const contribution = validateEquity(app.contributionAmountKobo, bounds, equityEnabled) === null ? app.contributionAmountKobo : bounds.minEquity;
      const financing = app.purchaseAmountKobo - contribution;
      const reserveAmount = this.reservationFor(financing, elig.tenors, policy, pricing);
      await tx.exposureReservation.upsert({
        where: { applicationId },
        create: { applicationId, customerId: app.customerId!, amountKobo: reserveAmount, status: 'ACTIVE', expiresAt: new Date(Date.now() + policy.offerValidityMinutes * 60_000 + 7 * 86_400_000) },
        update: { amountKobo: reserveAmount, status: 'ACTIVE', releasedAt: null },
      });
      await tx.financingApplication.update({ where: { id: app.id }, data: { contributionAmountKobo: contribution } });
      await this.journey.emitMerchant(tx, app, 'application.eligible');
    });
  }

  /** Exposure reserved for a financed amount, at the longest tenor that can carry it. */
  private reservationFor(financing: bigint, tenors: Array<{ tenorMonths: number; eligibleAmount: bigint }>, policy: CreditPolicyRules, pricing: ProductPricing) {
    const fits = tenors.filter((t) => t.eligibleAmount >= financing).map((t) => t.tenorMonths);
    return exposureAmountFor(financing, fits.length ? Math.max(...fits) : Math.max(...tenors.map((t) => t.tenorMonths)), policy, pricing);
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
    const a = await this.prisma.affordabilityAssessment.findFirst({ where: { applicationId, outcome: { in: OFFERABLE_OUTCOMES } }, orderBy: { createdAt: 'desc' } });
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
    const pricing = pricingOf(app);
    const financing = app.purchaseAmountKobo - app.contributionAmountKobo;
    const equityEnabled = policy.customerEquityEnabled && config.partialFinancingEnabled;
    const bounds = equityBounds(app.purchaseAmountKobo, a.maxEligibleKobo!, BigInt(policy.minimumFinancingKobo), equityEnabled);
    return {
      purchase_amount: Number(app.purchaseAmountKobo),
      financing_amount: Number(financing),
      contribution: Number(app.contributionAmountKobo),
      max_eligible_amount: Number(a.maxEligibleKobo),
      annual_profit_rate_percent: pricing.annualProfitRateBps / 100,
      max_tenor_months: policy.maxTenorMonths,
      equity: {
        enabled: equityEnabled,
        required: bounds.minEquity > 0n,
        min: Number(bounds.minEquity),
        max: Number(bounds.maxEquity),
        amount: Number(app.contributionAmountKobo),
        payee: 'MERCHANT',
      },
      options: policy.approvedTenorsMonths
        .filter((t) => config.permittedTenors.includes(t) && t <= policy.maxTenorMonths)
        .map((t) => {
          const p = priceDeferredSale(financing, t, policy, pricing);
          const affordable = financing <= a.maxEligibleKobo! && isOfferAffordable(financing, t, a.capacityKobo!, a.remainingExposureKobo!, policy, pricing);
          return { tenor_months: t, annual_profit_rate_percent: pricing.annualProfitRateBps / 100, markup_percent_total: p.markupBps / 100, profit: Number(p.profitAmount), deferred_sale_price: Number(p.deferredSalePrice), monthly_repayment: Number(p.monthlyRepayment), final_instalment: Number(p.instalments[p.instalments.length - 1].amount), affordable };
        }),
    };
  }

  /**
   * Customer equity (down payment) towards the item, paid to the merchant. Equity reduces the
   * BASE amount: financed = purchase − equity, and the profit markup applies only to the financed
   * amount. Changing equity withdraws any presented offer so pricing is always recomputed.
   */
  async setEquity(applicationId: string, body: unknown, req: AuthedRequest) {
    const { amount } = z.object({ amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().parse(body);
    const equity = BigInt(amount);
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      if (!['ELIGIBLE', 'OFFER_PRESENTED'].includes(app.status)) throw new AppError('INVALID_STATE');
      const policy = await this.ctx.policyFor(app.creditPolicyVersionId, tx);
      const config = await this.ctx.partnerConfig(app.partnerId, tx);
      const a = await tx.affordabilityAssessment.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
      if (!a || !OFFERABLE_OUTCOMES.includes(a.outcome)) throw new AppError('INVALID_STATE');
      const enabled = policy.customerEquityEnabled && config.partialFinancingEnabled;
      const bounds = equityBounds(app.purchaseAmountKobo, a.maxEligibleKobo!, BigInt(policy.minimumFinancingKobo), enabled);
      const problem = validateEquity(equity, bounds, enabled);
      if (problem) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'amount', message: problem }], min: Number(bounds.minEquity), max: Number(bounds.maxEquity) });
      const financing = app.purchaseAmountKobo - equity;
      const tenors = (a.tenorBreakdown as Array<{ tenor_months: number; eligible_amount: number }> | null) ?? [];
      const reserve = this.reservationFor(financing, tenors.map((t) => ({ tenorMonths: t.tenor_months, eligibleAmount: BigInt(t.eligible_amount) })), policy, pricingOf(app));
      await tx.exposureReservation.updateMany({ where: { applicationId, status: 'ACTIVE' }, data: { amountKobo: reserve } });
      await tx.financingOffer.updateMany({ where: { applicationId, status: 'PRESENTED' }, data: { status: 'SUPERSEDED' } });
      if (app.status === 'OFFER_PRESENTED') await this.state.transitionApplication(tx, app, 'ELIGIBLE', req.actor, { reason: 'EQUITY_CHANGED' });
      await tx.financingApplication.update({ where: { id: app.id }, data: { contributionAmountKobo: equity, contributionVerified: false, contributionReference: null, contributionConfirmedAt: null } });
      await this.audit.record(req.actor, { action: 'application.equity_selected', resourceType: 'APPLICATION', resourceId: app.id, after: { equity_kobo: equity.toString(), financed_kobo: financing.toString() } }, tx);
    });
    return this.journey.view(applicationId, req);
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
      const a = latest && OFFERABLE_OUTCOMES.includes(latest.outcome) ? latest : null;
      if (!a) throw new AppError('INVALID_STATE');
      const financing = app.purchaseAmountKobo - app.contributionAmountKobo;
      // Server-side re-verification: the customer cannot select an unaffordable option.
      if (financing < BigInt(policy.minimumFinancingKobo)) throw new AppError('OFFER_NOT_AFFORDABLE', { reason: 'BELOW_MINIMUM_FINANCING' });
      if (financing > a.maxEligibleKobo!) throw new AppError('OFFER_NOT_AFFORDABLE', { reason: 'EQUITY_REQUIRED' });
      if (!isOfferAffordable(financing, tenor_months, a.capacityKobo!, a.remainingExposureKobo!, policy, pricingOf(app))) throw new AppError('OFFER_NOT_AFFORDABLE');
      const pricing = priceDeferredSale(financing, tenor_months, policy, pricingOf(app));
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
          markupBps: Math.round(pricing.markupBps),
          annualProfitRateBps: pricing.annualProfitRateBps,
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
      const a = await tx.affordabilityAssessment.findFirst({ where: { applicationId, outcome: { in: OFFERABLE_OUTCOMES } }, orderBy: { createdAt: 'desc' } });
      if (!a || !isOfferAffordable(offer.financingAmountKobo, offer.tenorMonths, a.capacityKobo!, a.remainingExposureKobo!, policy, pricingOf(offer))) throw new AppError('OFFER_NOT_AFFORDABLE');
      // The offer must reflect the customer's current equity choice.
      if (offer.contributionKobo !== app.contributionAmountKobo || offer.financingAmountKobo !== app.purchaseAmountKobo - app.contributionAmountKobo) throw new AppError('INVALID_STATE');
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
      `Equity paid to merchant:  ${k(offer.contributionKobo)}`,
      `Financed by the Bank:     ${k(offer.financingAmountKobo)}  (purchase amount less equity)`,
      `Profit rate:              ${offer.annualProfitRateBps / 100}% per annum, on the financed amount only`,
      `Profit markup (total):    ${(offer.annualProfitRateBps * offer.tenorMonths) / 1200}% over ${offer.tenorMonths} months = ${k(offer.profitKobo)}`,
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
