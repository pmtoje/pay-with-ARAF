/** Plain-language copy for Pay with ARAF merchant statuses (safe for client and server). */

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'gold';

export interface StatusCopy {
  label: string;
  shopper: string;
  vendor: string;
  tone: Tone;
}

export const MERCHANT_STATUS: Record<string, StatusCopy> = {
  CUSTOMER_ACTION_REQUIRED: {
    label: 'Action needed',
    shopper: 'Pay with ARAF needs a few details from you — such as verifying your identity or confirming your account — before your application can continue.',
    vendor: 'Waiting for the shopper to complete steps in Pay with ARAF.',
    tone: 'gold',
  },
  IN_PROGRESS: {
    label: 'Checking your details',
    shopper: 'Pay with ARAF is running its checks. This usually takes a moment.',
    vendor: 'Eligibility checks in progress.',
    tone: 'info',
  },
  UNDER_REVIEW: {
    label: 'Under review',
    shopper: 'The Alternative Bank is reviewing your information. You’ll be notified when there’s an update.',
    vendor: 'Under review by the Bank.',
    tone: 'info',
  },
  ELIGIBLE: {
    label: 'Review your offer',
    shopper: 'You’re eligible for an indicative offer. Review and accept it in Pay with ARAF — it is not yet an approval.',
    vendor: 'Shopper is reviewing an indicative offer. Not approved.',
    tone: 'gold',
  },
  SUBMITTED: {
    label: 'Application submitted',
    shopper: 'Your application has been submitted to The Alternative Bank for a decision. It is not yet approved.',
    vendor: 'Submitted to the Bank for a decision. Do not ship.',
    tone: 'info',
  },
  APPROVED: {
    label: 'Financing approved',
    shopper: 'Financing is approved. You may be asked to sign documents and set up repayments. The Bank then buys the item from the vendor for you.',
    vendor: 'Approved — but the vendor has not been paid yet. Do not ship.',
    tone: 'success',
  },
  VENDOR_PAYMENT_PENDING: {
    label: 'Paying the vendor',
    shopper: 'The Alternative Bank is paying the vendor for your item.',
    vendor: 'Bank payment to the vendor is in progress. Do not ship.',
    tone: 'info',
  },
  VENDOR_PAYMENT_CONFIRMED: {
    label: 'Vendor paid',
    shopper: 'The vendor has been paid. You may be asked to accept the sale agreement before your item is released.',
    vendor: 'Vendor payment confirmed. Awaiting release authorisation — do not ship yet.',
    tone: 'info',
  },
  READY_FOR_RELEASE: {
    label: 'Ready for dispatch',
    shopper: 'Everything is complete. The vendor is authorised to release your item and is preparing it for dispatch.',
    vendor: 'Release authorised. You may dispatch the goods.',
    tone: 'success',
  },
  DISPATCHED: {
    label: 'Dispatched',
    shopper: 'Your item is on its way.',
    vendor: 'Dispatched. Confirm delivery when the shopper receives it.',
    tone: 'success',
  },
  DELIVERED: { label: 'Delivered', shopper: 'Your item has been delivered. Repayments follow the schedule you agreed with the Bank.', vendor: 'Delivered.', tone: 'success' },
  COMPLETED: { label: 'Completed', shopper: 'Your item has been delivered. Repayments follow the schedule you agreed with the Bank.', vendor: 'Completed.', tone: 'success' },
  DECLINED: {
    label: 'Not approved',
    shopper: 'Pay with ARAF was unable to offer financing for this purchase. You can still complete your order with another payment method.',
    vendor: 'Declined. No credit details are shared with merchants.',
    tone: 'danger',
  },
  CANCELLED: { label: 'Cancelled', shopper: 'This financing application was cancelled.', vendor: 'Cancelled.', tone: 'danger' },
  EXPIRED: { label: 'Expired', shopper: 'This financing application expired before it was completed.', vendor: 'Expired through inactivity.', tone: 'danger' },
  ON_HOLD: {
    label: 'On hold',
    shopper: 'The Alternative Bank is resolving an issue with your application. No action is needed from you.',
    vendor: 'On hold at the Bank. Do not ship.',
    tone: 'warning',
  },
};

export function statusCopy(status: string | null | undefined): StatusCopy {
  return (status && MERCHANT_STATUS[status]) || { label: status ? status.replace(/_/g, ' ').toLowerCase() : 'Awaiting confirmation', shopper: 'We’re confirming your financing status with Pay with ARAF.', vendor: 'Status not yet confirmed.', tone: 'neutral' };
}

/** Happy-path milestones shown as a progress tracker. */
export const MILESTONES: Array<{ key: string; label: string; reachedBy: string[] }> = [
  { key: 'apply', label: 'Application started', reachedBy: ['CUSTOMER_ACTION_REQUIRED', 'IN_PROGRESS', 'UNDER_REVIEW'] },
  { key: 'eligible', label: 'Eligible', reachedBy: ['ELIGIBLE'] },
  { key: 'submitted', label: 'Submitted', reachedBy: ['SUBMITTED'] },
  { key: 'approved', label: 'Approved', reachedBy: ['APPROVED'] },
  { key: 'paid', label: 'Vendor paid', reachedBy: ['VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED'] },
  { key: 'release', label: 'Ready for dispatch', reachedBy: ['READY_FOR_RELEASE'] },
  { key: 'dispatched', label: 'Dispatched', reachedBy: ['DISPATCHED'] },
  { key: 'delivered', label: 'Delivered', reachedBy: ['DELIVERED', 'COMPLETED'] },
];

export function milestoneIndex(status: string | null | undefined): number {
  if (!status) return -1;
  return MILESTONES.findIndex((m) => m.reachedBy.includes(status));
}

export const TERMINAL_NEGATIVE = ['DECLINED', 'CANCELLED', 'EXPIRED'];
export const SHOPPER_ACTION = ['CUSTOMER_ACTION_REQUIRED', 'ELIGIBLE'];
/** Statuses where the shopper may still have something to do inside Pay with ARAF. */
export const ARAF_OPEN = ['CUSTOMER_ACTION_REQUIRED', 'IN_PROGRESS', 'UNDER_REVIEW', 'ELIGIBLE', 'SUBMITTED', 'APPROVED', 'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED'];

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  araf: 'Pay with ARAF',
  card_demo: 'Card (demo)',
  transfer_demo: 'Bank transfer (demo)',
};

/** Local AltMall order statuses. */
export const ORDER_STATUS_LABEL: Record<string, { label: string; tone: Tone }> = {
  AWAITING_FINANCING: { label: 'Awaiting financing', tone: 'gold' },
  FINANCING_FAILED: { label: 'Payment needed', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  DISPATCHED: { label: 'Dispatched', tone: 'success' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  ON_HOLD: { label: 'On hold', tone: 'warning' },
};

/** Derive AltMall's own order status from the authoritative ARAF merchant status. */
export function localStatusFor(arafStatus: string): string {
  switch (arafStatus) {
    case 'READY_FOR_RELEASE':
      return 'PAID';
    case 'DISPATCHED':
      return 'DISPATCHED';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'DELIVERED';
    case 'DECLINED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'FINANCING_FAILED';
    case 'ON_HOLD':
      return 'ON_HOLD';
    default:
      return 'AWAITING_FINANCING';
  }
}
