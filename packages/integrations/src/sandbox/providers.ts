import { createHash } from 'node:crypto';
import { randomBase62 } from '@araf/security';
import {
  ProviderError,
  type AccountOpeningProvider,
  type BankAccount,
  type BankAccountProvider,
  type CallContext,
  type CoreBankingProvider,
  type CreditAssessmentProvider,
  type IdentityVerificationProvider,
  type MalwareScanner,
  type NotificationProvider,
  type PaymentQueryResult,
  type RawStatement,
  type RepaymentMandateProvider,
  type SimStore,
  type StatementAcquisitionProvider,
  type StatementAnalysisProvider,
  type VendorPaymentProvider,
} from '../interfaces';
import { analyseStatement, generateStatement } from './statements';
import { findSandboxIdentity, sandboxAccountNumber, type ForcedOutcome, type SandboxIdentity } from './scenarios';

/**
 * SANDBOX SIMULATORS. Deterministic, stateful (via SimStore), and clearly labelled.
 * They are only ever constructed for SANDBOX-environment records (see registry.ts).
 */

const K = (naira: number) => BigInt(naira) * 100n;
const ref = (prefix: string) => `${prefix}_SBX_${randomBase62(12)}`;

export interface SandboxDeps {
  store: SimStore;
  now: () => Date;
  /** Public base URL of the hosted checkout app (for simulated provider pages). */
  checkoutBaseUrl: string;
  /** Delay (ms) before simulated asynchronous operations complete. */
  asyncDelayMs: number;
  onSandboxMessage?: (msg: { channel: string; destination: string; body: string; applicationReference?: string }) => Promise<void>;
}

/** The API registers which synthetic identity an application belongs to (sandbox only). */
export const APP_IDENTITY = 'APP_IDENTITY';
export const FORCED = 'FORCED_OUTCOME';

async function identityFor(store: SimStore, ctx: CallContext): Promise<SandboxIdentity | undefined> {
  if (!ctx.applicationReference) return undefined;
  const rec = await store.get<{ bvn: string }>(APP_IDENTITY, ctx.applicationReference);
  return rec ? findSandboxIdentity(rec.bvn) : undefined;
}

export async function isForced(store: SimStore, ctx: CallContext, outcome: ForcedOutcome): Promise<boolean> {
  const identity = await identityFor(store, ctx);
  const override = ctx.applicationReference ? await store.get<{ outcomes: ForcedOutcome[] }>(FORCED, ctx.applicationReference) : null;
  if (override) return override.outcomes.includes(outcome);
  return identity?.forced?.includes(outcome) ?? false;
}

// ---- Identity (BVN) ----------------------------------------------------------------

export class SandboxIdentityProvider implements IdentityVerificationProvider {
  readonly name = 'BVN Identity (sandbox simulator)';
  async lookupBvn(bvn: string, dob: string) {
    const id = findSandboxIdentity(bvn);
    if (id?.identityProviderDown) throw new ProviderError('IDENTITY', 'UNAVAILABLE');
    if (!id) return { status: 'NOT_FOUND' as const, providerReference: ref('IDV') };
    if (id.dateOfBirth !== dob) return { status: 'DOB_MISMATCH' as const, providerReference: ref('IDV') };
    return { status: 'MATCH' as const, firstName: id.firstName, lastName: id.lastName, phone: id.phone, providerReference: ref('IDV'), gender: 'female' as const };
  }
}

// ---- SeedFi ------------------------------------------------------------------------

export class SandboxSeedFiProvider implements CreditAssessmentProvider {
  readonly name = 'SeedFi (sandbox simulator)';
  async assess(input: { bvn: string }) {
    const id = findSandboxIdentity(input.bvn);
    if (!id) throw new ProviderError('SEEDFI', 'NOT_FOUND');
    if (id.score === 'TIMEOUT') throw new ProviderError('SEEDFI', 'TIMEOUT');
    return {
      providerReference: ref('SEEDFI'),
      score: id.score === 'INVALID' ? 900 : id.score === undefined ? null : id.score,
      hasCreditHistory: id.score !== undefined,
      bureauMonthlyObligations: K(id.bureauObligationsNaira),
      outstandingExposure: K(id.existingExposureNaira),
      delinquencyIndicators: id.scenario === 'FAIR_REVIEW_DECLINE' ? ['PAST_DUE_60_DAYS'] : [],
    };
  }
}

