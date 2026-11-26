/**
 * Integration adapter contracts (spec §48).
 *
 * The domain only depends on these interfaces. Each external system has a sandbox
 * simulator and a live adapter. Live adapters are NOT implemented against invented
 * endpoints: until the Bank supplies contracted API specifications and credentials they
 * fail closed with IntegrationNotConfiguredError. Monetary values are bigint kobo.
 */

export type ProviderErrorCode =
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'REJECTED'
  | 'NOT_FOUND'
  | 'AUTHENTICATION_FAILED';

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: ProviderErrorCode,
    message?: string,
  ) {
    super(message ?? `${provider}: ${code}`);
  }
}

export class IntegrationNotConfiguredError extends Error {
  constructor(public readonly provider: string) {
    super(`${provider} live integration is not configured. Production operation is disabled until the contracted API specification, credentials and approvals are supplied.`);
  }
}

export interface CallContext {
  applicationReference?: string;
  correlationId: string;
}

// ---- Identity ------------------------------------------------------------------------

export type BvnLookupResult =
  | { status: 'MATCH'; firstName: string; lastName: string; phone: string; providerReference: string }
  | { status: 'DOB_MISMATCH'; providerReference: string }
  | { status: 'NOT_FOUND'; providerReference: string };

export interface IdentityVerificationProvider {
  readonly name: string;
  lookupBvn(bvn: string, dateOfBirth: string, ctx: CallContext): Promise<BvnLookupResult>;
}

// ---- Credit (SeedFi) -------------------------------------------------------------------

export interface CreditAssessmentResponse {
  providerReference: string;
  /** Raw score exactly as returned — validated by the Bank's policy engine, never coerced. */
  score: unknown;
  hasCreditHistory: boolean;
  bureauMonthlyObligations: bigint | null;
  outstandingExposure: bigint | null;
  delinquencyIndicators: string[];
}

export interface CreditAssessmentProvider {
  readonly name: string;
  assess(input: { bvn: string; firstName: string; lastName: string; dateOfBirth: string }, ctx: CallContext): Promise<CreditAssessmentResponse>;
}

// ---- Bank accounts & core banking (AltBank internal) ---------------------------------

export interface BankAccount {
  accountNumber: string;
  accountName: string;
  productName: string;
  status: 'ACTIVE' | 'DORMANT' | 'CLOSED' | 'POST_NO_DEBIT';
  bvn: string;
  openedAt: string; // YYYY-MM-DD
}

export interface StatementTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: bigint; // positive credit, negative debit (kobo)
  narration: string;
  counterpartyName?: string;
}

export interface RawStatement {
  accountName: string;
  periodStart: string;
  periodEnd: string;
  transactions: StatementTransaction[];
}

export interface BankAccountProvider {
  readonly name: string;
  findAccountsByBvn(bvn: string, ctx: CallContext): Promise<BankAccount[]>;
  getAccount(accountNumber: string, ctx: CallContext): Promise<BankAccount | null>;
  nameEnquiry(bankCode: string, accountNumber: string, ctx: CallContext): Promise<{ accountName: string } | null>;
  getStatement(accountNumber: string, from: string, to: string, ctx: CallContext): Promise<RawStatement>;
}

export interface CoreBankingProvider {
  readonly name: string;
  getCustomerExposure(bvn: string, ctx: CallContext): Promise<{ totalExposure: bigint }>;
  bookFinancing(
    input: {
      idempotencyKey: string;
      accountNumber: string;
      financingAmount: bigint;
      profitAmount: bigint;
      deferredSalePrice: bigint;
      tenorMonths: number;
      arafReference: string;
    },
    ctx: CallContext,
  ): Promise<{ status: 'BOOKED'; bookingReference: string } | { status: 'FAILED'; reason: string }>;
  queryBooking(idempotencyKey: string, ctx: CallContext): Promise<{ status: 'BOOKED' | 'FAILED' | 'NOT_FOUND'; bookingReference?: string }>;
}

// ---- Account opening -------------------------------------------------------------------

