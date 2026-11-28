import type { ApplicationState } from './state-machines';

/**
 * Derived statuses.
 *
 * The customer sees plain-language status that never implies approval before it happens.
 * The merchant sees an operational status that never reveals credit details
 * (score, salary, statements, affordability) or confidential internal notes.
 */

export type CustomerStage = 'VERIFY_IDENTITY' | 'CONFIRM_ELIGIBILITY' | 'CONNECT_FINANCES' | 'REVIEW_OFFER' | 'SUBMIT' | 'TRACK';

export interface CustomerStatus {
  stage: CustomerStage;
  label: string;
  description: string;
  tone: 'neutral' | 'progress' | 'action' | 'success' | 'negative';
}

const C = (stage: CustomerStage, label: string, description: string, tone: CustomerStatus['tone']): CustomerStatus => ({
  stage,
  label,
  description,
  tone,
});

export function deriveCustomerStatus(state: ApplicationState): CustomerStatus {
  switch (state) {
    case 'CREATED':
    case 'IDENTITY_PENDING':
      return C('VERIFY_IDENTITY', 'Verify your identity', 'Confirm your BVN and date of birth to begin.', 'action');
    case 'IDENTITY_VERIFIED':
    case 'CREDIT_CHECK_PENDING':
    case 'CREDIT_CHECK_COMPLETED':
      return C('CONFIRM_ELIGIBILITY', 'Checking eligibility', 'We are running a preliminary eligibility check.', 'progress');
    case 'ENHANCED_REVIEW_REQUIRED':
      return C('CONFIRM_ELIGIBILITY', 'More information needed', 'Tell us a little more so we can assess your eligibility.', 'action');
    case 'ENHANCED_REVIEW_PENDING':
      return C('CONFIRM_ELIGIBILITY', 'Under review', 'We’re checking your application. We’ll let you know as soon as there’s an update.', 'progress');
    case 'ENHANCED_REVIEW_CLEARED':
    case 'ACCOUNT_VERIFICATION_PENDING':
      return C('CONFIRM_ELIGIBILITY', 'Confirm your account', 'Select or open an Alternative Bank account for repayments.', 'action');
    case 'ACCOUNT_OPENING_PENDING':
      return C('CONFIRM_ELIGIBILITY', 'Account opening in progress', 'Complete your account opening, then return here to continue.', 'action');
    case 'ACCOUNT_VERIFIED':
    case 'STATEMENT_PENDING':
      return C('CONNECT_FINANCES', 'Connect your finances', 'Share your bank statement so we can confirm affordability.', 'action');
    case 'STATEMENT_RECEIVED':
    case 'STATEMENT_VALIDATION_PENDING':
    case 'STATEMENT_ANALYSIS_PENDING':
    case 'STATEMENT_ANALYSIS_COMPLETED':
      return C('CONNECT_FINANCES', 'Analysing your statement', 'This usually takes a moment.', 'progress');
    case 'AFFORDABILITY_REVIEW_REQUIRED':
      return C('CONNECT_FINANCES', 'Additional assessment required', 'We’re checking your application. We’ll let you know as soon as there’s an update.', 'progress');
    case 'ELIGIBLE':
    case 'OFFER_PRESENTED':
      return C('REVIEW_OFFER', 'Review your financing offer', 'This is an indicative offer. Final approval follows our review.', 'action');
    case 'OFFER_ACCEPTED':
    case 'ARAF_SUBMISSION_PENDING':
      return C('SUBMIT', 'Submitting your application', 'We are submitting your application for review. It is not yet approved.', 'progress');
    case 'ARAF_SUBMITTED':
    case 'ARAF_UNDER_REVIEW':
      return C('TRACK', 'Application under review', 'Your application has been received and is being reviewed. It is not yet approved.', 'progress');
    case 'ADDITIONAL_INFORMATION_REQUIRED':
      return C('TRACK', 'Additional information required', 'We need a little more information to finish checking your application.', 'action');
    case 'FINANCING_APPROVED':
    case 'DOCUMENTATION_PENDING':
      return C('TRACK', 'Financing approved — documents required', 'Review and sign your financing documents.', 'action');
    case 'MANDATE_PENDING':
      return C('TRACK', 'Set up your repayments', 'Authorise your direct debit and add a backup debit card to continue.', 'action');
    case 'BOOKING_PENDING':
    case 'FINANCING_BOOKED':
    case 'VENDOR_PAYMENT_PENDING':
      return C('TRACK', 'Purchasing your item', 'The Bank is completing the purchase of your item from the vendor.', 'progress');
    case 'VENDOR_PAYMENT_CONFIRMED':
      return C('TRACK', 'Item purchased — sale agreement', 'The Bank has purchased your item. Review the sale agreement when requested.', 'action');
    case 'RELEASE_AUTHORIZED':
      return C('TRACK', 'Ready for dispatch', 'The vendor has been authorised to release your item.', 'success');
    case 'GOODS_DISPATCHED':
      return C('TRACK', 'Dispatched', 'Your item is on its way.', 'success');
    case 'GOODS_DELIVERED':
    case 'COMPLETED':
      return C('TRACK', 'Delivered', 'Your item has been delivered. Repayments follow your agreed schedule.', 'success');
    case 'DECLINED':
      return C('TRACK', 'Not eligible', 'We are unable to offer financing for this purchase.', 'negative');
    case 'CANCELLED':
      return C('TRACK', 'Cancelled', 'This financing application has been cancelled.', 'negative');
    case 'EXPIRED':
      return C('TRACK', 'Expired', 'This application expired. Please start again from the merchant.', 'negative');
    case 'EXCEPTION':
      return C('TRACK', 'Processing delayed', 'We are resolving an issue with your application. No action is needed from you.', 'neutral');
  }
}