// ---- AltBank accounts, statements, core banking -----------------------------------

interface OpenedAccount {
  accountNumber: string;
  bvn: string;
  accountName: string;
  openedAt: string;
}

export class SandboxAltBankProvider implements BankAccountProvider, CoreBankingProvider {
  readonly name = 'AltBank core & accounts (sandbox simulator)';
  constructor(private readonly deps: SandboxDeps) {}

  private existing(id: SandboxIdentity): BankAccount[] {
    if (!id.hasAltBankAccount) return [];
    const opened = new Date(this.deps.now().getTime());
    opened.setUTCMonth(opened.getUTCMonth() - id.altBankHistoryMonths - 1);
    return [
      {
        accountNumber: sandboxAccountNumber(id.bvn),
        accountName: `${id.firstName} ${id.lastName}`.toUpperCase(),
        productName: 'Alt Savings Account',
        status: id.accountStatus ?? 'ACTIVE',
        bvn: id.bvn,
        openedAt: opened.toISOString().slice(0, 10),
      },
      {
        accountNumber: sandboxAccountNumber(id.bvn, 9),
        accountName: `${id.firstName} ${id.lastName}`.toUpperCase(),
        productName: 'Alt Target Savings (restricted)',
        status: 'POST_NO_DEBIT',
        bvn: id.bvn,
        openedAt: opened.toISOString().slice(0, 10),
      },
    ];
  }

  async findAccountsByBvn(bvn: string) {
    const id = findSandboxIdentity(bvn);
    const opened = await this.deps.store.get<{ accounts: OpenedAccount[] }>('OPENED_ACCOUNTS', bvn);
    const fresh: BankAccount[] = (opened?.accounts ?? []).map((a) => ({ ...a, productName: 'Alt Current Account', status: 'ACTIVE' as const }));
    return [...(id ? this.existing(id) : []), ...fresh];
  }

  async getAccount(accountNumber: string) {
    for (const id of await this.allIdentitiesWithAccounts()) {
      const acct = (await this.findAccountsByBvn(id)).find((a) => a.accountNumber === accountNumber);
      if (acct) return acct;
    }
    return null;
  }

  private async allIdentitiesWithAccounts(): Promise<string[]> {
    const { SANDBOX_IDENTITIES } = await import('./scenarios');
    return SANDBOX_IDENTITIES.map((i) => i.bvn);
  }

  async nameEnquiry(bankCode: string, accountNumber: string) {
    if (!/^\d{10}$/.test(accountNumber) || !/^\d{3,6}$/.test(bankCode)) return null;
    const known = await this.deps.store.get<{ accountName: string }>('NAME_ENQUIRY', `${bankCode}:${accountNumber}`);
    if (known) return known;
    if (accountNumber.startsWith('000')) return null; // sandbox convention: unknown account
    return { accountName: `SANDBOX BENEFICIARY ${accountNumber.slice(-4)}` };
  }

  async getStatement(accountNumber: string, from: string, to: string): Promise<RawStatement> {
    const acct = await this.getAccount(accountNumber);
    if (!acct) throw new ProviderError('ALTBANK', 'NOT_FOUND');
    const id = findSandboxIdentity(acct.bvn)!;
    const opened = await this.deps.store.get<{ accounts: OpenedAccount[] }>('OPENED_ACCOUNTS', acct.bvn);
    const isNew = opened?.accounts.some((a) => a.accountNumber === accountNumber);
    const history = isNew ? 0 : id.altBankHistoryMonths;
    const months = Math.max(1, monthsBetween(from, to));
    return generateStatement(id, this.deps.now(), months, history);
  }

  // Core banking
  async getCustomerExposure(bvn: string) {
    const id = findSandboxIdentity(bvn);
    return { totalExposure: K(id?.existingExposureNaira ?? 0) };
  }

