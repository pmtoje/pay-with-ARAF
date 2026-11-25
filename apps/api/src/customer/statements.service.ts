import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { requiredMonths } from '@araf/business-rules';
import { ProviderError, type AnalysisSource, type RawStatement } from '@araf/integrations';
import { sha256Hex } from '@araf/security';
import type { FinancingApplication } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AuditService, StateService, SYSTEM_ACTOR, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { EligibilityService } from '../credit/eligibility.service';
import { JourneyService } from './journey.service';
import type { AuthedRequest } from '../auth/auth.guard';

const normaliseName = (s: string) => s.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);

/** Name-based ownership confidence between a statement holder and the verified customer. */
export function ownershipConfidence(holder: string, first: string, last: string): 'HIGH' | 'MEDIUM' | 'MISMATCH' {
  const h = new Set(normaliseName(holder));
  const f = normaliseName(first).every((p) => h.has(p));
  const l = normaliseName(last).every((p) => h.has(p));
  return f && l ? 'HIGH' : f || l ? 'MEDIUM' : 'MISMATCH';
}

export interface PdfInspection {
  ok: boolean;
  code?: 'PDF_INVALID' | 'PDF_ENCRYPTED';
  findings: string[];
}

/**
 * Structural PDF validation. Never trusts filename or declared MIME type; rejects active
 * content (JavaScript, launch actions, embedded files) and encrypted documents.
 */
export function inspectPdf(buf: Buffer): PdfInspection {
  const findings: string[] = [];
  if (buf.length < 64 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, code: 'PDF_INVALID', findings: ['NOT_A_PDF'] };
  const text = buf.toString('latin1');
  if (!/%%EOF\s*$/.test(text.slice(-1024))) findings.push('MISSING_EOF_MARKER');
  if (!/\/Type\s*\/Catalog/.test(text)) findings.push('MISSING_CATALOG');
  if (/\/Encrypt\b/.test(text)) return { ok: false, code: 'PDF_ENCRYPTED', findings: ['ENCRYPTED'] };
  for (const [re, f] of [
    [/\/JavaScript\b|\/JS\b/, 'ACTIVE_CONTENT_JAVASCRIPT'],
    [/\/Launch\b/, 'ACTIVE_CONTENT_LAUNCH'],
    [/\/EmbeddedFile\b/, 'EMBEDDED_FILE'],
    [/\/OpenAction\b/, 'OPEN_ACTION'],
    [/\/RichMedia\b/, 'RICH_MEDIA'],
  ] as const) {
    if (re.test(text)) findings.push(f);
  }
  // Tampering indicators (recorded for review; not automatically fatal).
  const incrementalUpdates = (text.match(/%%EOF/g) ?? []).length - 1;
  if (incrementalUpdates > 0) findings.push(`INCREMENTAL_UPDATES:${incrementalUpdates}`);
  if (/\/Producer\s*\((?:[^)]*)(Photoshop|GIMP|Canva|Word)/i.test(text)) findings.push('NON_BANK_PRODUCER');
  const fatal = findings.some((f) => f.startsWith('ACTIVE_CONTENT') || f === 'EMBEDDED_FILE' || f === 'OPEN_ACTION' || f === 'RICH_MEDIA' || f === 'MISSING_CATALOG' || f === 'MISSING_EOF_MARKER');
  return fatal ? { ok: false, code: 'PDF_INVALID', findings } : { ok: true, findings };
}

@Injectable()
export class StatementsService {
  private readonly logger = new Logger('Statements');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: StateService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly journey: JourneyService,
    private readonly eligibility: EligibilityService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private months(app: FinancingApplication) {
    return app.incomeProfile === 'BUSINESS_OWNER' ? 12 : 6;
  }

  private callCtx(app: FinancingApplication, req: { correlationId: string }) {
    return { correlationId: req.correlationId, applicationReference: app.reference, applicationId: app.id };
  }

