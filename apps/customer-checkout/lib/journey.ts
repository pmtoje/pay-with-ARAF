import type { Stage, View } from './types';

export const STEPS = [
  { id: 'VERIFY_IDENTITY', label: 'Verify identity' },
  { id: 'CONFIRM_ELIGIBILITY', label: 'Confirm eligibility' },
  { id: 'CONNECT_FINANCES', label: 'Connect finances' },
  { id: 'REVIEW_OFFER', label: 'Review offer' },
  { id: 'SUBMIT', label: 'Submit' },
];

export function stageIndex(stage: Stage): number {
  const i = STEPS.findIndex((s) => s.id === stage);
  return i === -1 ? STEPS.length : i;
}

/** Application states in lifecycle order (terminal / exception states excluded). */
const ORDER = [
  'CREATED',
  'IDENTITY_PENDING',
  'IDENTITY_VERIFIED',
  'CREDIT_CHECK_PENDING',
  'CREDIT_CHECK_COMPLETED',
  'ENHANCED_REVIEW_REQUIRED',
  'ENHANCED_REVIEW_PENDING',
  'ENHANCED_REVIEW_CLEARED',
  'ACCOUNT_VERIFICATION_PENDING',
  'ACCOUNT_OPENING_PENDING',
  'ACCOUNT_VERIFIED',
  'STATEMENT_PENDING',
  'STATEMENT_RECEIVED',
  'STATEMENT_VALIDATION_PENDING',
  'STATEMENT_ANALYSIS_PENDING',
  'STATEMENT_ANALYSIS_COMPLETED',
  'AFFORDABILITY_REVIEW_REQUIRED',
  'ELIGIBLE',
  'OFFER_PRESENTED',
  'OFFER_ACCEPTED',
  'ARAF_SUBMISSION_PENDING',
  'ARAF_SUBMITTED',
  'ARAF_UNDER_REVIEW',
  'ADDITIONAL_INFORMATION_REQUIRED',
  'FINANCING_APPROVED',
  'DOCUMENTATION_PENDING',
  'MANDATE_PENDING',
  'BOOKING_PENDING',
  'FINANCING_BOOKED',
  'VENDOR_PAYMENT_PENDING',
  'VENDOR_PAYMENT_CONFIRMED',
  'RELEASE_AUTHORIZED',
  'GOODS_DISPATCHED',
  'GOODS_DELIVERED',
  'COMPLETED',
];

export const rank = (state: string) => ORDER.indexOf(state);
export const reached = (state: string, target: string) => rank(state) >= 0 && rank(state) >= rank(target);

export const TERMINAL = new Set(['DECLINED', 'CANCELLED', 'EXPIRED']);

/** States where the API is doing asynchronous work the customer is waiting on (poll fast). */
export const FAST_POLL = new Set([
  'STATEMENT_RECEIVED',
  'STATEMENT_VALIDATION_PENDING',
  'STATEMENT_ANALYSIS_PENDING',
  'STATEMENT_ANALYSIS_COMPLETED',
  'OFFER_ACCEPTED',
  'ARAF_SUBMISSION_PENDING',
  'CREDIT_CHECK_COMPLETED',
]);

/** States that change on the Bank's side, without customer action (poll slowly). */
export const SLOW_POLL = new Set([
  'ENHANCED_REVIEW_PENDING',
  'AFFORDABILITY_REVIEW_REQUIRED',
  'ARAF_SUBMITTED',
  'ARAF_UNDER_REVIEW',
  'FINANCING_APPROVED',
  'BOOKING_PENDING',
  'FINANCING_BOOKED',
  'VENDOR_PAYMENT_PENDING',
  'VENDOR_PAYMENT_CONFIRMED',
  'RELEASE_AUTHORIZED',
  'GOODS_DISPATCHED',
  'MANDATE_PENDING',
  'EXCEPTION',
]);

/** The customer may cancel before the application is submitted to the Bank. */
export const CANCELLABLE = new Set([
  'IDENTITY_VERIFIED',
  'CREDIT_CHECK_PENDING',
  'ENHANCED_REVIEW_REQUIRED',
  'ENHANCED_REVIEW_PENDING',
  'ENHANCED_REVIEW_CLEARED',
  'ACCOUNT_VERIFICATION_PENDING',
  'ACCOUNT_OPENING_PENDING',
  'ACCOUNT_VERIFIED',
  'STATEMENT_PENDING',
  'AFFORDABILITY_REVIEW_REQUIRED',
  'ELIGIBLE',
  'OFFER_PRESENTED',
]);