  async bookFinancing(input: { idempotencyKey: string; financingAmount: bigint }, ctx: CallContext) {
    const existing = await this.deps.store.get<{ status: 'BOOKED' | 'FAILED'; bookingReference?: string; reason?: string }>('CORE_BOOKING', input.idempotencyKey);
    if (existing) {
      return existing.status === 'BOOKED'
        ? { status: 'BOOKED' as const, bookingReference: existing.bookingReference! }
        : { status: 'FAILED' as const, reason: existing.reason ?? 'BOOKING_REJECTED' };
    }
    if (await isForced(this.deps.store, ctx, 'BOOKING_FAILURE')) {
      await this.deps.store.put('CORE_BOOKING', input.idempotencyKey, { status: 'FAILED', reason: 'PRODUCT_LIMIT_VALIDATION_FAILED' });
      return { status: 'FAILED' as const, reason: 'PRODUCT_LIMIT_VALIDATION_FAILED' };
    }
    const bookingReference = `FIN-SBX-${randomBase62(10).toUpperCase()}`;
    await this.deps.store.put('CORE_BOOKING', input.idempotencyKey, { status: 'BOOKED', bookingReference, amount: input.financingAmount.toString() });
    return { status: 'BOOKED' as const, bookingReference };
  }

  async queryBooking(idempotencyKey: string) {
    const existing = await this.deps.store.get<{ status: 'BOOKED' | 'FAILED'; bookingReference?: string }>('CORE_BOOKING', idempotencyKey);
    return existing ? { status: existing.status, bookingReference: existing.bookingReference } : { status: 'NOT_FOUND' as const };
  }
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// ---- Account opening ---------------------------------------------------------------

export class SandboxAccountOpeningProvider implements AccountOpeningProvider {
  readonly name = 'AltBank account opening (sandbox simulator)';
  constructor(private readonly deps: SandboxDeps) {}

  async createSession(input: { correlationRef: string; returnUrl: string; firstName: string; lastName: string; prefill?: { email?: string; phone?: string; address?: { line1: string; city: string; state: string } } }, ctx: CallContext) {
    const identity = await identityFor(this.deps.store, ctx);
    await this.deps.store.put('ACCOUNT_OPENING', input.correlationRef, {
      status: 'PENDING',
      bvn: identity?.bvn,
      returnUrl: input.returnUrl,
      name: `${input.firstName} ${input.lastName}`,
      prefill: input.prefill ?? {},
    });
    return { redirectUrl: `${this.deps.checkoutBaseUrl}/sandbox/account-opening/${encodeURIComponent(input.correlationRef)}` };
  }

  /** Called by the simulated account-opening page (sandbox endpoint), never by the customer journey. */
  async completeSimulated(correlationRef: string): Promise<{ accountNumber: string; returnUrl: string } | null> {
    const rec = await this.deps.store.get<{ status: string; bvn?: string; returnUrl: string; name: string; accountNumber?: string }>('ACCOUNT_OPENING', correlationRef);
    if (!rec || !rec.bvn) return null;
    if (rec.status === 'COMPLETED' && rec.accountNumber) return { accountNumber: rec.accountNumber, returnUrl: rec.returnUrl };
    const accountNumber = sandboxAccountNumber(rec.bvn, 5);
    const opened = (await this.deps.store.get<{ accounts: OpenedAccount[] }>('OPENED_ACCOUNTS', rec.bvn)) ?? { accounts: [] };
    if (!opened.accounts.some((a) => a.accountNumber === accountNumber)) {
      opened.accounts.push({ accountNumber, bvn: rec.bvn, accountName: rec.name.toUpperCase(), openedAt: this.deps.now().toISOString().slice(0, 10) });
      await this.deps.store.put('OPENED_ACCOUNTS', rec.bvn, opened);
    }
    await this.deps.store.put('ACCOUNT_OPENING', correlationRef, { ...rec, status: 'COMPLETED', accountNumber });
    return { accountNumber, returnUrl: rec.returnUrl };
  }

  async abandonSimulated(correlationRef: string) {
    const rec = await this.deps.store.get<Record<string, unknown>>('ACCOUNT_OPENING', correlationRef);
    if (rec) await this.deps.store.put('ACCOUNT_OPENING', correlationRef, { ...rec, status: 'ABANDONED' });
    return rec as { returnUrl: string } | null;
  }

