import { IntegrationNotConfiguredError, type ProviderSet } from '../interfaces';

/**
 * LIVE ADAPTERS — intentionally fail closed.
 *
 * No official SeedFi, Mono, Periculum, Remita, ARAF, AltBank core banking, account opening
 * or payment-rail specifications were supplied for this build. Writing adapters against
 * guessed endpoints would be fabricating official API contracts, so each live adapter
 * throws IntegrationNotConfiguredError until the contracted specification and credentials
 * are provided and the adapter is implemented and certified. This guarantees production
 * records can never silently fall back to simulated success.
 */
function notConfigured(provider: string): never {
  throw new IntegrationNotConfiguredError(provider);
}

const failClosed = <T extends object>(provider: string, name: string, extra: Partial<T> = {}): T =>
  new Proxy({ name, isSimulated: false, ...extra } as T, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      if (prop === 'then') return undefined;
      return () => notConfigured(provider);
    },
  });

export function liveProviders(): ProviderSet {
  return {
    identity: failClosed('BVN Identity Verification', 'BVN Identity (live — not configured)'),
    credit: failClosed('SeedFi', 'SeedFi (live — not configured)'),
    bankAccounts: failClosed('AltBank Accounts', 'AltBank accounts (live — not configured)'),
    coreBanking: failClosed('AltBank Core Banking', 'AltBank core banking (live — not configured)'),
    accountOpening: failClosed('AltBank Account Opening', 'Account opening (live — not configured)'),
    mono: failClosed('Mono', 'Mono (live — not configured)'),
    periculum: failClosed('Periculum', 'Periculum (live — not configured)'),
    araf: failClosed('ARAF Workflow', 'ARAF workflow (live — not configured)'),
    remita: failClosed('Remita', 'Remita (live — not configured)'),
    cards: failClosed('Paystack', 'Paystack cards (live — not configured)'),
    payments: failClosed('Vendor Payments', 'Vendor payments (live — not configured)'),
    notifications: failClosed('Notifications', 'Notifications (live — not configured)'),
    malware: failClosed('Malware Scanning', 'Malware scanning (live — not configured)'),
  };
}

/** Provider capability matrix (spec §48) — documented status of each integration. */
export const PROVIDER_CAPABILITY_MATRIX = [
  { provider: 'BVN identity verification', interface: 'IdentityVerificationProvider', sandbox: 'Simulator (synthetic identities)', live: 'Not configured — specification required', capabilities: ['BVN lookup', 'DOB match', 'identity-linked phone for OTP'] },
  { provider: 'SeedFi', interface: 'CreditAssessmentProvider', sandbox: 'Simulator', live: 'Not configured — SeedFi API documentation required', capabilities: ['SeedScore', 'bureau obligations', 'outstanding exposure', 'delinquency indicators'] },
  { provider: 'AltBank accounts', interface: 'BankAccountProvider', sandbox: 'Simulator', live: 'Not configured — internal API specification required', capabilities: ['accounts by BVN', 'account status', 'name enquiry', 'statement retrieval'] },
  { provider: 'AltBank core banking', interface: 'CoreBankingProvider', sandbox: 'Simulator', live: 'Not configured', capabilities: ['customer exposure', 'financing booking (idempotent)', 'booking query'] },
  { provider: 'AltBank account opening', interface: 'AccountOpeningProvider', sandbox: 'Simulator page + signed callback', live: 'Not configured — callback support to be confirmed', capabilities: ['session creation', 'server-side result lookup'] },
  { provider: 'Mono', interface: 'StatementAcquisitionProvider', sandbox: 'Simulated Connect page', live: 'Not configured — contracted Mono product to be confirmed', capabilities: ['connect session', 'code exchange (server-side)', 'account identity', 'statement'] },
  { provider: 'Periculum', interface: 'StatementAnalysisProvider', sandbox: 'Simulator (async jobs)', live: 'Not configured — Periculum API documentation required', capabilities: ['PDF analysis', 'transaction analysis', 'async job status'] },
  { provider: 'ARAF workflow', interface: 'ArafWorkflowProvider', sandbox: 'Workflow simulator (admin portal)', live: 'Not configured — ARAF API / event contract required', capabilities: ['idempotent submission', 'lookup by idempotency key', 'inbound status events', 'outbound execution status reporting (booking, payment, release, fulfilment, refunds)'] },
  { provider: 'Remita', interface: 'RepaymentMandateProvider', sandbox: 'Simulated authorisation page', live: 'Not configured', capabilities: ['mandate initiation', 'authorisation', 'status verification'] },
  { provider: 'Vendor payments', interface: 'VendorPaymentProvider', sandbox: 'Simulator (success / failure / unknown)', live: 'Not configured — payment initiation DISABLED for production', capabilities: ['idempotent initiation', 'status query', 'vendor refund lookup'] },
  { provider: 'Notifications', interface: 'NotificationProvider', sandbox: 'Sandbox inbox', live: 'Not configured', capabilities: ['email', 'SMS'] },
  { provider: 'Malware scanning', interface: 'MalwareScanner', sandbox: 'EICAR signature detection', live: 'Not configured — ClamAV / Bank AV service required', capabilities: ['file scanning'] },
] as const;
