import type { Kobo } from './money';

/**
 * Goods release gate (spec §37).
 *
 * The vendor gets paid before the vendor releases goods. Eligibility, approval, booking
 * and payment initiation are NOT release authorisation. Release is authorised only when
 * every condition below holds. The gate is a pure function so it is exhaustively testable;
 * the API re-evaluates it inside the same database transaction that creates the authorisation.
 */

export type PaymentStatus =
  | 'NOT_INITIATED'
  | 'PENDING_APPROVAL'
  | 'INITIATED'
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'UNKNOWN'
  | 'REVERSED'
  | 'RECONCILIATION_REQUIRED';

export interface ReleaseGateInput {
  payment: {
    status: PaymentStatus;
    /** Confirmation came from the authoritative payment system (not a dashboard toggle). */
    confirmedByAuthoritativeSource: boolean;
    amount: Kobo;
    beneficiaryAccountId: string;
  } | null;
  expectedVendorPaymentAmount: Kobo;
  approvedBeneficiaryAccountId: string;
  requiredConditions: Array<{ code: string; satisfied: boolean }>;
  contribution: { required: boolean; verified: boolean };
  activeHolds: string[]; // cancellation, compliance, dispute holds
  orderValid: boolean;
  financingApproved: boolean;
}

export type ReleaseBlocker =
  | 'PAYMENT_NOT_INITIATED'
  | 'PAYMENT_NOT_CONFIRMED'
  | 'PAYMENT_NOT_AUTHORITATIVE'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'BENEFICIARY_MISMATCH'
  | 'CONTRACTUAL_CONDITION_PENDING'
  | 'CONTRIBUTION_NOT_VERIFIED'
  | 'ACTIVE_HOLD'
  | 'ORDER_INVALID'
  | 'FINANCING_NOT_APPROVED';

export interface ReleaseGateResult {
  authorized: boolean;
  blockers: ReleaseBlocker[];
  pendingConditions: string[];
}

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const blockers: ReleaseBlocker[] = [];
  if (!input.financingApproved) blockers.push('FINANCING_NOT_APPROVED');
  if (!input.payment) {
    blockers.push('PAYMENT_NOT_INITIATED');
  } else {
    if (input.payment.status !== 'CONFIRMED') blockers.push('PAYMENT_NOT_CONFIRMED');
    if (!input.payment.confirmedByAuthoritativeSource) blockers.push('PAYMENT_NOT_AUTHORITATIVE');
    if (input.payment.amount !== input.expectedVendorPaymentAmount) blockers.push('PAYMENT_AMOUNT_MISMATCH');
    if (input.payment.beneficiaryAccountId !== input.approvedBeneficiaryAccountId) blockers.push('BENEFICIARY_MISMATCH');
  }
  const pendingConditions = input.requiredConditions.filter((c) => !c.satisfied).map((c) => c.code);
  if (pendingConditions.length) blockers.push('CONTRACTUAL_CONDITION_PENDING');
  if (input.contribution.required && !input.contribution.verified) blockers.push('CONTRIBUTION_NOT_VERIFIED');
  if (input.activeHolds.length) blockers.push('ACTIVE_HOLD');
  if (!input.orderValid) blockers.push('ORDER_INVALID');
  return { authorized: blockers.length === 0, blockers, pendingConditions };
}

/**
 * Proposed Murabaha contractual conditions (subject to Shariah governance, Legal and Credit
 * Risk approval). Codes are stable identifiers; the required set is configured per product.
 */
export const MURABAHA_CONDITIONS = {
  PROMISE_TO_PURCHASE_SIGNED: 'Customer promise (wa’d) to purchase signed',
  MANDATE_ACTIVE: 'Repayment mandate verified active',
  ASSET_ACQUIRED: 'Bank acquired the asset from the vendor (vendor paid, invoice in Bank’s name)',
  POSSESSION_EVIDENCED: 'Bank’s ownership / constructive possession evidenced',
  COST_AND_PROFIT_DISCLOSED: 'Acquisition cost and profit disclosed to the customer',
  SALE_CONTRACT_EXECUTED: 'Murabaha sale contract executed by the customer',
} as const;

export type MurabahaConditionCode = keyof typeof MURABAHA_CONDITIONS;

/** Conditions that must be satisfied before the Bank's vendor payment may be initiated. */
export const PRE_PAYMENT_CONDITIONS: MurabahaConditionCode[] = ['PROMISE_TO_PURCHASE_SIGNED', 'MANDATE_ACTIVE'];

/** Conditions that must be satisfied before goods release. */
export const PRE_RELEASE_CONDITIONS: MurabahaConditionCode[] = [
  'PROMISE_TO_PURCHASE_SIGNED',
  'MANDATE_ACTIVE',
  'ASSET_ACQUIRED',
  'POSSESSION_EVIDENCED',
  'COST_AND_PROFIT_DISCLOSED',
  'SALE_CONTRACT_EXECUTED',
];

export interface VendorPaymentPreconditionInput {
  financingApproved: boolean;
  bookingConfirmed: boolean;
  bookingRequiredBeforePayment: boolean;
  beneficiaryVerified: boolean;
  invoiceApproved: boolean;
  orderValid: boolean;
  prePaymentConditions: Array<{ code: string; satisfied: boolean }>;
  contribution: { required: boolean; verified: boolean };
  existingLivePaymentInstruction: boolean;
  activeHolds: string[];
}

export function evaluateVendorPaymentPreconditions(input: VendorPaymentPreconditionInput): string[] {
  const blockers: string[] = [];
  if (!input.financingApproved) blockers.push('FINANCING_NOT_APPROVED');
  if (input.bookingRequiredBeforePayment && !input.bookingConfirmed) blockers.push('BOOKING_NOT_CONFIRMED');
  if (!input.beneficiaryVerified) blockers.push('BENEFICIARY_NOT_VERIFIED');
  if (!input.invoiceApproved) blockers.push('INVOICE_NOT_APPROVED');
  if (!input.orderValid) blockers.push('ORDER_INVALID');
  for (const c of input.prePaymentConditions) if (!c.satisfied) blockers.push(`CONDITION_PENDING:${c.code}`);
  if (input.contribution.required && !input.contribution.verified) blockers.push('CONTRIBUTION_NOT_VERIFIED');
  if (input.existingLivePaymentInstruction) blockers.push('DUPLICATE_PAYMENT_INSTRUCTION');
  if (input.activeHolds.length) blockers.push('ACTIVE_HOLD');
  return blockers;
}
