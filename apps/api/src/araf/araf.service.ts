import { ArafReportingService } from './araf-reporting.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ProviderError } from '@araf/integrations';
import { hmacSha256Hex, randomToken, redact, safeEqual, sha256Hex } from '@araf/security';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService, StateService, SYSTEM_ACTOR, toJsonRaw, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { JourneyService } from '../customer/journey.service';
import { OperationsService } from '../operations/operations.service';

export const arafEventSchema = z
  .object({
    event_id: z.string().min(6).max(80),
    araf_reference: z.string().min(3).max(80),
    sequence: z.number().int().nonnegative(),
    stage: z.enum(['UNDER_REVIEW', 'INFO_REQUESTED', 'INFO_PROVIDED', 'APPROVED', 'REJECTED']),
    decision: z.string().max(80).optional(),
    note: z.string().max(1000).optional(),
    actor_name: z.string().max(120).optional(),
    occurred_at: z.string().datetime(),
  })
  .strict();

export type ArafEvent = z.infer<typeof arafEventSchema>;

const MAX_SUBMISSION_ATTEMPTS = 8;

@Injectable()
export class ArafService {
  private readonly logger = new Logger('ARAF');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly journey: JourneyService,
    private readonly operations: OperationsService,
    private readonly arafReports: ArafReportingService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Build the ARAF handover payload (spec §32). Documents are passed by secure reference. */
  async buildPayload(applicationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const [customer, account, credit, analysis, afford, offer, order, items, consents, vendor, partner, idv] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } }),
      this.prisma.customerAccount.findUniqueOrThrow({ where: { id: app.selectedAccountId! } }),
      this.prisma.creditAssessment.findFirst({ where: { applicationId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.statementAnalysisResult.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.affordabilityAssessment.findFirst({ where: { applicationId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.financingOffer.findFirstOrThrow({ where: { applicationId, status: 'ACCEPTED' }, include: { instalments: { orderBy: { number: 'asc' } } } }),
      this.prisma.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } }),
      this.prisma.orderItem.findMany({ where: { orderId: app.orderId } }),
      this.prisma.customerConsent.findMany({ where: { applicationId } }),
      this.prisma.vendor.findUniqueOrThrow({ where: { id: app.vendorId }, include: { settlementAccounts: { where: { status: 'ACTIVE' } } } }),
      this.prisma.partner.findUniqueOrThrow({ where: { id: app.partnerId } }),
      this.prisma.identityVerification.findFirst({ where: { applicationId, status: 'VERIFIED' } }),
    ]);
    const docs = await this.prisma.storedDocument.findMany({ where: { ownerType: 'APPLICATION', ownerId: applicationId } });
    const s = (v: bigint | null | undefined) => (v === null || v === undefined ? null : v.toString());
    return {
      application_reference: app.reference,
      partner_id: partner.partnerCode,
      partner_name: partner.tradingName,
      merchant_order_reference: order.merchantOrderReference,
      vendor_reference: vendor.vendorReference,
      customer: {
        first_name: customer.firstName,
        last_name: customer.lastName,
        verified_bvn: this.crypto.decrypt(customer.bvnEncrypted, 'customer-bvn'),
        identity_verification_reference: idv?.providerReference,
        income_profile: app.incomeProfile,
      },
      altbank_account: { account_number: this.crypto.decrypt(account.accountNumberEncrypted, `acct:${account.customerId}`), account_name: account.accountName, product: account.productName, source: account.source },
      seedfi_assessment: credit ? { reference: credit.providerReference, score: credit.score, band: credit.band, bureau_monthly_obligations_kobo: s(credit.bureauMonthlyObligationsKobo), delinquency_indicators: credit.delinquencyIndicators, assessed_at: credit.assessedAt } : null,
      periculum_analysis: analysis ? { reference: analysis.analysisReference, period: [analysis.periodStart, analysis.periodEnd], average_inflow_kobo: s(analysis.averageMonthlyInflowKobo), recurring_obligations_kobo: s(analysis.recurringObligationsKobo), statement_quality: analysis.statementQuality, stress_indicators: analysis.stressIndicators } : null,
      affordability: afford ? { income_basis: afford.incomeProfile, repayment_ceiling: afford.incomeProfile === 'BUSINESS_OWNER' ? 'TOTAL_OBLIGATIONS_MAX_10PCT_OF_MONTHLY_TURNOVER' : 'TOTAL_OBLIGATIONS_MAX_33_3PCT_OF_MONTHLY_SALARY', recognised_income_kobo: s(afford.recognisedMonthlyIncomeKobo), existing_obligations_kobo: s(afford.existingMonthlyObligationsKobo), capacity_kobo: s(afford.capacityKobo), max_eligible_kobo: s(afford.maxEligibleKobo), remaining_exposure_kobo: s(afford.remainingExposureKobo) } : null,
      financing: {
        purchase_amount_kobo: s(offer.purchaseAmountKobo),
        // Equity is paid by the customer to the merchant; only the remainder is financed and marked up.
        customer_equity_kobo: s(offer.contributionKobo),
        requested_amount_kobo: s(offer.financingAmountKobo),
        eligible_amount_kobo: s(app.eligibleAmountKobo),
        contribution_kobo: s(offer.contributionKobo),
        tenor_months: offer.tenorMonths,
        annual_profit_rate_bps: offer.annualProfitRateBps,
        markup_bps_total: offer.markupBps,
        profit_kobo: s(offer.profitKobo),
        deferred_sale_price_kobo: s(offer.deferredSalePriceKobo),
        schedule: offer.instalments.map((i) => ({ n: i.number, due: i.dueDate, amount_kobo: i.amountKobo.toString() })),
      },
      cart_snapshot: items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, unit_amount_kobo: i.unitAmountKobo.toString(), category: i.category })),
      vendor_invoice_reference: `INV-${app.reference}`,
      settlement_beneficiary: vendor.settlementAccounts[0] ? { bank: vendor.settlementAccounts[0].bankName, account_masked: vendor.settlementAccounts[0].accountNumberMasked, account_name: vendor.settlementAccounts[0].accountName } : null,
      consents: consents.map((c) => ({ type: c.consentType, version: c.version, accepted_at: c.acceptedAt })),
      document_references: docs.map((d) => ({ id: d.id, kind: d.kind, sha256: d.sha256 })),
      policy_version_id: app.creditPolicyVersionId,
      submitted_at: new Date().toISOString(),
    };
  }

  /**
   * Idempotent submission. On timeout we first ask ARAF whether the application already exists
   * (by idempotency key) before any retry. The customer is told "submitted" only after ARAF acknowledges.
   */
  async submit(applicationId: string): Promise<void> {
    const sub = await this.prisma.arafSubmission.findUnique({ where: { applicationId } });
    if (!sub || sub.status === 'ACKNOWLEDGED' || sub.status === 'FAILED') return;
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'ARAF_SUBMISSION_PENDING') return;
    const c = { correlationId: `araf-${sub.id}`, applicationReference: app.reference, applicationId };
    const araf = this.providers.for(app.environment).araf;
    const payload = await this.buildPayload(applicationId);
    const payloadHash = sha256Hex(JSON.stringify(payload));
    await this.prisma.arafSubmission.update({ where: { id: sub.id }, data: { status: 'SUBMITTING', attempts: { increment: 1 }, payloadHash } });
    let arafReference: string | null = null;
    try {
      if (sub.status === 'UNCERTAIN' || sub.attempts > 0) {
        const existing = await this.providers.call(app.environment, 'ARAF', 'find_by_key', c, () => araf.findByIdempotencyKey(sub.idempotencyKey, c));
        arafReference = existing?.arafReference ?? null;
      }
      if (!arafReference) {
        const submitPayload = app.environment === 'SANDBOX' ? (redact(payload) as Record<string, unknown>) : payload;
        ({ arafReference } = await this.providers.call(app.environment, 'ARAF', 'submit', c, () => araf.submit({ ...submitPayload, application_reference: app.reference }, sub.idempotencyKey, c)));
      }
    } catch (e) {
      const timeout = e instanceof ProviderError && e.code === 'TIMEOUT';
      const attempts = sub.attempts + 1;
      const failed = attempts >= MAX_SUBMISSION_ATTEMPTS;
      await this.prisma.arafSubmission.update({
        where: { id: sub.id },
        data: { status: failed ? 'FAILED' : timeout ? 'UNCERTAIN' : 'RETRY_SCHEDULED', lastError: (e as Error).message.slice(0, 300), nextAttemptAt: new Date(Date.now() + Math.min(600_000, 5_000 * 2 ** attempts)) },
      });
      if (attempts >= 3) {
        await this.prisma.$transaction((tx) =>
          this.ctx.raiseException(tx, { code: 'ARAF_UNAVAILABLE', category: 'ARAF_SUBMISSION', application: app, severity: failed ? 'HIGH' : 'MEDIUM', responsibleTeam: 'TECHNOLOGY', retryEligible: true, detail: `ARAF submission failing after ${attempts} attempts: ${(e as Error).message}`.slice(0, 500) }, SYSTEM_ACTOR),
        );
      }
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, applicationId);
      await tx.arafSubmission.update({ where: { id: sub.id }, data: { status: 'ACKNOWLEDGED', arafReference, acknowledgedAt: new Date(), lastError: null } });
      await this.state.transitionApplication(tx, locked, 'ARAF_SUBMITTED', SYSTEM_ACTOR, { data: { arafReference, submittedAt: new Date() } });
      await this.journey.emitMerchant(tx, locked, 'application.submitted');
      await this.journey.notifyCustomer(tx, locked, 'APPLICATION_SUBMITTED');
      await this.ctx.resolveExceptions(tx, applicationId, ['ARAF_UNAVAILABLE'], 'ARAF acknowledged submission', SYSTEM_ACTOR);
      await this.audit.record(SYSTEM_ACTOR, { action: 'araf.submitted', resourceType: 'APPLICATION', resourceId: applicationId, partnerId: locked.partnerId, after: { arafReference } }, tx);
    });
  }

  async retryDueSubmissions(): Promise<number> {
    const due = await this.prisma.arafSubmission.findMany({ where: { status: { in: ['PENDING', 'RETRY_SCHEDULED', 'UNCERTAIN'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, take: 20 });
    for (const s of due) await this.submit(s.applicationId).catch((e) => this.logger.error(`submit ${s.applicationId}: ${(e as Error).message}`));
    return due.length;
  }

  // ---- Inbound status events (authoritative ARAF workflow → Pay with ARAF) --------------

  /**
   * ARAF callbacks. Connected to the real ARAF: `X-ARAF-Signature: v1=<HMAC-SHA256(ARAF_INTEGRATION_SECRET,
   * "<timestamp>.POST./api/callbacks/araf.<raw body>")>` with `X-ARAF-Timestamp` within 300 s. The sandbox
   * simulator path keeps its internal signature.
   */
  private verifyCallback(rawBody: Buffer, signature: string, timestamp?: string): boolean {
    if (this.config.ARAF_MODE === 'connected' && this.config.ARAF_INTEGRATION_SECRET) {
      const t = Number(timestamp);
      if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
      const expected = `v1=${hmacSha256Hex(this.config.ARAF_INTEGRATION_SECRET, Buffer.concat([Buffer.from(`${t}.POST./api/callbacks/araf.`), rawBody]))}`;
      return safeEqual(signature, expected);
    }
    return safeEqual(signature, hmacSha256Hex(this.config.INTERNAL_CALLBACK_SECRET, rawBody));
  }

  async callback(rawBody: Buffer | undefined, signature: string | undefined, timestamp?: string) {
    if (!rawBody || !signature || !this.verifyCallback(rawBody, signature, timestamp)) throw new AppError('UNAUTHENTICATED');
    return this.ingest(arafEventSchema.parse(JSON.parse(rawBody.toString('utf8'))), { type: 'PROVIDER', id: 'araf', label: 'ARAF workflow' });
  }

  async ingest(event: ArafEvent, actor: Actor) {
    const app = await this.prisma.financingApplication.findFirst({ where: { arafReference: event.araf_reference } });
    if (!app) throw new AppError('NOT_FOUND');
    const dup = await this.prisma.arafStatusEvent.findUnique({ where: { eventId: event.event_id } });
    if (dup) return { outcome: 'DUPLICATE' };
    const last = await this.prisma.arafStatusEvent.findFirst({ where: { applicationId: app.id, outcome: 'APPLIED' }, orderBy: { sequence: 'desc' } });
    const record = await this.prisma.arafStatusEvent.create({
      data: { applicationId: app.id, arafReference: event.araf_reference, eventId: event.event_id, sequence: event.sequence, stage: event.stage, decision: event.decision, note: event.note, actorName: event.actor_name, occurredAt: new Date(event.occurred_at) },
    });
    // Out-of-order protection: a stale event never overwrites a newer authoritative status.
    if (last && event.sequence <= last.sequence) {
      await this.prisma.arafStatusEvent.update({ where: { id: record.id }, data: { outcome: 'IGNORED_STALE', processedAt: new Date() } });
      return { outcome: 'IGNORED_STALE' };
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, app.id);
        switch (event.stage) {
          case 'UNDER_REVIEW':
          case 'INFO_PROVIDED':
            await this.state.transitionApplication(tx, locked, 'ARAF_UNDER_REVIEW', actor, { reason: event.stage });
            if (event.stage === 'UNDER_REVIEW') await this.journey.emitMerchant(tx, locked, 'application.under_review');
            break;
          case 'INFO_REQUESTED':
            if (locked.status === 'ARAF_SUBMITTED') await this.state.transitionApplication(tx, locked, 'ARAF_UNDER_REVIEW', actor);
            await this.state.transitionApplication(tx, locked, 'ADDITIONAL_INFORMATION_REQUIRED', actor, { reason: event.note });
            await this.journey.emitMerchant(tx, locked, 'application.action_required');
            await this.journey.notifyCustomer(tx, locked, 'ADDITIONAL_INFO_REQUIRED');
            break;
          case 'REJECTED':
            if (locked.status === 'ARAF_SUBMITTED') await this.state.transitionApplication(tx, locked, 'ARAF_UNDER_REVIEW', actor);
            await this.state.transitionApplication(tx, locked, 'DECLINED', actor, { reason: 'ARAF_REJECTED', data: { declineReasonCode: 'ARAF_REJECTED' } });
            await tx.exposureReservation.updateMany({ where: { applicationId: app.id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedAt: new Date() } });
            await this.journey.emitMerchant(tx, locked, 'application.declined');
            await this.journey.notifyCustomer(tx, locked, 'FINANCING_DECLINED');
            break;
          case 'APPROVED':
            if (locked.status === 'ARAF_SUBMITTED') await this.state.transitionApplication(tx, locked, 'ARAF_UNDER_REVIEW', actor);
            await this.state.transitionApplication(tx, locked, 'FINANCING_APPROVED', actor, { reason: event.decision });
            await this.journey.emitMerchant(tx, locked, 'financing.approved');
            await this.operations.onFinancingApproved(tx, locked, actor);
            break;
        }
        await tx.arafStatusEvent.update({ where: { id: record.id }, data: { outcome: 'APPLIED', processedAt: new Date() } });
      });
    } catch (e) {
      await this.prisma.arafStatusEvent.update({ where: { id: record.id }, data: { outcome: 'REJECTED_INVALID', processedAt: new Date() } });
      throw e;
    }
    return { outcome: 'APPLIED' };
  }

  /** Customer responds to an ARAF information request. */
  async customerProvidesInfo(applicationId: string, note: string, actor: Actor) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'ADDITIONAL_INFORMATION_REQUIRED' || !app.arafReference) throw new AppError('INVALID_STATE');
    if (this.config.ARAF_MODE === 'connected') {
      // The real ARAF receives the customer's answer and returns the case to review (INFO_PROVIDED callback).
      await this.prisma.$transaction((tx) => this.arafReports.record(tx, app, 'CUSTOMER_INFORMATION_PROVIDED', { note: note.slice(0, 1000) }));
      await this.audit.record(actor, { action: 'araf.customer_information_sent', resourceType: 'APPLICATION', resourceId: app.id });
      return { outcome: 'SENT_TO_ARAF' };
    }
    if (app.environment === 'SANDBOX') {
      const c = await this.prisma.simArafCase.findUniqueOrThrow({ where: { arafReference: app.arafReference } });
      await this.prisma.simArafAction.create({ data: { caseId: c.id, stage: c.stage, action: 'CUSTOMER_RESPONDED', actorId: 'customer', actorName: 'Customer', note: note.slice(0, 1000) } });
      await this.simResumeAfterInfo(c.id);
      return this.simEmit(c.id, 'INFO_PROVIDED', 'Customer provided information', actor);
    }
    throw new AppError('INTEGRATION_NOT_CONFIGURED');
  }

  // ---- SANDBOX ARAF workflow simulator ---------------------------------------------------

  private async simEmit(caseId: string, stage: ArafEvent['stage'], note: string, actor: Actor, decision?: string) {
    const c = await this.prisma.simArafCase.update({ where: { id: caseId }, data: { sequence: { increment: 1 } } });
    return this.ingest(
      { event_id: randomToken('arafevt_', 20), araf_reference: c.arafReference, sequence: c.sequence, stage, note, decision, actor_name: actor.label, occurred_at: new Date().toISOString() },
      { ...actor, type: 'PROVIDER', label: `ARAF simulator (${actor.label})` },
    );
  }

  async simCases(stage?: string) {
    const cases = await this.prisma.simArafCase.findMany({ where: { stage: stage || undefined }, include: { actions: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const apps = new Map((await this.prisma.financingApplication.findMany({ where: { reference: { in: cases.map((c) => c.applicationRef) } } })).map((a) => [a.reference, a]));
    return cases.map((c) => {
      const app = apps.get(c.applicationRef);
      return {
        id: c.id,
        araf_reference: c.arafReference,
        application_reference: c.applicationRef,
        application_id: app?.id,
        application_status: app?.status,
        stage: c.stage,
        financing_amount: app?.financingAmountKobo ? Number(app.financingAmountKobo) : null,
        created_at: c.createdAt,
        actions: c.actions.map((a) => ({ stage: a.stage, action: a.action, actor: a.actorName, note: a.note, at: a.createdAt })),
      };
    });
  }

  /**
   * Proposed sandbox route: RECEIVED → BUSINESS_EVALUATION → CREDIT_REVIEW → APPROVAL → APPROVED.
   * The real ARAF hierarchy must be inherited from the Bank's workflow (not invented here).
   */
  async simAct(caseId: string, body: unknown, actor: Actor) {
    const { action, note } = z.object({ action: z.enum(['START_EVALUATION', 'COMPLETE_EVALUATION', 'REQUEST_INFO', 'RECOMMEND_APPROVAL', 'APPROVE', 'REJECT', 'RETURN_FOR_CORRECTION']), note: z.string().min(3).max(1000) }).strict().parse(body);
    const c = await this.prisma.simArafCase.findUnique({ where: { id: caseId }, include: { actions: true } });
    if (!c) throw new AppError('NOT_FOUND');
    const perms = actor.permissions ?? [];
    const need = action === 'APPROVE' ? 'araf.simulator.approve' : 'araf.simulator.operate';
    if (!perms.includes(need) && !(action === 'REJECT' && perms.includes('araf.simulator.approve'))) throw new AppError('FORBIDDEN');
    const transitions: Record<string, { from: string[]; to: string }> = {
      START_EVALUATION: { from: ['RECEIVED'], to: 'BUSINESS_EVALUATION' },
      COMPLETE_EVALUATION: { from: ['BUSINESS_EVALUATION'], to: 'CREDIT_REVIEW' },
      REQUEST_INFO: { from: ['BUSINESS_EVALUATION', 'CREDIT_REVIEW'], to: 'INFO_REQUESTED' },
      RETURN_FOR_CORRECTION: { from: ['APPROVAL'], to: 'CREDIT_REVIEW' },
      RECOMMEND_APPROVAL: { from: ['CREDIT_REVIEW'], to: 'APPROVAL' },
      APPROVE: { from: ['APPROVAL'], to: 'APPROVED' },
      REJECT: { from: ['BUSINESS_EVALUATION', 'CREDIT_REVIEW', 'APPROVAL'], to: 'REJECTED' },
    };
    const t = transitions[action];
    if (!t.from.includes(c.stage)) throw new AppError('INVALID_STATE');
    if (action === 'APPROVE') {
      const recommender = [...c.actions].reverse().find((a) => a.action === 'RECOMMEND_APPROVAL');
      // Maker-checker: the approver cannot be the officer who recommended approval.
      if (recommender?.actorId === actor.id) throw new AppError('MAKER_CHECKER_VIOLATION');
    }
    await this.prisma.$transaction([
      this.prisma.simArafCase.update({ where: { id: caseId }, data: { stage: t.to } }),
      this.prisma.simArafAction.create({ data: { caseId, stage: c.stage, action, actorId: actor.id!, actorName: actor.label ?? 'Staff', note } }),
    ]);
    await this.audit.record(actor, { action: `araf_simulator.${action.toLowerCase()}`, resourceType: 'SIM_ARAF_CASE', resourceId: caseId, reason: note });
    if (action === 'START_EVALUATION') return this.simEmit(caseId, 'UNDER_REVIEW', note, actor);
    if (action === 'REQUEST_INFO') return this.simEmit(caseId, 'INFO_REQUESTED', note, actor);
    if (action === 'APPROVE') return this.simEmit(caseId, 'APPROVED', note, actor, 'APPROVED');
    if (action === 'REJECT') return this.simEmit(caseId, 'REJECTED', note, actor, 'REJECTED');
    return { outcome: 'STAGE_UPDATED' };
  }

  /** Sandbox: after the customer responds, move the simulated case back to its prior stage. */
  async simResumeAfterInfo(caseId: string) {
    const c = await this.prisma.simArafCase.findUniqueOrThrow({ where: { id: caseId }, include: { actions: { orderBy: { createdAt: 'desc' } } } });
    if (c.stage !== 'INFO_REQUESTED') return;
    const prev = c.actions.find((a) => a.action === 'REQUEST_INFO')?.stage ?? 'BUSINESS_EVALUATION';
    await this.prisma.simArafCase.update({ where: { id: caseId }, data: { stage: prev } });
  }

  stageList() {
    return toJsonRaw(['RECEIVED', 'BUSINESS_EVALUATION', 'CREDIT_REVIEW', 'APPROVAL', 'APPROVED', 'INFO_REQUESTED', 'REJECTED']);
  }
}