export interface AccountOpeningProvider {
  readonly name: string;
  /**
   * `prefill` carries details the merchant already collected so the customer is not asked twice.
   * Live mapping depends on the account-opening platform's contracted API (not yet supplied).
   */
  createSession(input: { correlationRef: string; returnUrl: string; firstName: string; lastName: string; prefill?: AccountOpeningPrefill }, ctx: CallContext): Promise<{ redirectUrl: string }>;
  /** Authoritative server-side result lookup (used after callbacks and for polling). */
  getResult(correlationRef: string, ctx: CallContext): Promise<{ status: 'PENDING' | 'ABANDONED' } | { status: 'COMPLETED'; accountNumber: string }>;
}

export interface AccountOpeningPrefill {
  email?: string;
  phone?: string;
  address?: { line1: string; city: string; state: string };
}

// ---- Statement acquisition (Mono) ----------------------------------------------------

export interface StatementAcquisitionProvider {
  readonly name: string;
  createConnectSession(input: { reference: string; customerName: string; redirectUrl: string }, ctx: CallContext): Promise<{ sessionRef: string; connectUrl: string }>;
  exchangeCode(code: string, ctx: CallContext): Promise<{ accountId: string }>;
  getAccountIdentity(accountId: string, ctx: CallContext): Promise<{ accountName: string; institution: string; accountNumberMasked: string; bvnLast4?: string }>;
  getStatement(accountId: string, months: number, ctx: CallContext): Promise<RawStatement>;
}

// ---- Statement analysis (Periculum) ----------------------------------------------------

export type AnalysisSource =
  | { kind: 'PDF'; document: Buffer; filename: string }
  | { kind: 'TRANSACTIONS'; statement: RawStatement; origin: 'ALTBANK' | 'MONO' };

export interface NormalizedAnalysis {
  analysisReference: string;
  periodStart: string;
  periodEnd: string;
  accountHolderName: string;
  reliable: boolean;
  statementQuality: 'GOOD' | 'FAIR' | 'POOR';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  averageMonthlyInflow: bigint;
  averageMonthlyOutflow: bigint;
  averageBalance: bigint;
  recurringObligations: bigint;
  existingFinancingRepayments: bigint;
  businessRevenueMonthly: bigint | null;
  cashFlowConsistency: 'STABLE' | 'VARIABLE' | 'VOLATILE';
  stressIndicators: string[];
  /** Provider-classified credits; the BANK applies its own salary rules to these. */
  credits: Array<{ id: string; date: string; amount: bigint; narration: string; classification: 'SALARY' | 'POSSIBLE_SALARY' | 'SELF_TRANSFER' | 'OTHER'; counterpartyName?: string }>;
  providerRecommendedAmount: bigint | null;
}

export interface StatementAnalysisProvider {
  readonly name: string;
  submit(input: { reference: string; source: AnalysisSource; months: number }, ctx: CallContext): Promise<{ jobRef: string }>;
  getResult(jobRef: string, ctx: CallContext): Promise<{ status: 'PROCESSING' } | { status: 'FAILED'; code: string } | { status: 'COMPLETED'; analysis: NormalizedAnalysis }>;
}

// ---- ARAF workflow -------------------------------------------------------------------

/**
 * Execution status reported BACK to ARAF (DECISIONS.md D-013: Pay with ARAF executes booking and
 * vendor payment, ARAF stays the authoritative case record). Reports are idempotent on `eventId`
 * and may arrive more than once; `sequence` lets ARAF ignore out-of-order delivery.
 */
export type ArafStatusReportType =
  | 'EQUITY_CONFIRMED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_FAILED'
  | 'VENDOR_PAYMENT_INITIATED'
  | 'VENDOR_PAYMENT_CONFIRMED'
  | 'VENDOR_PAYMENT_FAILED'
  | 'VENDOR_PAYMENT_REVERSED'
  | 'RELEASE_AUTHORIZED'
  | 'RELEASE_SUSPENDED'
  | 'GOODS_DISPATCHED'
  | 'GOODS_DELIVERED'
  | 'REFUND_INITIATED'
  | 'REFUND_COMPLETED'
  | 'APPLICATION_CANCELLED';