  private async requireStatementStage(applicationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    if (app.status !== 'STATEMENT_PENDING' || !app.incomeProfile) throw new AppError('INVALID_STATE');
    return app;
  }

  /** Coverage: the statement must span the full required complete months. */
  private coverage(stmt: RawStatement, months: number) {
    const req = requiredMonths(new Date(), months);
    const first = `${req[0]}-01`;
    const lastMonth = req[req.length - 1];
    const [y, m] = lastMonth.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { ok: stmt.periodStart <= first && stmt.periodEnd >= last, first, last };
  }

  private async acceptTransactions(app: FinancingApplication, channel: 'ALTBANK' | 'MONO', stmt: RawStatement, providerReference: string, accountId: string | null, actor: Actor, correlationId: string) {
    const months = this.months(app);
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } });
    const owner = ownershipConfidence(stmt.accountName, customer.firstName, customer.lastName);
    const cov = this.coverage(stmt, months);
    const findings = [...(cov.ok ? [] : ['INSUFFICIENT_COVERAGE']), ...(owner === 'MISMATCH' ? ['OWNERSHIP_MISMATCH'] : [])];
    const status = owner === 'MISMATCH' ? 'REJECTED' : cov.ok ? 'VALIDATED' : 'INSUFFICIENT';
    const conn = await this.prisma.statementConnection.create({
      data: {
        applicationId: app.id,
        channel,
        status,
        providerReference,
        accountId,
        periodStart: stmt.periodStart,
        periodEnd: stmt.periodEnd,
        requiredMonths: months,
        ownershipConfidence: owner,
        validationFindings: findings,
        normalizedEncrypted: this.crypto.encryptJson(stmt, `stmt:${app.id}`),
        failureCode: status === 'VALIDATED' ? null : status === 'REJECTED' ? 'STATEMENT_OWNERSHIP_MISMATCH' : 'STATEMENT_COVERAGE_INSUFFICIENT',
      },
    });
    await this.audit.record(actor, { action: 'statement.received', resourceType: 'STATEMENT_CONNECTION', resourceId: conn.id, after: { channel, status, findings } });
    if (status !== 'VALIDATED') {
      throw new AppError(status === 'REJECTED' ? 'STATEMENT_OWNERSHIP_MISMATCH' : 'STATEMENT_COVERAGE_INSUFFICIENT', { channel, alternatives: ['MONO', 'PDF_UPLOAD'].filter((c) => c !== channel) });
    }
    await this.submitForAnalysis(app, conn.id, { kind: 'TRANSACTIONS', statement: stmt, origin: channel }, actor, correlationId);
  }

  private async submitForAnalysis(app: FinancingApplication, connectionId: string, source: AnalysisSource, actor: Actor, correlationId: string) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, app.id);
      await this.state.transitionApplication(tx, locked, 'STATEMENT_RECEIVED', actor);
      await this.state.transitionApplication(tx, locked, 'STATEMENT_VALIDATION_PENDING', SYSTEM_ACTOR);
      await this.state.transitionApplication(tx, locked, 'STATEMENT_ANALYSIS_PENDING', SYSTEM_ACTOR);
    });
    const job = await this.prisma.statementAnalysisJob.create({ data: { applicationId: app.id, connectionId, provider: 'PERICULUM', status: 'QUEUED' } });
    try {
      const { jobRef } = await this.providers.call(app.environment, 'PERICULUM', 'submit_analysis', this.callCtx(app, { correlationId }), () =>
        this.providers.for(app.environment).periculum.submit({ reference: app.reference, source, months: this.months(app) }, this.callCtx(app, { correlationId })),
      );
      await this.prisma.statementAnalysisJob.update({ where: { id: job.id }, data: { status: 'SUBMITTED', providerJobRef: jobRef, submittedAt: new Date(), attempts: 1 } });
      await this.prisma.statementConnection.update({ where: { id: connectionId }, data: { status: 'SUBMITTED_FOR_ANALYSIS' } });
    } catch (e) {
      await this.failAnalysis(job.id, e instanceof ProviderError ? e.code : 'SUBMIT_FAILED', actor);
      throw new AppError('ANALYSIS_PROVIDER_UNAVAILABLE');
    }
  }

  private async failAnalysis(jobId: string, code: string, actor: Actor) {
    const job = await this.prisma.statementAnalysisJob.update({ where: { id: jobId }, data: { status: 'FAILED', failureCode: code } });
    await this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, job.applicationId);
      if (app.status === 'STATEMENT_ANALYSIS_PENDING') {
        // Data / technical problems route back to statement acquisition — never an automatic decline.
        await this.state.transitionApplication(tx, app, 'STATEMENT_PENDING', actor, { reason: `ANALYSIS_FAILED:${code}` });
      }
      await this.ctx.raiseException(tx, { code: 'ANALYSIS_PROVIDER_UNAVAILABLE', category: 'ANALYSIS', application: app, severity: 'MEDIUM', responsibleTeam: 'TECHNOLOGY', retryEligible: true, detail: `Periculum analysis failed (${code}). Customer asked to retry or use another channel.` }, actor);
    });
  }

  // ---- Channel 1: AltBank ---------------------------------------------------------------

  async fromAltBank(applicationId: string, req: AuthedRequest) {
    const app = await this.requireStatementStage(applicationId);
    if (!(await this.prisma.customerConsent.findFirst({ where: { applicationId, consentType: 'STATEMENT_ACCESS' } }))) {
      await this.journey.recordConsents(applicationId, ['STATEMENT_ACCESS', 'THIRD_PARTY_ANALYSIS'], req);
    }
    const account = await this.prisma.customerAccount.findUniqueOrThrow({ where: { id: app.selectedAccountId! } });
    const accountNumber = this.crypto.decrypt(account.accountNumberEncrypted, `acct:${account.customerId}`);
    const months = this.months(app);
    const req0 = requiredMonths(new Date(), months)[0];
    const stmt = await this.providers.call(app.environment, 'ALTBANK', 'get_statement', this.callCtx(app, req), () =>
      this.providers.for(app.environment).bankAccounts.getStatement(accountNumber, `${req0}-01`, new Date().toISOString().slice(0, 10), this.callCtx(app, req)),
    );
    await this.acceptTransactions(app, 'ALTBANK', stmt, `ALTBANK:${account.accountNumberMasked}`, account.id, req.actor, req.correlationId);
    return this.journey.view(applicationId, req);
  }

  // ---- Channel 2: Mono -----------------------------------------------------------------

  async createMonoSession(applicationId: string, req: AuthedRequest) {
    const app = await this.requireStatementStage(applicationId);
    await this.journey.recordConsents(applicationId, ['STATEMENT_ACCESS', 'THIRD_PARTY_ANALYSIS'], req);
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } });
    const res = await this.providers.call(app.environment, 'MONO', 'connect_session', this.callCtx(app, req), () =>
      this.providers.for(app.environment).mono.createConnectSession(
        { reference: app.reference, customerName: `${customer.firstName} ${customer.lastName}`, redirectUrl: `${this.config.CHECKOUT_BASE_URL}/c/${app.checkoutSessionId}/statements/mono` },
        this.callCtx(app, req),
      ),
    );
    return { connect_url: res.connectUrl };
  }

  async exchangeMono(applicationId: string, body: unknown, req: AuthedRequest) {
    const { code } = z.object({ code: z.string().min(8).max(200) }).strict().parse(body);
    const app = await this.requireStatementStage(applicationId);
    const mono = this.providers.for(app.environment).mono;
    const c = this.callCtx(app, req);
    let accountId: string;
    try {
      ({ accountId } = await this.providers.call(app.environment, 'MONO', 'exchange_code', c, () => mono.exchangeCode(code, c)));
    } catch {
      throw new AppError('MONO_CONNECTION_FAILED');
    }
    const identity = await this.providers.call(app.environment, 'MONO', 'account_identity', c, () => mono.getAccountIdentity(accountId, c));
    const stmt = await this.providers.call(app.environment, 'MONO', 'statement', c, () => mono.getStatement(accountId, this.months(app) + 1, c));
    await this.acceptTransactions(app, 'MONO', { ...stmt, accountName: identity.accountName }, `MONO:${identity.institution}:${identity.accountNumberMasked}`, null, req.actor, req.correlationId);
    return this.journey.view(applicationId, req);
  }

  // ---- Channel 3: PDF upload -------------------------------------------------------------

  async uploadPdf(applicationId: string, file: Express.Multer.File | undefined, req: AuthedRequest) {
    const app = await this.requireStatementStage(applicationId);
    if (!file) throw new AppError('PDF_INVALID');
    const policy = await this.ctx.policyFor(app.creditPolicyVersionId);
    if (file.size > policy.pdfMaxBytes) throw new AppError('PDF_TOO_LARGE', { max_bytes: policy.pdfMaxBytes });
    const inspection = inspectPdf(file.buffer);
    if (!inspection.ok) {
      await this.audit.record(req.actor, { action: 'statement.pdf_rejected', resourceType: 'APPLICATION', resourceId: app.id, outcome: 'FAILURE', after: { findings: inspection.findings } });
      throw new AppError(inspection.code!, { findings: inspection.findings });
    }
    const verdict = await this.providers.call(app.environment, 'MALWARE', 'scan', this.callCtx(app, req), () => this.providers.for(app.environment).malware.scan(file.buffer));
    if (verdict !== 'CLEAN') {
      await this.audit.record(req.actor, { action: 'statement.malware_detected', resourceType: 'APPLICATION', resourceId: app.id, outcome: 'DENIED' });
      throw new AppError('MALWARE_DETECTED');
    }
    const sha = sha256Hex(file.buffer);
    const duplicate = await this.prisma.storedDocument.findFirst({ where: { sha256: sha, kind: 'BANK_STATEMENT' } });
    if (duplicate) throw new AppError('DUPLICATE_DOCUMENT');
    await this.journey.recordConsents(applicationId, ['STATEMENT_ACCESS', 'THIRD_PARTY_ANALYSIS'], req);
    const storageKey = `statements/${app.id}/${crypto.randomUUID()}`;
    await this.providers.storage.put(storageKey, file.buffer);
    const doc = await this.prisma.storedDocument.create({
      data: {
        ownerType: 'APPLICATION',
        ownerId: app.id,
        partnerId: app.partnerId,
        kind: 'BANK_STATEMENT',
        // Sanitised display name only; never used as a path.
        filename: (file.originalname || 'statement.pdf').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120),
        mimeType: 'application/pdf',
        sizeBytes: file.size,
        sha256: sha,
        storageKey,
        scanStatus: 'CLEAN',
      },
    });
    const conn = await this.prisma.statementConnection.create({
      data: { applicationId: app.id, channel: 'PDF_UPLOAD', status: 'VALIDATED', documentId: doc.id, requiredMonths: this.months(app), validationFindings: inspection.findings, providerReference: `PDF:${doc.id}` },
    });
    await this.audit.record(req.actor, { action: 'statement.pdf_uploaded', resourceType: 'STORED_DOCUMENT', resourceId: doc.id, after: { size: file.size, findings: inspection.findings } });
    await this.submitForAnalysis(app, conn.id, { kind: 'PDF', document: file.buffer, filename: doc.filename }, req.actor, req.correlationId);
    return this.journey.view(applicationId, req);
  }

  // ---- Analysis completion (polled by worker and customer) ----------------------------

  async pollApplicationAnalysis(applicationId: string, correlationId: string) {
    const job = await this.prisma.statementAnalysisJob.findFirst({ where: { applicationId, status: { in: ['SUBMITTED', 'PROCESSING'] } }, orderBy: { createdAt: 'desc' } });
    if (job) await this.pollJob(job.id, correlationId);
  }

  async pollDueJobs(): Promise<number> {
    const jobs = await this.prisma.statementAnalysisJob.findMany({ where: { status: { in: ['SUBMITTED', 'PROCESSING'] } }, take: 20, orderBy: { createdAt: 'asc' } });
    for (const j of jobs) await this.pollJob(j.id, `worker-${Date.now()}`).catch((e) => this.logger.error(`poll ${j.id}: ${(e as Error).message}`));
    return jobs.length;
  }

  async pollJob(jobId: string, correlationId: string) {
    const job = await this.prisma.statementAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
    if (!['SUBMITTED', 'PROCESSING'].includes(job.status) || !job.providerJobRef) return;
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: job.applicationId } });
    const c = this.callCtx(app, { correlationId });
    const res = await this.providers.call(app.environment, 'PERICULUM', 'get_result', c, () => this.providers.for(app.environment).periculum.getResult(job.providerJobRef!, c));
    if (res.status === 'PROCESSING') {
      // Timeout: analyses outstanding for more than 30 minutes are failed safely for retry.
      if (job.submittedAt && Date.now() - job.submittedAt.getTime() > 30 * 60_000) await this.failAnalysis(job.id, 'ANALYSIS_TIMEOUT', SYSTEM_ACTOR);
      else if (job.status === 'SUBMITTED') await this.prisma.statementAnalysisJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
      return;
    }
    if (res.status === 'FAILED') return this.failAnalysis(job.id, res.code, SYSTEM_ACTOR);
    const a = res.analysis;
    const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: app.customerId! } });
    const owner = ownershipConfidence(a.accountHolderName, customer.firstName, customer.lastName);
    const claimed = await this.prisma.statementAnalysisJob.updateMany({ where: { id: job.id, status: { in: ['SUBMITTED', 'PROCESSING'] } }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (claimed.count !== 1) return;
    await this.prisma.statementAnalysisResult.create({
      data: {
        jobId: job.id,
        applicationId: app.id,
        analysisReference: a.analysisReference,
        periodStart: a.periodStart,
        periodEnd: a.periodEnd,
        accountHolderName: a.accountHolderName,
        ownershipConfidence: owner,
        averageMonthlyInflowKobo: a.averageMonthlyInflow,
        averageMonthlyOutflowKobo: a.averageMonthlyOutflow,
        averageBalanceKobo: a.averageBalance,
        recurringObligationsKobo: a.recurringObligations,
        existingFinancingRepaymentsKobo: a.existingFinancingRepayments,
        businessRevenueMonthlyKobo: a.businessRevenueMonthly,
        salaryCreditsEncrypted: this.crypto.encryptJson(a.credits, `analysis:${app.id}`),
        stressIndicators: a.stressIndicators,
        statementQuality: a.statementQuality,
        cashFlowConsistency: a.cashFlowConsistency,
        providerRecommendedAmountKobo: a.providerRecommendedAmount,
        confidence: a.confidence,
        reliable: a.reliable,
      },
    });
    if (owner === 'MISMATCH') {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.ctx.lockApplication(tx, app.id);
        await tx.statementConnection.update({ where: { id: job.connectionId }, data: { status: 'REJECTED', failureCode: 'STATEMENT_OWNERSHIP_MISMATCH', ownershipConfidence: 'MISMATCH' } });
        await this.state.transitionApplication(tx, locked, 'STATEMENT_PENDING', SYSTEM_ACTOR, { reason: 'STATEMENT_OWNERSHIP_MISMATCH' });
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.ctx.lockApplication(tx, app.id);
      await this.state.transitionApplication(tx, locked, 'STATEMENT_ANALYSIS_COMPLETED', SYSTEM_ACTOR);
      await this.journey.notifyCustomer(tx, locked, 'ANALYSIS_COMPLETED');
    });
    await this.eligibility.evaluate(app.id, SYSTEM_ACTOR, correlationId);
  }
}