export type MerchantStatus =
  | 'IN_PROGRESS'
  | 'CUSTOMER_ACTION_REQUIRED'
  | 'UNDER_REVIEW'
  | 'ELIGIBLE'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'VENDOR_PAYMENT_PENDING'
  | 'VENDOR_PAYMENT_CONFIRMED'
  | 'READY_FOR_RELEASE'
  | 'DISPATCHED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'ON_HOLD';

export function deriveMerchantStatus(state: ApplicationState): MerchantStatus {
  switch (state) {
    case 'CREATED':
    case 'IDENTITY_PENDING':
    case 'ENHANCED_REVIEW_REQUIRED':
    case 'ACCOUNT_VERIFICATION_PENDING':
    case 'ACCOUNT_OPENING_PENDING':
    case 'ACCOUNT_VERIFIED':
    case 'STATEMENT_PENDING':
    case 'ENHANCED_REVIEW_CLEARED':
      return 'CUSTOMER_ACTION_REQUIRED';
    case 'IDENTITY_VERIFIED':
    case 'CREDIT_CHECK_PENDING':
    case 'CREDIT_CHECK_COMPLETED':
    case 'STATEMENT_RECEIVED':
    case 'STATEMENT_VALIDATION_PENDING':
    case 'STATEMENT_ANALYSIS_PENDING':
    case 'STATEMENT_ANALYSIS_COMPLETED':
      return 'IN_PROGRESS';
    case 'ENHANCED_REVIEW_PENDING':
    case 'AFFORDABILITY_REVIEW_REQUIRED':
      return 'UNDER_REVIEW';
    case 'ELIGIBLE':
    case 'OFFER_PRESENTED':
      return 'ELIGIBLE';
    case 'OFFER_ACCEPTED':
    case 'ARAF_SUBMISSION_PENDING':
    case 'ARAF_SUBMITTED':
    case 'ARAF_UNDER_REVIEW':
    case 'ADDITIONAL_INFORMATION_REQUIRED':
      return 'SUBMITTED';
    case 'FINANCING_APPROVED':
    case 'DOCUMENTATION_PENDING':
    case 'MANDATE_PENDING':
    case 'BOOKING_PENDING':
    case 'FINANCING_BOOKED':
      return 'APPROVED';
    case 'VENDOR_PAYMENT_PENDING':
      return 'VENDOR_PAYMENT_PENDING';
    case 'VENDOR_PAYMENT_CONFIRMED':
      return 'VENDOR_PAYMENT_CONFIRMED';
    case 'RELEASE_AUTHORIZED':
      return 'READY_FOR_RELEASE';
    case 'GOODS_DISPATCHED':
      return 'DISPATCHED';
    case 'GOODS_DELIVERED':
      return 'DELIVERED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'DECLINED':
      return 'DECLINED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'EXCEPTION':
      return 'ON_HOLD';
  }
}

/** Funnel stages for management reporting, in order. */
export const FUNNEL_STAGES: Array<{ key: string; label: string; reachedAt: ApplicationState }> = [
  { key: 'initiated', label: 'Checkout initiated', reachedAt: 'CREATED' },
  { key: 'identity', label: 'Identity verified', reachedAt: 'IDENTITY_VERIFIED' },
  { key: 'credit', label: 'Credit check passed', reachedAt: 'ACCOUNT_VERIFICATION_PENDING' },
  { key: 'account', label: 'Account verified', reachedAt: 'ACCOUNT_VERIFIED' },
  { key: 'statement', label: 'Statement connected', reachedAt: 'STATEMENT_RECEIVED' },
  { key: 'analysed', label: 'Statement analysed', reachedAt: 'STATEMENT_ANALYSIS_COMPLETED' },
  { key: 'eligible', label: 'Eligible', reachedAt: 'ELIGIBLE' },
  { key: 'accepted', label: 'Offer accepted', reachedAt: 'OFFER_ACCEPTED' },
  { key: 'submitted', label: 'Submitted to ARAF', reachedAt: 'ARAF_SUBMITTED' },
  { key: 'approved', label: 'Approved', reachedAt: 'FINANCING_APPROVED' },
  { key: 'booked', label: 'Booked', reachedAt: 'FINANCING_BOOKED' },
  { key: 'paid', label: 'Vendor paid', reachedAt: 'VENDOR_PAYMENT_CONFIRMED' },
  { key: 'delivered', label: 'Goods delivered', reachedAt: 'GOODS_DELIVERED' },
];