export interface ArafStatusReport {
  eventId: string;
  arafReference: string;
  applicationReference: string;
  type: ArafStatusReportType;
  sequence: number;
  occurredAt: string;
  /** Operational references only (booking / payment / release references, amounts in kobo). */
  data: Record<string, string | number | boolean | null>;
}

export interface ArafWorkflowProvider {
  readonly name: string;
  submit(payload: Record<string, unknown>, idempotencyKey: string, ctx: CallContext): Promise<{ arafReference: string }>;
  findByIdempotencyKey(idempotencyKey: string, ctx: CallContext): Promise<{ arafReference: string } | null>;
  reportStatus(report: ArafStatusReport, ctx: CallContext): Promise<{ acknowledged: true; arafEventReference?: string }>;
}

// ---- Repayment mandate (Remita) ------------------------------------------------------

export interface RepaymentMandateProvider {
  readonly name: string;
  initiate(
    input: { reference: string; payerName: string; accountNumber: string; bankCode: string; instalmentAmount: bigint; instalments: number; startDate: string; returnUrl: string },
    ctx: CallContext,
  ): Promise<{ mandateReference: string; authorizationUrl: string }>;
  getStatus(mandateReference: string, ctx: CallContext): Promise<{ status: 'AWAITING_AUTHORIZATION' | 'ACTIVE' | 'FAILED' | 'CANCELLED'; failureCode?: string }>;
}

// ---- Vendor payments ------------------------------------------------------------------

export interface PaymentBeneficiary {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export type PaymentQueryResult =
  | { status: 'NOT_FOUND' }
  | { status: 'PROCESSING' | 'CONFIRMED' | 'FAILED' | 'REVERSED'; providerReference: string; amount: bigint; beneficiaryAccountNumber: string; failureReason?: string };

export interface VendorPaymentProvider {
  readonly name: string;
  readonly isSimulated: boolean;
  /** Throws ProviderError('TIMEOUT') when the outcome is unknown — callers MUST NOT retry blindly. */
  initiate(
    input: { idempotencyKey: string; reference: string; amount: bigint; beneficiary: PaymentBeneficiary; narration: string },
    ctx: CallContext,
  ): Promise<{ status: 'PROCESSING' | 'CONFIRMED' | 'FAILED'; providerReference: string; failureReason?: string }>;
  query(idempotencyKey: string, ctx: CallContext): Promise<PaymentQueryResult>;
  queryVendorRefund(reference: string, ctx: CallContext): Promise<{ status: 'PENDING' | 'RECEIVED'; amount?: bigint; providerReference?: string }>;
}

// ---- Notifications, storage, malware scanning ---------------------------------------

export interface NotificationProvider {
  readonly name: string;
  send(input: { channel: 'EMAIL' | 'SMS'; destination: string; subject: string; body: string; applicationReference?: string }, ctx: CallContext): Promise<{ providerRef: string }>;
}

export interface DocumentStorageProvider {
  readonly name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

export interface MalwareScanner {
  readonly name: string;
  scan(data: Buffer): Promise<'CLEAN' | 'INFECTED'>;
}

export interface ProviderSet {
  identity: IdentityVerificationProvider;
  credit: CreditAssessmentProvider;
  bankAccounts: BankAccountProvider;
  coreBanking: CoreBankingProvider;
  accountOpening: AccountOpeningProvider;
  mono: StatementAcquisitionProvider;
  periculum: StatementAnalysisProvider;
  araf: ArafWorkflowProvider;
  remita: RepaymentMandateProvider;
  payments: VendorPaymentProvider;
  notifications: NotificationProvider;
  malware: MalwareScanner;
}

/** Persistence used by simulators to model external system state. */
export interface SimStore {
  get<T>(kind: string, key: string): Promise<T | null>;
  put<T>(kind: string, key: string, data: T): Promise<void>;
}
