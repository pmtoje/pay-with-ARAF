/** Shared domain constants and labels for the admin portal (mirrors API enums). */

export const APPLICATION_STATES = [
  'CREATED', 'IDENTITY_PENDING', 'IDENTITY_VERIFIED', 'CREDIT_CHECK_PENDING', 'CREDIT_CHECK_COMPLETED', 'ENHANCED_REVIEW_REQUIRED',
  'ENHANCED_REVIEW_PENDING', 'ENHANCED_REVIEW_CLEARED', 'ACCOUNT_VERIFICATION_PENDING', 'ACCOUNT_OPENING_PENDING', 'ACCOUNT_VERIFIED',
  'STATEMENT_PENDING', 'STATEMENT_RECEIVED', 'STATEMENT_VALIDATION_PENDING', 'STATEMENT_ANALYSIS_PENDING', 'STATEMENT_ANALYSIS_COMPLETED',
  'AFFORDABILITY_REVIEW_REQUIRED', 'ELIGIBLE', 'OFFER_PRESENTED', 'OFFER_ACCEPTED', 'ARAF_SUBMISSION_PENDING', 'ARAF_SUBMITTED',
  'ARAF_UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'FINANCING_APPROVED', 'DOCUMENTATION_PENDING', 'MANDATE_PENDING',
  'BOOKING_PENDING', 'FINANCING_BOOKED', 'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED', 'RELEASE_AUTHORIZED',
  'GOODS_DISPATCHED', 'GOODS_DELIVERED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'EXCEPTION',
] as const;

export const TERMINAL_STATES = ['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED'];

export const PARTNER_STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'SANDBOX_ACTIVE',
  'PRODUCTION_PENDING', 'PRODUCTION_ACTIVE', 'SUSPENDED', 'REJECTED', 'TERMINATED',
] as const;

export const APPROVAL_TYPES: Record<string, { label: string; permission: string }> = {
  PARTNER_APPROVAL: { label: 'Partner onboarding', permission: 'partner.approve' },
  PARTNER_CONFIG: { label: 'Partner configuration', permission: 'partner.approve' },
  PARTNER_PORTAL: { label: 'Partner portal settings', permission: 'partner.approve' },
  PARTNER_PRODUCTION: { label: 'Production activation', permission: 'partner.production.approve' },
  PARTNER_REACTIVATION: { label: 'Partner reactivation', permission: 'partner.approve' },
  VENDOR_ACCOUNT: { label: 'Vendor settlement account', permission: 'vendor.approve' },
  CREDIT_POLICY: { label: 'Credit policy version', permission: 'policy.approve' },
  REVIEW_DECISION: { label: 'Enhanced review decision', permission: 'review.approve' },
  VENDOR_PAYMENT: { label: 'Vendor payment', permission: 'payment.approve' },
  REFUND: { label: 'Vendor refund', permission: 'refund.approve' },
  ROLE_ASSIGNMENT: { label: 'Role assignment / invitation', permission: 'user.approve' },
};

export const REVIEW_QUEUES: Array<{ id: string; label: string; description: string }> = [
  { id: 'FAIR_CREDIT', label: 'Fair credit', description: 'SeedScore in the FAIR band — enhanced assessment form submitted by the customer.' },
  { id: 'THIN_FILE', label: 'Thin file', description: 'No credit history returned — manual review per policy thin-file treatment.' },
  { id: 'BUSINESS_OWNER', label: 'Business owner', description: 'Business-owner income profile — manual affordability assessment.' },
  { id: 'INCONSISTENT_STATEMENT', label: 'Inconsistent statement', description: 'Statement analysis flagged inconsistencies or uncertain salary.' },
  { id: 'BORDERLINE_AFFORDABILITY', label: 'Borderline affordability', description: 'Affordability close to policy limits — analyst judgement required.' },
];

export const ARAF_STAGES = ['RECEIVED', 'BUSINESS_EVALUATION', 'CREDIT_REVIEW', 'APPROVAL', 'INFO_REQUESTED', 'APPROVED', 'REJECTED'] as const;

export const ARAF_ACTIONS: Record<string, { label: string; from: string[]; permission: string; tone: 'primary' | 'secondary' | 'danger' | 'gold'; help: string }> = {
  START_EVALUATION: { label: 'Start business evaluation', from: ['RECEIVED'], permission: 'araf.simulator.operate', tone: 'primary', help: 'Emits UNDER_REVIEW to Pay with ARAF.' },
  COMPLETE_EVALUATION: { label: 'Complete evaluation → credit review', from: ['BUSINESS_EVALUATION'], permission: 'araf.simulator.operate', tone: 'primary', help: 'Moves the case to credit review (no external event).' },
  REQUEST_INFO: { label: 'Request information', from: ['BUSINESS_EVALUATION', 'CREDIT_REVIEW'], permission: 'araf.simulator.operate', tone: 'secondary', help: 'Emits INFO_REQUESTED — the customer is asked for more information.' },
  RECOMMEND_APPROVAL: { label: 'Recommend approval', from: ['CREDIT_REVIEW'], permission: 'araf.simulator.operate', tone: 'gold', help: 'Moves to the approval stage. The recommender cannot approve.' },
  RETURN_FOR_CORRECTION: { label: 'Return for correction', from: ['APPROVAL'], permission: 'araf.simulator.operate', tone: 'secondary', help: 'Sends the case back to credit review.' },
  APPROVE: { label: 'Approve financing', from: ['APPROVAL'], permission: 'araf.simulator.approve', tone: 'gold', help: 'Emits APPROVED — financing approved (not yet booked or paid).' },
  REJECT: { label: 'Reject', from: ['BUSINESS_EVALUATION', 'CREDIT_REVIEW', 'APPROVAL'], permission: 'araf.simulator.operate|araf.simulator.approve', tone: 'danger', help: 'Emits REJECTED — the application is declined.' },
};

export const EXCEPTION_CATEGORIES = ['ACCOUNT_OPENING', 'ANALYSIS', 'ARAF_SUBMISSION', 'BOOKING', 'DELIVERY', 'MANDATE', 'RECONCILIATION', 'REFUND', 'VENDOR_PAYMENT'];
export const EXCEPTION_TEAMS = ['CAD', 'OPERATIONS', 'SETTLEMENT', 'TECHNOLOGY'];
export const POLICY_TENORS = [3, 6, 9, 12, 18, 24];

export function roleLabel(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

export function hours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