  async getResult(correlationRef: string) {
    const rec = await this.deps.store.get<{ status: 'PENDING' | 'ABANDONED' | 'COMPLETED'; accountNumber?: string }>('ACCOUNT_OPENING', correlationRef);
    if (!rec) throw new ProviderError('ACCOUNT_OPENING', 'NOT_FOUND');
    return rec.status === 'COMPLETED' ? { status: 'COMPLETED' as const, accountNumber: rec.accountNumber! } : { status: rec.status === 'ABANDONED' ? ('ABANDONED' as const) : ('PENDING' as const) };
  }
}

// ---- Mono ------------------------------------------------------------------------------

export class SandboxMonoProvider implements StatementAcquisitionProvider {
  readonly name = 'Mono Connect (sandbox simulator)';
  constructor(private readonly deps: SandboxDeps) {}

  async createConnectSession(input: { reference: string; redirectUrl: string }, ctx: CallContext) {
    const identity = await identityFor(this.deps.store, ctx);
    const sessionRef = `mono_sbx_${randomBase62(16)}`;
    await this.deps.store.put('MONO_SESSION', sessionRef, { status: 'PENDING', bvn: identity?.bvn, redirectUrl: input.redirectUrl, reference: input.reference });
    return { sessionRef, connectUrl: `${this.deps.checkoutBaseUrl}/sandbox/mono/${sessionRef}` };
  }

  /** Simulated Mono widget authorisation (sandbox endpoint). Never collects bank passwords. */
  async authorizeSimulated(sessionRef: string, institution: string, outcome: 'SUCCESS' | 'FAILURE') {
    const rec = await this.deps.store.get<{ status: string; bvn?: string; redirectUrl: string }>('MONO_SESSION', sessionRef);
    if (!rec || rec.status !== 'PENDING') return null;
    if (outcome === 'FAILURE') {
      await this.deps.store.put('MONO_SESSION', sessionRef, { ...rec, status: 'FAILED' });
      return { redirectUrl: rec.redirectUrl, code: null };
    }
    const code = `code_sbx_${randomBase62(20)}`;
    const accountId = `mono_acct_${randomBase62(14)}`;
    await this.deps.store.put('MONO_CODE', code, { accountId, used: false });
    await this.deps.store.put('MONO_ACCOUNT', accountId, { bvn: rec.bvn, institution });
    await this.deps.store.put('MONO_SESSION', sessionRef, { ...rec, status: 'AUTHORIZED' });
    return { redirectUrl: rec.redirectUrl, code };
  }

  async exchangeCode(code: string) {
    const rec = await this.deps.store.get<{ accountId: string; used: boolean }>('MONO_CODE', code);
    if (!rec || rec.used) throw new ProviderError('MONO', 'REJECTED', 'Authorisation code invalid or already used');
    await this.deps.store.put('MONO_CODE', code, { ...rec, used: true });
    return { accountId: rec.accountId };
  }

  async getAccountIdentity(accountId: string) {
    const rec = await this.deps.store.get<{ bvn: string; institution: string }>('MONO_ACCOUNT', accountId);
    const id = rec ? findSandboxIdentity(rec.bvn) : undefined;
    if (!rec || !id) throw new ProviderError('MONO', 'NOT_FOUND');
    return { accountName: `${id.firstName} ${id.lastName}`.toUpperCase(), institution: rec.institution, accountNumberMasked: '••••••' + id.bvn.slice(-4), bvnLast4: id.bvn.slice(-4) };
  }

  async getStatement(accountId: string, months: number) {
    const rec = await this.deps.store.get<{ bvn: string }>('MONO_ACCOUNT', accountId);
    const id = rec ? findSandboxIdentity(rec.bvn) : undefined;
    if (!id) throw new ProviderError('MONO', 'NOT_FOUND');
    return generateStatement(id, this.deps.now(), months, 12);
  }
}

// ---- Periculum ---------------------------------------------------------------------

export class SandboxPericulumProvider implements StatementAnalysisProvider {
  readonly name = 'Periculum (sandbox simulator)';
  constructor(private readonly deps: SandboxDeps) {}