export type MilestoneState = 'done' | 'current' | 'upcoming' | 'attention';

export interface Milestone {
  id: string;
  title: string;
  description: string;
  state: MilestoneState;
}

const hasDoc = (v: View, type: string, signed?: boolean) => (v.documents ?? []).some((d) => d.type === type && (!signed || d.status === 'SIGNED'));

/** Post-submission milestones, derived from the state and the records the view exposes. */
export function milestones(v: View): Milestone[] {
  const s = v.state;
  const fulfil = (status: string) => (v.fulfilment ?? []).some((f) => f.status === status);
  const done = {
    submitted: reached(s, 'ARAF_SUBMITTED'),
    review: reached(s, 'FINANCING_APPROVED') || reached(s, 'ARAF_UNDER_REVIEW'),
    approved: reached(s, 'FINANCING_APPROVED') || (v.documents ?? []).length > 0,
    documents: reached(s, 'MANDATE_PENDING') || hasDoc(v, 'PROMISE_TO_PURCHASE', true),
    mandate: reached(s, 'BOOKING_PENDING') || v.mandate?.status === 'ACTIVE',
    purchase: reached(s, 'VENDOR_PAYMENT_CONFIRMED') || v.vendor_payment?.status === 'CONFIRMED',
    sale: reached(s, 'RELEASE_AUTHORIZED') || hasDoc(v, 'SALE_AGREEMENT', true),
    release: reached(s, 'RELEASE_AUTHORIZED') || !!v.release,
    dispatched: reached(s, 'GOODS_DISPATCHED') || fulfil('DISPATCHED'),
    delivered: reached(s, 'GOODS_DELIVERED') || fulfil('DELIVERED'),
  };
  const list: Array<Omit<Milestone, 'state'> & { done: boolean; attention?: boolean }> = [
    { id: 'submitted', title: 'Application submitted', description: 'Received by The Alternative Bank for review.', done: done.submitted },
    { id: 'review', title: 'Under review', description: s === 'ADDITIONAL_INFORMATION_REQUIRED' ? 'We need a little more information from you.' : 'We’re checking your application.', done: done.review && done.approved, attention: s === 'ADDITIONAL_INFORMATION_REQUIRED' },
    { id: 'approved', title: 'Financing approved', description: 'Final approval from the Bank.', done: done.approved },
    { id: 'documents', title: 'Documents signed', description: 'Promise to purchase and offer letter, signed with a one-time code.', done: done.documents, attention: s === 'DOCUMENTATION_PENDING' },
    { id: 'mandate', title: 'Repayment mandate active', description: 'Direct debit authorised for your repayments.', done: done.mandate, attention: s === 'MANDATE_PENDING' },
    ...(v.equity?.required
      ? [{ id: 'equity', title: 'Equity paid to the merchant', description: `Your equity of ₦${(v.equity.amount / 100).toLocaleString('en-NG')} is paid to the merchant, not the Bank.`, done: v.equity.status === 'CONFIRMED', attention: v.equity.payable }]
      : []),
    { id: 'purchase', title: 'Bank purchases your item', description: 'The Bank buys the item from the vendor.', done: done.purchase },
    { id: 'sale', title: 'Sale agreement executed', description: 'The Bank sells the item to you at the agreed deferred sale price.', done: done.sale, attention: s === 'VENDOR_PAYMENT_CONFIRMED' && hasDoc(v, 'SALE_AGREEMENT') },
    { id: 'release', title: 'Released for dispatch', description: 'The vendor is authorised to release your item.', done: done.release },
    { id: 'dispatched', title: 'Dispatched', description: 'Your item is on its way.', done: done.dispatched },
    { id: 'delivered', title: 'Delivered', description: 'Repayments follow your agreed schedule.', done: done.delivered },
  ];
  // Enforce monotonic progress: the first incomplete milestone is "current".
  let currentAssigned = false;
  return list.map((m) => {
    let state: MilestoneState;
    if (m.done && !currentAssigned) state = 'done';
    else if (!currentAssigned) {
      currentAssigned = true;
      state = m.attention ? 'attention' : 'current';
    } else state = 'upcoming';
    return { id: m.id, title: m.title, description: m.description, state };
  });
}

export const DOC_LABEL: Record<string, string> = {
  PROMISE_TO_PURCHASE: 'Promise to purchase',
  OFFER_LETTER: 'Offer letter',
  SALE_AGREEMENT: 'Murabaha sale agreement',
};

export function docLabel(type: string) {
  return DOC_LABEL[type] ?? type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
