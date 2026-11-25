import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { deriveCustomerStatus, deriveMerchantStatus, type ApplicationState } from '@araf/business-rules';
import { PROVIDER_CAPABILITY_MATRIX, SANDBOX_IDENTITIES, FORCED, type ForcedOutcome } from '@araf/integrations';
import { BANK_ROLES } from '@araf/types';
import type { Prisma } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PartnersService } from '../partners/partners.service';
import { OperationsService } from '../operations/operations.service';
import { n } from '../applications/presenters';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly providers: ProvidersService,
    private readonly approvals: ApprovalsService,
    private readonly partners: PartnersService,
    private readonly ops: OperationsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.approvals.register('ROLE_ASSIGNMENT', {
      onApprove: async (tx, req, checker) => {
        const p = req.payload as { userId?: string; email: string; fullName: string; roles: string[]; expiresAt?: string };
        if (p.userId) {
          const roles = await tx.role.findMany({ where: { code: { in: p.roles }, scope: 'STAFF' } });
          await tx.userRole.deleteMany({ where: { userId: p.userId } });
          await tx.userRole.createMany({ data: roles.map((r) => ({ userId: p.userId!, roleId: r.id, grantedById: checker.id, approvalId: req.id, expiresAt: p.expiresAt ? new Date(p.expiresAt) : null })) });
          await tx.session.updateMany({ where: { userId: p.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ROLES_CHANGED' } });
        } else {
          await this.partners.createInvitation(tx, { email: p.email, fullName: p.fullName, type: 'STAFF', roleCodes: p.roles }, checker);
        }
      },
    });
  }

  // ---- Applications ------------------------------------------------------------------------

  async listApplications(q: { status?: string; partner_id?: string; search?: string; page?: string; page_size?: string; sort?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const size = Math.min(100, Math.max(5, Number(q.page_size ?? 25)));
    const where: Prisma.FinancingApplicationWhereInput = {
      environment: this.config.PLATFORM_ENVIRONMENT,
      status: q.status ? { in: q.status.split(',') as never } : undefined,
      partnerId: q.partner_id || undefined,
      OR: q.search ? [{ reference: { contains: q.search, mode: 'insensitive' } }, { arafReference: { contains: q.search, mode: 'insensitive' } }] : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.financingApplication.findMany({ where, orderBy: { createdAt: q.sort === 'asc' ? 'asc' : 'desc' }, skip: (page - 1) * size, take: size }),
      this.prisma.financingApplication.count({ where }),
    ]);
    const partners = new Map((await this.prisma.partner.findMany({ select: { id: true, tradingName: true } })).map((p) => [p.id, p.tradingName]));
    const orders = new Map((await this.prisma.merchantOrder.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, merchantOrderReference: true } })).map((o) => [o.id, o.merchantOrderReference]));
    return {
      page,
      page_size: size,
      total,
      data: rows.map((a) => ({
        id: a.id,
        reference: a.reference,
        partner: partners.get(a.partnerId),
        partner_id: a.partnerId,
        merchant_order_reference: orders.get(a.orderId),
        status: a.status,
        customer_status: deriveCustomerStatus(a.status as ApplicationState).label,
        purchase_amount: n(a.purchaseAmountKobo),
        financing_amount: n(a.financingAmountKobo),
        araf_reference: a.arafReference,
        income_profile: a.incomeProfile,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
      })),
    };
  }

  async applicationDetail(id: string, actor: Actor) {
    const app = await this.prisma.financingApplication.findFirst({ where: { id, environment: this.config.PLATFORM_ENVIRONMENT } });
    if (!app) throw new AppError('NOT_FOUND');
    const sensitive = !!actor.permissions?.includes('application.read.sensitive');
    await this.audit.record(actor, { action: sensitive ? 'application.viewed_sensitive' : 'application.viewed', resourceType: 'APPLICATION', resourceId: id, partnerId: app.partnerId });
    const [partner, order, items, history, customer, account, credit, analysis, afford, offers, araf, arafEvents, conds, docs, mandate, booking, payments, release, fulfilment, exceptions, reviews, connections, cancellations, returns, refunds, storedDocs] = await Promise.all([
      this.prisma.partner.findUniqueOrThrow({ where: { id: app.partnerId } }),
      this.prisma.merchantOrder.findUniqueOrThrow({ where: { id: app.orderId } }),
      this.prisma.orderItem.findMany({ where: { orderId: app.orderId } }),
      this.prisma.stateTransition.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'asc' } }),
      app.customerId ? this.prisma.customer.findUnique({ where: { id: app.customerId } }) : null,
      app.selectedAccountId ? this.prisma.customerAccount.findUnique({ where: { id: app.selectedAccountId } }) : null,
      this.prisma.creditAssessment.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.statementAnalysisResult.findFirst({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.affordabilityAssessment.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.financingOffer.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.arafSubmission.findUnique({ where: { applicationId: id } }),
      this.prisma.arafStatusEvent.findMany({ where: { applicationId: id }, orderBy: { sequence: 'asc' } }),
      this.prisma.contractualCondition.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.financingDocument.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.repaymentMandate.findUnique({ where: { applicationId: id } }),
      this.prisma.bookingRecord.findUnique({ where: { applicationId: id } }),
      this.prisma.vendorPaymentInstruction.findMany({ where: { applicationId: id }, include: { events: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.releaseAuthorization.findUnique({ where: { applicationId: id } }),
      this.prisma.fulfilmentRecord.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.operationalException.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.enhancedReview.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.statementConnection.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.cancellationRequest.findMany({ where: { applicationId: id } }),
      this.prisma.returnRequest.findMany({ where: { applicationId: id } }),
      this.prisma.refundRecord.findMany({ where: { applicationId: id } }),
      this.prisma.storedDocument.findMany({ where: { ownerType: 'APPLICATION', ownerId: id } }),
    ]);
    const gate = await this.ops.releaseGateInput(id).then((g) => import('@araf/business-rules').then((m) => m.evaluateReleaseGate(g.input))).then((g) => ({ authorized: g.authorized, blockers: g.blockers, pending_conditions: g.pendingConditions }));
    const paymentBlockers = app.status === 'FINANCING_BOOKED' ? await this.ops.paymentPreconditions(id) : null;
    return {
      id: app.id,
      reference: app.reference,
      status: app.status,
      merchant_status: deriveMerchantStatus(app.status as ApplicationState),
      customer_status: deriveCustomerStatus(app.status as ApplicationState),
      version: app.version,
      exception_return_state: app.exceptionReturnState,
      holds: app.holds,
      partner: { id: partner.id, name: partner.tradingName, code: partner.partnerCode },
      order: { reference: order.merchantOrderReference, status: order.status, amount: n(order.amountKobo), items: items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.quantity, unit_amount: n(i.unitAmountKobo), line_amount: n(i.lineAmountKobo), category: i.category })) },
      amounts: { purchase: n(app.purchaseAmountKobo), eligible: sensitive ? n(app.eligibleAmountKobo) : undefined, financing: n(app.financingAmountKobo), contribution: n(app.contributionAmountKobo) },
      income_profile: app.incomeProfile,
      customer: customer ? { name: `${customer.firstName} ${customer.lastName}`, bvn: `•••••••${customer.bvnLast4}`, phone: customer.phoneMasked } : null,
      account: account ? { number: account.accountNumberMasked, name: account.accountName, product: account.productName, source: account.source } : null,
      sensitive_access: sensitive,
      credit: sensitive ? credit.map((c) => ({ status: c.status, score: c.score, band: c.band, outcome: c.outcome, failure: c.failureCode, bureau_obligations: n(c.bureauMonthlyObligationsKobo), delinquency: c.delinquencyIndicators, at: c.createdAt })) : undefined,
      analysis: sensitive && analysis ? { reference: analysis.analysisReference, period: [analysis.periodStart, analysis.periodEnd], holder: analysis.accountHolderName, ownership: analysis.ownershipConfidence, average_inflow: n(analysis.averageMonthlyInflowKobo), average_outflow: n(analysis.averageMonthlyOutflowKobo), recurring_obligations: n(analysis.recurringObligationsKobo), business_revenue: n(analysis.businessRevenueMonthlyKobo), stress: analysis.stressIndicators, quality: analysis.statementQuality, confidence: analysis.confidence } : undefined,
      affordability: sensitive ? afford.map((a) => ({ outcome: a.outcome, reasons: a.reasons, income: n(a.recognisedMonthlyIncomeKobo), obligations: n(a.existingMonthlyObligationsKobo), capacity: n(a.capacityKobo), existing_exposure: n(a.existingExposureKobo), remaining_exposure: n(a.remainingExposureKobo), max_eligible: n(a.maxEligibleKobo), tenors: a.tenorBreakdown, months: a.monthBreakdown, policy_version_id: a.policyVersionId, at: a.createdAt })) : undefined,
      statement_connections: connections.map((c) => ({ channel: c.channel, status: c.status, findings: c.validationFindings, ownership: sensitive ? c.ownershipConfidence : undefined, period: [c.periodStart, c.periodEnd], at: c.createdAt })),
      documents_stored: storedDocs.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, size: d.sizeBytes, scan: d.scanStatus })),
      offers: offers.map((o) => ({ reference: o.reference, status: o.status, tenor: o.tenorMonths, financing: n(o.financingAmountKobo), profit: n(o.profitKobo), dsp: n(o.deferredSalePriceKobo), monthly: n(o.monthlyRepaymentKobo), markup_bps: o.markupBps, expires_at: o.expiresAt, policy_version_id: o.policyVersionId })),
      araf: araf ? { status: araf.status, reference: araf.arafReference, attempts: araf.attempts, last_error: araf.lastError, events: arafEvents.map((e) => ({ stage: e.stage, sequence: e.sequence, outcome: e.outcome, note: e.note, actor: e.actorName, at: e.occurredAt })) } : null,
      conditions: conds.map((c) => ({ code: c.code, description: c.description, status: c.status, evidence: c.evidenceRef, satisfied_at: c.satisfiedAt })),
      financing_documents: docs.map((d) => ({ id: d.id, type: d.docType, version: d.version, status: d.status, signed_at: d.signedAt })),
      mandate: mandate ? { status: mandate.status, reference: mandate.mandateReference, failure: mandate.failureCode } : null,
      booking: booking ? { status: booking.status, reference: booking.bookingReference, failure: booking.failureCode, booked_at: booking.bookedAt } : null,
      payments: payments.map((p) => ({ id: p.id, reference: p.reference, status: p.status, amount: n(p.amountKobo), beneficiary: `${p.beneficiaryName} · ${p.beneficiaryBankName} ${p.beneficiaryAccountMasked}`, provider_reference: p.providerReference, simulated: p.isSimulated, authoritative: p.confirmedByAuthoritativeSource, reconciliation: p.reconciliationStatus, events: p.events.map((e) => ({ status: e.status, source: e.source, detail: e.detail, at: e.createdAt })) })),
      payment_blockers: paymentBlockers,
      release: release ? { reference: release.reference, status: release.status, authorized_at: release.authorizedAt, suspended_reason: release.suspensionReason, simulated: release.isSimulated } : null,
      release_gate: gate,
      fulfilment: fulfilment.map((f) => ({ status: f.status, tracking: f.trackingReference, carrier: f.carrier, note: f.note, actor: f.actorType, at: f.createdAt })),
      exceptions: exceptions.map((e) => ({ id: e.id, reference: e.reference, code: e.code, status: e.status, severity: e.severity, team: e.responsibleTeam, detail: e.detail, at: e.createdAt })),
      reviews: reviews.map((r) => ({ id: r.id, queue: r.queue, status: r.status })),
      cancellations: cancellations.map((c) => ({ id: c.id, by: c.initiatedBy, stage: c.stage, reason: c.reason, status: c.status, requires_reversal: c.requiresReversal })),
      returns: returns.map((r) => ({ id: r.id, type: r.type, reason: r.reason, status: r.status })),
      refunds: refunds.map((r) => ({ reference: r.reference, status: r.status, expected: n(r.expectedAmountKobo), received: n(r.receivedAmountKobo) })),
      history: history.map((h) => ({ machine: h.machine, from: h.fromState, to: h.toState, actor: h.actorType, reason: h.reason, at: h.createdAt })),
      environment: app.environment,
      created_at: app.createdAt,
      expires_at: app.expiresAt,
    };
  }

  async openStoredDocument(applicationId: string, documentId: string, actor: Actor) {
    const doc = await this.prisma.storedDocument.findFirst({ where: { id: documentId, ownerType: 'APPLICATION', ownerId: applicationId } });
    if (!doc) throw new AppError('NOT_FOUND');
    await this.audit.record(actor, { action: 'document.accessed', resourceType: 'STORED_DOCUMENT', resourceId: doc.id, partnerId: doc.partnerId });
    return { doc, data: await this.providers.storage.get(doc.storageKey) };
  }

  // ---- Audit ------------------------------------------------------------------------------------

  async searchAudit(q: { action?: string; actor_id?: string; resource_type?: string; resource_id?: string; partner_id?: string; from?: string; to?: string; outcome?: string; page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const where: Prisma.AuditLogWhereInput = {
      action: q.action ? { contains: q.action } : undefined,
      actorId: q.actor_id || undefined,
      resourceType: q.resource_type || undefined,
      resourceId: q.resource_id || undefined,
      partnerId: q.partner_id || undefined,
      outcome: q.outcome || undefined,
      occurredAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [rows, total] = await Promise.all([this.prisma.auditLog.findMany({ where, orderBy: { sequence: 'desc' }, skip: (page - 1) * 50, take: 50 }), this.prisma.auditLog.count({ where })]);
    return { page, total, data: rows.map((r) => ({ id: r.id, sequence: Number(r.sequence), at: r.occurredAt, actor_type: r.actorType, actor: r.actorLabel ?? r.actorId, roles: r.actorRoles, action: r.action, resource_type: r.resourceType, resource_id: r.resourceId, partner_id: r.partnerId, outcome: r.outcome, reason: r.reason, before: r.before, after: r.after, ip: r.ipAddress, correlation_id: r.correlationId, hash: r.hash.slice(0, 16) })) };
  }

  // ---- Users & roles ----------------------------------------------------------------------------

  async listStaff() {
    const users = await this.prisma.user.findMany({ where: { type: 'STAFF' }, include: { roles: { include: { role: true } } }, orderBy: { fullName: 'asc' } });
    return {
      users: users.map((u) => ({ id: u.id, email: u.email, full_name: u.fullName, status: u.status, last_login_at: u.lastLoginAt, roles: u.roles.map((r) => ({ code: r.role.code, name: r.role.name, expires_at: r.expiresAt })) })),
      roles: BANK_ROLES.map((r) => ({ code: r.code, name: r.name, description: r.description, permissions: r.permissions })),
    };
  }

  async proposeRoles(body: unknown, actor: Actor) {
    const input = z
      .object({ user_id: z.string().uuid().optional(), email: z.string().email().optional(), full_name: z.string().min(2).max(120).optional(), roles: z.array(z.string()).min(1), temporary_days: z.number().int().min(1).max(30).optional(), reason: z.string().min(5).max(500) })
      .strict()
      .parse(body);
    if (input.roles.some((r) => !BANK_ROLES.some((b) => b.code === r))) throw new AppError('VALIDATION_FAILED');
    if (input.user_id === actor.id) throw new AppError('MAKER_CHECKER_VIOLATION', undefined, 'You cannot change your own roles.');
    const user = input.user_id ? await this.prisma.user.findFirst({ where: { id: input.user_id, type: 'STAFF' } }) : null;
    if (input.user_id && !user) throw new AppError('NOT_FOUND');
    if (!user && (!input.email || !input.full_name)) throw new AppError('VALIDATION_FAILED');
    return this.prisma.$transaction((tx) =>
      this.approvals.create(
        tx,
        {
          type: 'ROLE_ASSIGNMENT',
          resourceType: 'USER',
          resourceId: user?.id ?? `invite:${input.email!.toLowerCase()}`,
          payload: { userId: user?.id, email: user?.email ?? input.email, fullName: user?.fullName ?? input.full_name, roles: input.roles, expiresAt: input.temporary_days ? new Date(Date.now() + input.temporary_days * 86_400_000).toISOString() : undefined },
          summary: `${user ? 'Change roles for' : 'Invite'} ${user?.email ?? input.email}: ${input.roles.join(', ')}${input.temporary_days ? ` (temporary ${input.temporary_days}d)` : ''}`,
          comment: input.reason,
        },
        actor,
      ),
    );
  }

  async setStaffStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED', reason: string, actor: Actor) {
    if (userId === actor.id) throw new AppError('FORBIDDEN');
    const u = await this.prisma.user.findFirst({ where: { id: userId, type: 'STAFF' } });
    if (!u) throw new AppError('NOT_FOUND');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      if (status === 'SUSPENDED') await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'SUSPENDED' } });
      await this.audit.record(actor, { action: 'user.status_changed', resourceType: 'USER', resourceId: userId, before: { status: u.status }, after: { status }, reason }, tx);
    });
    return { ok: true };
  }

  async revokeUserSessions(userId: string, actor: Actor) {
    const r = await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' } });
    await this.audit.record(actor, { action: 'user.sessions_revoked', resourceType: 'USER', resourceId: userId, after: { count: r.count } });
    return { revoked: r.count };
  }

  // ---- Exceptions, reconciliation, integrations ------------------------------------------------

  async exceptions(q: { status?: string; category?: string; team?: string }) {
    const rows = await this.prisma.operationalException.findMany({
      where: { environment: this.config.PLATFORM_ENVIRONMENT, status: q.status ? { in: q.status.split(',') } : { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] }, category: q.category || undefined, responsibleTeam: q.team || undefined },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    const apps = new Map((await this.prisma.financingApplication.findMany({ where: { id: { in: rows.map((r) => r.applicationId!).filter(Boolean) } }, select: { id: true, reference: true, status: true, exceptionReturnState: true } })).map((a) => [a.id, a]));
    return rows.map((e) => ({ id: e.id, reference: e.reference, code: e.code, category: e.category, severity: e.severity, team: e.responsibleTeam, status: e.status, retry_eligible: e.retryEligible, escalated: e.escalated, detail: e.detail, customer_message: e.customerMessage, history: e.history, application: e.applicationId ? apps.get(e.applicationId) : null, created_at: e.createdAt, resolved_at: e.resolvedAt }));
  }

  async reconciliation() {
    const runs = await this.prisma.reconciliationRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 });
    const findings = await this.prisma.reconciliationFinding.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const payments = await this.prisma.vendorPaymentInstruction.findMany({ where: { environment: this.config.PLATFORM_ENVIRONMENT }, orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      runs,
      findings: findings.map((f) => ({ ...f })),
      payments: payments.map((p) => ({ id: p.id, reference: p.reference, application_id: p.applicationId, status: p.status, amount: n(p.amountKobo), beneficiary: p.beneficiaryAccountMasked, provider_reference: p.providerReference, reconciliation: p.reconciliationStatus, simulated: p.isSimulated, confirmed_at: p.confirmedAt, created_at: p.createdAt })),
    };
  }

  async resolveFinding(id: string, resolution: string, actor: Actor) {
    await this.prisma.reconciliationFinding.update({ where: { id }, data: { status: 'RESOLVED', resolution, resolvedById: actor.id, resolvedAt: new Date() } });
    await this.audit.record(actor, { action: 'reconciliation.finding_resolved', resourceType: 'RECONCILIATION_FINDING', resourceId: id, reason: resolution });
    return { ok: true };
  }

  async integrations() {
    const recent = await this.prisma.integrationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return {
      environment: this.config.PLATFORM_ENVIRONMENT,
      live_operations_enabled: this.config.LIVE_OPERATIONS_ENABLED,
      capability_matrix: PROVIDER_CAPABILITY_MATRIX,
      recent_calls: recent.map((r) => ({ provider: r.provider, operation: r.operation, outcome: r.outcome, error: r.errorCode, latency_ms: r.latencyMs, simulated: r.isSimulated, at: r.createdAt })),
      production_gates: [
        'Approved Bank architecture', 'Confirmed SeedFi integration', 'Confirmed Mono integration', 'Confirmed Periculum integration', 'Confirmed identity verification integration',
        'Confirmed account opening integration', 'Confirmed ARAF integration', 'Confirmed Remita integration', 'Confirmed core banking integration', 'Confirmed vendor payment integration',
        'Approved credit policy', 'Approved financing product structure', 'Approved Shariah contractual sequence', 'Approved partner agreements', 'Approved settlement arrangements',
        'Approved privacy notices', 'Security assessment', 'Penetration testing', 'UAT', 'Reconciliation testing', 'Disaster recovery validation', 'Stakeholder sign-offs',
      ].map((g) => ({ gate: g, status: 'OUTSTANDING' })),
    };
  }

  async webhookDeliveries(q: { partner_id?: string; status?: string }) {
    const rows = await this.prisma.webhookDelivery.findMany({ where: { status: q.status || undefined, event: { partnerId: q.partner_id || undefined } }, include: { event: true, endpoint: { select: { url: true, partnerId: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((d) => ({ id: d.id, event_id: d.eventId, type: d.event.type, partner_id: d.event.partnerId, endpoint: d.endpoint.url, status: d.status, attempts: d.attemptCount, last_status_code: d.lastStatusCode, last_error: d.lastError, next_attempt_at: d.nextAttemptAt, created_at: d.createdAt }));
  }

  async bankNotifications() {
    return this.prisma.notification.findMany({ where: { audience: 'BANK', environment: this.config.PLATFORM_ENVIRONMENT }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ---- Sandbox simulator controls ---------------------------------------------------------------

  sandboxScenarios() {
    if (!this.config.sandboxToolsEnabled) throw new AppError('NOT_FOUND');
    return SANDBOX_IDENTITIES.map((i) => ({ scenario: i.scenario, title: i.title, description: i.description, bvn: i.bvn, date_of_birth: i.dateOfBirth, name: `${i.firstName} ${i.lastName}`, suggested_path: i.suggestedPath, forced: i.forced ?? [] }));
  }

  async setForcedOutcomes(applicationId: string, outcomes: ForcedOutcome[], actor: Actor) {
    if (!this.config.sandboxToolsEnabled) throw new AppError('NOT_FOUND');
    const app = await this.prisma.financingApplication.findFirstOrThrow({ where: { id: applicationId, environment: 'SANDBOX' } });
    await this.providers.simStore.put(FORCED, app.reference, { outcomes });
    await this.audit.record(actor, { action: 'sandbox.forced_outcomes_set', resourceType: 'APPLICATION', resourceId: applicationId, after: { outcomes } });
    return { outcomes };
  }

  async simulateReversal(applicationId: string, actor: Actor) {
    if (!this.config.sandboxToolsEnabled) throw new AppError('NOT_FOUND');
    const p = await this.prisma.vendorPaymentInstruction.findFirst({ where: { applicationId, status: 'CONFIRMED', environment: 'SANDBOX' } });
    if (!p) throw new AppError('INVALID_STATE');
    await this.providers.sandbox.payments.reverseSimulated(p.idempotencyKey);
    await this.audit.record(actor, { action: 'sandbox.payment_reversal_simulated', resourceType: 'VENDOR_PAYMENT_INSTRUCTION', resourceId: p.id });
    return { status: await this.ops.reconcileInstruction(p.id, actor) };
  }

  async decryptedSettlementAccount(accountId: string) {
    const a = await this.prisma.vendorSettlementAccount.findUniqueOrThrow({ where: { id: accountId } });
    return this.crypto.decrypt(a.accountNumberEncrypted, `settlement:${a.vendorId}`);
  }
}