  async submit(input: { reference: string; source: import('../interfaces').AnalysisSource; months: number }, ctx: CallContext) {
    const identity = await identityFor(this.deps.store, ctx);
    const jobRef = `pcl_sbx_${randomBase62(14)}`;
    let statement: RawStatement;
    let ownerMismatch = false;
    if (input.source.kind === 'TRANSACTIONS') {
      statement = input.source.statement;
    } else {
      if (!identity) throw new ProviderError('PERICULUM', 'REJECTED', 'Unknown sandbox identity for PDF analysis');
      statement = generateStatement(identity, this.deps.now(), input.months, 12);
      ownerMismatch = input.source.document.includes(Buffer.from('SANDBOX:OWNER_MISMATCH'));
    }
    const failed = await isForced(this.deps.store, ctx, 'ANALYSIS_FAILURE');
    const analysis = analyseStatement(ownerMismatch ? { ...statement, accountName: 'UNRELATED ACCOUNT HOLDER' } : statement, jobRef, identity);
    await this.deps.store.put('PERICULUM_JOB', jobRef, {
      readyAt: this.deps.now().getTime() + this.deps.asyncDelayMs,
      failed,
      analysis: JSON.parse(JSON.stringify(analysis, (_k, v) => (typeof v === 'bigint' ? `__big:${v}` : v))),
    });
    return { jobRef };
  }

  async getResult(jobRef: string) {
    const rec = await this.deps.store.get<{ readyAt: number; failed: boolean; analysis: unknown }>('PERICULUM_JOB', jobRef);
    if (!rec) throw new ProviderError('PERICULUM', 'NOT_FOUND');
    if (this.deps.now().getTime() < rec.readyAt) return { status: 'PROCESSING' as const };
    if (rec.failed) return { status: 'FAILED' as const, code: 'ANALYSIS_ENGINE_ERROR' };
    const analysis = JSON.parse(JSON.stringify(rec.analysis), (_k, v) => (typeof v === 'string' && v.startsWith('__big:') ? BigInt(v.slice(6)) : v));
    return { status: 'COMPLETED' as const, analysis };
  }
}

// ---- Remita ------------------------------------------------------------------------

export class SandboxRemitaProvider implements RepaymentMandateProvider {
  readonly name = 'Remita mandates (sandbox simulator)';
  constructor(private readonly deps: SandboxDeps) {}

  async initiate(input: { reference: string; returnUrl: string }, ctx: CallContext) {
    const mandateReference = `RMT-SBX-${randomBase62(10).toUpperCase()}`;
    const willFail = await isForced(this.deps.store, ctx, 'MANDATE_FAILURE');
    await this.deps.store.put('REMITA_MANDATE', mandateReference, { status: 'AWAITING_AUTHORIZATION', willFail, returnUrl: input.returnUrl });
    return { mandateReference, authorizationUrl: `${this.deps.checkoutBaseUrl}/sandbox/remita/${mandateReference}` };
  }

  async authorizeSimulated(mandateReference: string, approve: boolean) {
    const rec = await this.deps.store.get<{ status: string; willFail: boolean; returnUrl: string }>('REMITA_MANDATE', mandateReference);
    if (!rec) return null;
    if (rec.status === 'AWAITING_AUTHORIZATION') {
      const status = !approve ? 'CANCELLED' : rec.willFail ? 'FAILED' : 'ACTIVE';
      await this.deps.store.put('REMITA_MANDATE', mandateReference, { ...rec, status, failureCode: rec.willFail ? 'BANK_REJECTED_MANDATE' : undefined });
    }
    return { returnUrl: rec.returnUrl };
  }

  async getStatus(mandateReference: string) {
    const rec = await this.deps.store.get<{ status: 'AWAITING_AUTHORIZATION' | 'ACTIVE' | 'FAILED' | 'CANCELLED'; failureCode?: string }>('REMITA_MANDATE', mandateReference);
    if (!rec) throw new ProviderError('REMITA', 'NOT_FOUND');
    return { status: rec.status, failureCode: rec.failureCode };
  }
}

// ---- Vendor payments ---------------------------------------------------------------

interface SimPayment {
  reference: string;
  providerReference: string;
  amount: string;
  beneficiaryAccountNumber: string;
  outcome: 'CONFIRMED' | 'FAILED';
  completesAt: number;
  reversed?: boolean;
}

export class SandboxPaymentProvider implements VendorPaymentProvider {
  readonly name = 'NIP vendor payments (sandbox simulator)';
  readonly isSimulated = true;
  constructor(private readonly deps: SandboxDeps) {}

