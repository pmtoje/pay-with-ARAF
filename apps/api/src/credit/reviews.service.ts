import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  PROPOSED_SANDBOX_POLICY,
  availableMonthlyCapacity,
  classifyScore,
  computeEligibility,
  creditPolicyRulesSchema,
  formatNaira,
  maxAffordableFinancing,
  parsePolicyRules,
  priceDeferredSale,
} from '@araf/business-rules';
import type { ApprovalRequest } from '@araf/database';
import { POLICY_CODE } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, StateService, SYSTEM_ACTOR, toJsonRaw, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { EligibilityService } from './eligibility.service';
import { JourneyService } from '../customer/journey.service';

const decisionSchema = z
  .object({
    decision: z.enum(['CLEAR', 'DECLINE', 'REQUEST_CLARIFICATION', 'ESCALATE']),
    reason: z.string().min(5).max(1000),
    evidence: z.string().max(2000).optional(),
    /** For affordability reviews (business owners / uncertain salary): the reviewer-assessed income. */
    assessed_monthly_income_naira: z.number().int().positive().optional(),
    assessed_monthly_obligations_naira: z.number().int().min(0).optional(),
  })
  .strict();

@Injectable()
export class ReviewsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly approvals: ApprovalsService,
    private readonly eligibility: EligibilityService,
    private readonly journey: JourneyService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.approvals.register('REVIEW_DECISION', {
      onApprove: async (tx, req, checker) => this.applyDecision(tx, req, checker),
      onReject: async (tx, req) => {
        await tx.reviewDecision.update({ where: { id: (req.payload as { decisionId: string }).decisionId }, data: { status: 'REJECTED' } });
        await tx.enhancedReview.update({ where: { id: req.resourceId }, data: { status: 'PENDING' } });
      },
      afterApprove: async (req, checker) => this.afterDecision(req, checker),
    });
    this.approvals.register('CREDIT_POLICY', {
      onApprove: async (tx, req, checker) => {
        const v = await tx.creditPolicyVersion.findUniqueOrThrow({ where: { id: req.resourceId } });
        if (v.makerId === checker.id) throw new AppError('MAKER_CHECKER_VIOLATION');
        await tx.creditPolicyVersion.updateMany({ where: { policyId: v.policyId, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
        // Approval via this workflow activates the version; it remains flagged PROPOSED until
        // formal Credit Risk / Shariah / Legal sign-off is recorded outside the system.
        await tx.creditPolicyVersion.update({ where: { id: v.id }, data: { status: 'ACTIVE', checkerId: checker.id, approvedAt: new Date(), effectiveFrom: new Date() } });
      },
      onReject: async (tx, req) => {
        await tx.creditPolicyVersion.update({ where: { id: req.resourceId }, data: { status: 'REJECTED' } });
      },
    });
  }

  // ---- Queues ------------------------------------------------------------------------------

  async queue(queue?: string, status?: string) {
    const rows = await this.prisma.enhancedReview.findMany({
      where: { queue: queue || undefined, status: status ? status : { in: ['PENDING', 'AWAITING_CUSTOMER', 'CLARIFICATION_REQUESTED', 'DECISION_PENDING_APPROVAL', 'ESCALATED'] } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const apps = new Map((await this.prisma.financingApplication.findMany({ where: { id: { in: rows.map((r) => r.applicationId) } } })).map((a) => [a.id, a]));
    const partners = new Map((await this.prisma.partner.findMany({ select: { id: true, tradingName: true } })).map((p) => [p.id, p.tradingName]));
    return rows.map((r) => {
      const app = apps.get(r.applicationId)!;
      return {
        id: r.id,
        queue: r.queue,
        status: r.status,
        application_id: app.id,
        application_reference: app.reference,
        application_status: app.status,
        partner: partners.get(app.partnerId),
        purchase_amount: Number(app.purchaseAmountKobo),
        income_profile: app.incomeProfile,
        sla_due_at: r.slaDueAt,
        sla_breached: !!r.slaDueAt && r.slaDueAt < new Date(),
        assigned_to_id: r.assignedToId,
        created_at: r.createdAt,
      };
    });
  }

  async detail(reviewId: string, actor: Actor) {
    const r = await this.prisma.enhancedReview.findUnique({ where: { id: reviewId }, include: { decisions: { orderBy: { createdAt: 'desc' } } } });
    if (!r) throw new AppError('NOT_FOUND');
    await this.audit.record(actor, { action: 'review.viewed', resourceType: 'ENHANCED_REVIEW', resourceId: reviewId });
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: r.applicationId } });
    const [credit, analysis, afford] = await Promise.all([
      this.prisma.creditAssessment.findFirst({ where: { applicationId: app.id, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.statementAnalysisResult.findFirst({ where: { applicationId: app.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.affordabilityAssessment.findFirst({ where: { applicationId: app.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: r.decisions.map((d) => d.reviewerId) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      id: r.id,
      queue: r.queue,
      status: r.status,
      note: r.clarificationNote,
      application: { id: app.id, reference: app.reference, status: app.status, purchase_amount: Number(app.purchaseAmountKobo), income_profile: app.incomeProfile },
      form: r.formDataEncrypted ? this.crypto.decryptJson(r.formDataEncrypted, `review:${r.id}`) : null,
      credit: credit ? { score: credit.score, band: credit.band, bureau_obligations: credit.bureauMonthlyObligationsKobo ? Number(credit.bureauMonthlyObligationsKobo) : null, delinquency: credit.delinquencyIndicators, provider_reference: credit.providerReference } : null,
      analysis: analysis
        ? { period: [analysis.periodStart, analysis.periodEnd], average_inflow: Number(analysis.averageMonthlyInflowKobo), average_outflow: Number(analysis.averageMonthlyOutflowKobo), business_revenue: analysis.businessRevenueMonthlyKobo ? Number(analysis.businessRevenueMonthlyKobo) : null, recurring_obligations: Number(analysis.recurringObligationsKobo), stress: analysis.stressIndicators, quality: analysis.statementQuality, consistency: analysis.cashFlowConsistency }
        : null,
      affordability: afford ? { outcome: afford.outcome, reasons: afford.reasons, months: afford.monthBreakdown } : null,
      decisions: r.decisions.map((d) => ({ decision: d.decision, reason: d.reason, reviewer: users.get(d.reviewerId) ?? d.reviewerId, status: d.status, at: d.createdAt })),
      requires_checker: true,
    };
  }

  async decide(reviewId: string, body: unknown, actor: Actor) {
    const input = decisionSchema.parse(body);
    const review = await this.prisma.enhancedReview.findUnique({ where: { id: reviewId } });
    if (!review || !['PENDING', 'ESCALATED'].includes(review.status)) throw new AppError('INVALID_STATE');
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: review.applicationId } });
    const isAffordabilityReview = app.status === 'AFFORDABILITY_REVIEW_REQUIRED';
    if (input.decision === 'CLEAR' && isAffordabilityReview && !input.assessed_monthly_income_naira) {
      throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'assessed_monthly_income_naira', message: 'Assessed monthly income is required to clear an affordability review' }] });
    }
    const policy = await this.ctx.policyFor(app.creditPolicyVersionId);
    return this.prisma.$transaction(async (tx) => {
      const decision = await tx.reviewDecision.create({
        data: { reviewId, decision: input.decision, reason: input.reason, evidence: input.evidence, reviewerId: actor.id!, policyVersionId: app.creditPolicyVersionId, status: 'PENDING_APPROVAL' },
      });
      await this.audit.record(actor, { action: 'review.decision_proposed', resourceType: 'ENHANCED_REVIEW', resourceId: reviewId, after: { decision: input.decision }, reason: input.reason }, tx);
      if (input.decision === 'REQUEST_CLARIFICATION' || input.decision === 'ESCALATE' || !policy.enhancedReviewRequiresChecker) {
        const req = { payload: { decisionId: decision.id, ...input }, resourceId: reviewId } as unknown as ApprovalRequest;
        await this.applyDecision(tx, req, actor);
        return { status: 'APPLIED', decision_id: decision.id, after: () => this.afterDecision(req, actor) };
      }
      await tx.enhancedReview.update({ where: { id: reviewId }, data: { status: 'DECISION_PENDING_APPROVAL' } });
      const approval = await this.approvals.create(tx, { type: 'REVIEW_DECISION', resourceType: 'ENHANCED_REVIEW', resourceId: reviewId, partnerId: app.partnerId, payload: { decisionId: decision.id, ...input }, summary: `${input.decision} ${app.reference} (${review.queue})`, comment: input.reason }, actor);
      return { status: 'PENDING_APPROVAL', approval_reference: approval.reference };
    }).then(async (r) => {
      if ('after' in r && r.after) await r.after();
      return { status: r.status, ...(('approval_reference' in r) ? { approval_reference: r.approval_reference } : {}) };
    });
  }

  private async applyDecision(tx: Tx, req: ApprovalRequest, actor: Actor) {
    const payload = req.payload as z.infer<typeof decisionSchema> & { decisionId: string };
    const review = await tx.enhancedReview.findUniqueOrThrow({ where: { id: req.resourceId } });
    const app = await this.ctx.lockApplication(tx, review.applicationId);
    await tx.reviewDecision.update({ where: { id: payload.decisionId }, data: { status: 'EFFECTIVE', approvalId: req.id ?? null } });
    switch (payload.decision) {
      case 'REQUEST_CLARIFICATION':
        await tx.enhancedReview.update({ where: { id: review.id }, data: { status: 'CLARIFICATION_REQUESTED', clarificationNote: payload.reason } });
        if (app.status === 'ENHANCED_REVIEW_PENDING') await this.state.transitionApplication(tx, app, 'ENHANCED_REVIEW_REQUIRED', actor, { reason: 'CLARIFICATION_REQUESTED' });
        if (app.status === 'AFFORDABILITY_REVIEW_REQUIRED') await this.state.transitionApplication(tx, app, 'STATEMENT_PENDING', actor, { reason: 'STATEMENT_CORRECTION_REQUESTED' });
        await this.journey.notifyCustomer(tx, app, 'ADDITIONAL_INFO_REQUIRED');
        break;
      case 'ESCALATE':
        await tx.enhancedReview.update({ where: { id: review.id }, data: { status: 'ESCALATED' } });
        break;
      case 'DECLINE':
        await tx.enhancedReview.update({ where: { id: review.id }, data: { status: 'DECLINED' } });
        await this.state.transitionApplication(tx, app, 'DECLINED', actor, { reason: 'REVIEW_DECLINED', data: { declineReasonCode: 'REVIEW_DECLINED' } });
        await tx.exposureReservation.updateMany({ where: { applicationId: app.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
        await this.journey.emitMerchant(tx, app, 'application.declined');
        await this.journey.notifyCustomer(tx, app, 'FINANCING_DECLINED');
        break;
      case 'CLEAR':
        await tx.enhancedReview.update({ where: { id: review.id }, data: { status: 'CLEARED' } });
        if (app.status === 'ENHANCED_REVIEW_PENDING') {
          await this.state.transitionApplication(tx, app, 'ENHANCED_REVIEW_CLEARED', actor);
          await this.state.transitionApplication(tx, app, 'ACCOUNT_VERIFICATION_PENDING', SYSTEM_ACTOR);
          await this.journey.emitMerchant(tx, app, 'application.action_required');
        }
        break;
    }
  }

  /** Affordability clearance runs outside the approval tx because it calls core banking for exposure. */
  private async afterDecision(req: ApprovalRequest, actor: Actor) {
    const payload = req.payload as z.infer<typeof decisionSchema>;
    if (payload.decision !== 'CLEAR' || !payload.assessed_monthly_income_naira) return;
    const review = await this.prisma.enhancedReview.findUniqueOrThrow({ where: { id: req.resourceId } });
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: review.applicationId } });
    if (app.status !== 'AFFORDABILITY_REVIEW_REQUIRED') return;
    const bvn = await this.journey.customerBvn(app.customerId!);
    const c = { correlationId: `review-${review.id}`, applicationReference: app.reference, applicationId: app.id };
    const exposure = await this.providers.call(app.environment, 'CORE_BANKING', 'customer_exposure', c, () => this.providers.for(app.environment).coreBanking.getCustomerExposure(bvn, c));
    const analysis = await this.prisma.statementAnalysisResult.findFirst({ where: { applicationId: app.id }, orderBy: { createdAt: 'desc' } });
    // The reviewer supplies the assessed income; the Bank's deterministic engine still computes eligibility.
    await this.eligibility.computeAndReserve(app.id, {
      recognisedIncome: BigInt(payload.assessed_monthly_income_naira) * 100n,
      obligations: BigInt(payload.assessed_monthly_obligations_naira ?? 0) * 100n,
      existingExposure: exposure.totalExposure,
      analysisResultId: analysis?.id ?? null,
    });
    await this.audit.record(actor, { action: 'review.affordability_cleared', resourceType: 'APPLICATION', resourceId: app.id });
  }

  // ---- Credit policy management --------------------------------------------------------

  async policies() {
    const policy = await this.prisma.creditPolicy.findUniqueOrThrow({ where: { code: POLICY_CODE }, include: { versions: { orderBy: { version: 'desc' } } } });
    const users = new Map((await this.prisma.user.findMany({ where: { type: 'STAFF' }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return {
      code: policy.code,
      name: policy.name,
      description: policy.description,
      versions: policy.versions.map((v) => ({ id: v.id, version: v.version, status: v.status, is_proposed: v.isProposed, change_summary: v.changeSummary, rules: v.rules, maker: v.makerId ? users.get(v.makerId) : 'System seed', checker: v.checkerId ? users.get(v.checkerId) : null, effective_from: v.effectiveFrom, created_at: v.createdAt })),
    };
  }

  async proposePolicy(body: unknown, actor: Actor) {
    const { rules, change_summary } = z.object({ rules: z.unknown(), change_summary: z.string().min(5).max(1000) }).strict().parse(body);
    const parsed = creditPolicyRulesSchema.safeParse(rules);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', { fields: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const policy = await this.prisma.creditPolicy.findUniqueOrThrow({ where: { code: POLICY_CODE } });
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.creditPolicyVersion.findFirst({ where: { policyId: policy.id }, orderBy: { version: 'desc' } });
      const v = await tx.creditPolicyVersion.create({ data: { policyId: policy.id, version: (last?.version ?? 0) + 1, status: 'PENDING_APPROVAL', rules: toJsonRaw(parsed.data), changeSummary: change_summary, isProposed: true, makerId: actor.id } });
      await this.approvals.create(tx, { type: 'CREDIT_POLICY', resourceType: 'CREDIT_POLICY_VERSION', resourceId: v.id, payload: { version: v.version }, summary: `Credit policy v${v.version}: ${change_summary}`.slice(0, 300), comment: change_summary }, actor);
      return { id: v.id, version: v.version, status: v.status };
    });
  }

  /** What-if simulation for a policy (no side effects). */
  simulate(body: unknown) {
    const input = z
      .object({
        rules: z.unknown().optional(),
        score: z.number().int().nullable().optional(),
        monthly_income_naira: z.number().int().min(0),
        monthly_obligations_naira: z.number().int().min(0),
        existing_exposure_naira: z.number().int().min(0).default(0),
        cart_naira: z.number().int().positive(),
        /** Customer equity paid to the merchant; only cart − equity is financed. */
        equity_naira: z.number().int().min(0).default(0),
        income_basis: z.enum(['SALARY_EARNER', 'BUSINESS_OWNER']).default('SALARY_EARNER'),
        annual_profit_rate_percent: z.number().min(0).max(100).optional(),
      })
      .strict()
      .parse(body);
    const policy = input.rules ? parsePolicyRules(input.rules) : PROPOSED_SANDBOX_POLICY;
    const K = (n: number) => BigInt(n) * 100n;
    const credit = input.score === undefined ? null : classifyScore(input.score, policy);
    const pricing = { annualProfitRateBps: input.annual_profit_rate_percent === undefined ? policy.defaultAnnualProfitRateBps : Math.round(input.annual_profit_rate_percent * 100) };
    if (input.equity_naira >= input.cart_naira) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'equity_naira', message: 'Equity must be less than the cart' }] });
    const toFinance = K(input.cart_naira - input.equity_naira);
    const elig = computeEligibility(
      { incomeBasis: input.income_basis, pricing, recognisedMonthlyIncome: K(input.monthly_income_naira), existingMonthlyObligations: K(input.monthly_obligations_naira), exposure: { existingBankExposure: K(input.existing_exposure_naira), otherActiveReservations: 0n }, partnerMaxAmount: null },
      policy,
    );
    return {
      credit,
      income_basis: input.income_basis,
      annual_profit_rate_percent: pricing.annualProfitRateBps / 100,
      financed_amount: Number(toFinance),
      capacity: Number(availableMonthlyCapacity(K(input.monthly_income_naira), K(input.monthly_obligations_naira), policy, input.income_basis)),
      max_eligible: Number(elig.maxEligibleAmount),
      tenors: elig.tenors.map((t) => {
        const finance = t.eligibleAmount < toFinance ? t.eligibleAmount : toFinance;
        const p = priceDeferredSale(finance, t.tenorMonths, policy, pricing);
        return { tenor_months: t.tenorMonths, markup_percent: t.markupBps / 100, max_affordable: Number(maxAffordableFinancing(elig.capacity, t.tenorMonths, policy, pricing)), eligible: Number(t.eligibleAmount), limiting_factor: t.limitingFactor, financing_for_cart: Number(finance), monthly_repayment: Number(p.monthlyRepayment), deferred_sale_price: Number(p.deferredSalePrice), display: `${formatNaira(finance)} over ${t.tenorMonths}m → ${formatNaira(p.monthlyRepayment)}/month` };
      }),
    };
  }
}
