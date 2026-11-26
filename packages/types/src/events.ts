export const WEBHOOK_EVENT_TYPES = {
  'application.created': 'A checkout session and application were created.',
  'application.action_required': 'The customer must complete an action.',
  'application.under_review': 'The application is under Bank review.',
  'application.eligible': 'The customer is eligible and is reviewing an indicative offer.',
  'application.declined': 'The application was declined. No credit details are shared.',
  'application.submitted': 'The application was acknowledged by the ARAF workflow.',
  'application.cancelled': 'The application was cancelled.',
  'application.expired': 'The application expired.',
  'application.equity_confirmed': 'The merchant confirmed receipt of the customer equity; only the remainder is financed.',
  'financing.approved': 'Financing was approved in the ARAF workflow. NOT a release authorisation.',
  'financing.booked': 'Financing was booked in core banking. NOT a release authorisation.',
  'vendor.payment_pending': 'Vendor payment instruction created.',
  'vendor.payment_failed': 'Vendor payment failed.',
  'vendor.payment_confirmed': 'Vendor payment confirmed by the authoritative payment system. NOT yet a release authorisation.',
  'vendor.payment_reversed': 'A confirmed vendor payment was reversed.',
  'goods.release_authorized': 'The vendor may release the goods. Verify via GET /api/v1/releases/{reference}.',
  'goods.release_suspended': 'A release authorisation was suspended — do not release.',
  'goods.dispatched': 'Dispatch was confirmed.',
  'goods.delivered': 'Delivery was confirmed.',
  'order.cancelled': 'The order was cancelled.',
  'refund.initiated': 'A vendor refund was initiated.',
  'refund.completed': 'A vendor refund was received and reconciled.',
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_EVENT_TYPES;
export const ALL_WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENT_TYPES) as WebhookEventType[];
export const WEBHOOK_SCHEMA_VERSION = '1.0';