  async initiate(input: { idempotencyKey: string; reference: string; amount: bigint; beneficiary: { accountNumber: string } }, ctx: CallContext) {
    const existing = await this.deps.store.get<SimPayment>('PAYMENT', input.idempotencyKey);
    if (existing) return { status: 'PROCESSING' as const, providerReference: existing.providerReference };
    const fail = await isForced(this.deps.store, ctx, 'PAYMENT_FAILURE');
    const unknown = await isForced(this.deps.store, ctx, 'PAYMENT_UNKNOWN');
    const payment: SimPayment = {
      reference: input.reference,
      providerReference: `NIP-SBX-${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 12).toUpperCase()}`,
      amount: input.amount.toString(),
      beneficiaryAccountNumber: input.beneficiary.accountNumber,
      outcome: fail ? 'FAILED' : 'CONFIRMED',
      completesAt: this.deps.now().getTime() + this.deps.asyncDelayMs,
    };
    await this.deps.store.put('PAYMENT', input.idempotencyKey, payment);
    // Simulate a network timeout AFTER the rail accepted the payment: the outcome is unknown to the caller.
    if (unknown) throw new ProviderError('PAYMENTS', 'TIMEOUT', 'Payment rail did not respond');
    return { status: 'PROCESSING' as const, providerReference: payment.providerReference };
  }

  async query(idempotencyKey: string): Promise<PaymentQueryResult> {
    const p = await this.deps.store.get<SimPayment>('PAYMENT', idempotencyKey);
    if (!p) return { status: 'NOT_FOUND' };
    const done = this.deps.now().getTime() >= p.completesAt;
    const status = p.reversed ? 'REVERSED' : done ? p.outcome : 'PROCESSING';
    return {
      status,
      providerReference: p.providerReference,
      amount: BigInt(p.amount),
      beneficiaryAccountNumber: p.beneficiaryAccountNumber,
      failureReason: status === 'FAILED' ? 'BENEFICIARY_BANK_REJECTED' : undefined,
    };
  }

  async reverseSimulated(idempotencyKey: string) {
    const p = await this.deps.store.get<SimPayment>('PAYMENT', idempotencyKey);
    if (p) await this.deps.store.put('PAYMENT', idempotencyKey, { ...p, reversed: true });
  }

  async queryVendorRefund(reference: string) {
    const rec = await this.deps.store.get<{ amount: string; providerReference: string }>('VENDOR_REFUND', reference);
    return rec ? { status: 'RECEIVED' as const, amount: BigInt(rec.amount), providerReference: rec.providerReference } : { status: 'PENDING' as const };
  }

  async recordVendorRefundSimulated(reference: string, amount: bigint) {
    await this.deps.store.put('VENDOR_REFUND', reference, { amount: amount.toString(), providerReference: `RFD-SBX-${randomBase62(8).toUpperCase()}` });
  }
}

// ---- Notifications & malware -------------------------------------------------------

export class SandboxNotificationProvider implements NotificationProvider {
  readonly name = 'Notifications (sandbox inbox)';
  constructor(private readonly deps: SandboxDeps) {}
  async send(input: { channel: 'EMAIL' | 'SMS'; destination: string; subject: string; body: string; applicationReference?: string }) {
    await this.deps.onSandboxMessage?.({ channel: input.channel, destination: input.destination, body: `${input.subject}\n\n${input.body}`, applicationReference: input.applicationReference });
    return { providerRef: ref('MSG') };
  }
}

/** Detects the industry-standard EICAR test signature so malware handling can be exercised safely. */
export class SandboxMalwareScanner implements MalwareScanner {
  readonly name = 'Malware scanner (sandbox: EICAR signature detection)';
  async scan(data: Buffer) {
    return data.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? ('INFECTED' as const) : ('CLEAN' as const);
  }
}
