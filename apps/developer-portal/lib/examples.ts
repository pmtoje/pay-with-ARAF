import type { WebhookEventType } from './reference';

/** Sandbox base URL of this build (PUBLIC_API_URL + /api/v1). */
export const BASE_URL = process.env.NEXT_PUBLIC_ARAF_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const CHECKOUT_BODY = {
  merchant_order_reference: 'ORD-10045',
  currency: 'NGN',
  amount: 45000000,
  items: [
    {
      sku: 'PHONE-001',
      name: 'Sandbox Smartphone X',
      quantity: 1,
      unit_amount: 45000000,
      category: 'smartphones',
      vendor_reference: 'VENDOR-LEKKI-ELEC',
    },
  ],
  customer: { email: 'customer@example.com', phone: '+2348030000001' },
  return_url: 'https://shop.example.com/orders/ORD-10045',
  cancel_url: 'https://shop.example.com/cart',
};

/** Response captured from the sandbox API (identifiers shortened for readability). */
export const CHECKOUT_RESPONSE = {
  object: 'checkout_session',
  session_id: 'cs_test_8jgcwIBR4vXwdvc093VF3lCD',
  application_reference: 'ARAF-2026-000002',
  checkout_url: 'http://localhost:3001/c/cs_test_8jgcwIBR4vXwdvc093VF3lCD',
  status: 'CREATED',
  amount: 45000000,
  currency: 'NGN',
  expires_at: '2026-11-26T09:09:03.998Z',
  livemode: false,
  partner: { id: 'a5e7531d-2293-47f3-9a90-f4a326227a4f', name: 'AltMall' },
};

export const APPLICATION_RESPONSE = {
  object: 'application',
  reference: 'ARAF-2026-000002',
  status: 'READY_FOR_RELEASE',
  merchant_order_reference: 'ORD-10045',
  checkout_session_id: 'cs_test_8jgcwIBR4vXwdvc093VF3lCD',
  currency: 'NGN',
  purchase_amount: 45000000,
  customer_contribution: 0,
  financed_amount: 45000000,
  equity: { required: false, amount: 0, status: 'NOT_REQUIRED', payable: false },
  vendor_payment: {
    reference: 'PAY-000014',
    status: 'CONFIRMED',
    amount: 45000000,
    confirmed_at: '2026-11-25T10:42:18.120Z',
    simulated: true,
  },
  release: { reference: 'REL-000009', status: 'AUTHORIZED', authorized: true, authorized_at: '2026-11-25T10:55:02.441Z' },
  timeline: [
    { status: 'CUSTOMER_ACTION_REQUIRED', at: '2026-11-25T09:09:04.009Z' },
    { status: 'IN_PROGRESS', at: '2026-11-25T09:12:40.310Z' },
    { status: 'ELIGIBLE', at: '2026-11-25T09:20:11.902Z' },
    { status: 'SUBMITTED', at: '2026-11-25T09:22:45.001Z' },
    { status: 'APPROVED', at: '2026-11-25T10:01:13.554Z' },
    { status: 'VENDOR_PAYMENT_PENDING', at: '2026-11-25T10:30:09.020Z' },
    { status: 'VENDOR_PAYMENT_CONFIRMED', at: '2026-11-25T10:42:18.120Z' },
    { status: 'READY_FOR_RELEASE', at: '2026-11-25T10:55:02.441Z' },
  ],
  fulfilment: [],
  livemode: false,
  created_at: '2026-11-25T09:09:04.007Z',
  updated_at: '2026-11-25T10:55:02.441Z',
};

export const RELEASE_RESPONSE = {
  object: 'release_authorization',
  reference: 'REL-000009',
  status: 'AUTHORIZED',
  release_authorized: true,
  application_reference: 'ARAF-2026-000002',
  merchant_order_reference: 'ORD-10045',
  vendor_reference: 'VENDOR-LEKKI-ELEC',
  currency: 'NGN',
  authorized_amount: 45000000,
  authorized_items: [{ sku: 'PHONE-001', name: 'Sandbox Smartphone X', quantity: 1 }],
  payment_reference: 'PAY-000014',
  payment_status: 'CONFIRMED',
  vendor_payment_amount: 45000000,
  authorized_at: '2026-11-25T10:55:02.441Z',
  suspended_at: null,
  suspension_reason: null,
  simulated: true,
  livemode: false,
};

const REF = { application_reference: 'ARAF-2026-000002', merchant_order_reference: 'ORD-10045' };

/** Event-specific `data` fields, as emitted by the API (data.status is the merchant status after the change). */
export const EVENT_DATA: Record<WebhookEventType, Record<string, unknown>> = {
  'application.created': { status: 'CUSTOMER_ACTION_REQUIRED', amount: 45000000, currency: 'NGN', checkout_session_id: 'cs_test_8jgcwIBR4vXwdvc093VF3lCD' },
  'application.action_required': { status: 'CUSTOMER_ACTION_REQUIRED' },
  'application.under_review': { status: 'UNDER_REVIEW' },
  'application.eligible': { status: 'ELIGIBLE' },
  'application.declined': { status: 'DECLINED' },
  'application.submitted': { status: 'SUBMITTED' },
  'application.equity_confirmed': { status: 'APPROVED', equity_amount: 200000000, equity_payment_reference: 'ALTMALL-EQ-10045' },
  'application.cancelled': { status: 'CANCELLED' },
  'application.expired': { status: 'EXPIRED' },
  'financing.approved': { status: 'APPROVED' },
  'financing.booked': { status: 'APPROVED' },
  'vendor.payment_pending': { status: 'VENDOR_PAYMENT_PENDING', payment_reference: 'PAY-000014', vendor_payment_amount: 45000000 },
  'vendor.payment_failed': { status: 'ON_HOLD', payment_reference: 'PAY-000014' },
  'vendor.payment_confirmed': { status: 'VENDOR_PAYMENT_CONFIRMED', payment_reference: 'PAY-000014', vendor_payment_amount: 45000000, payment_status: 'CONFIRMED' },
  'vendor.payment_reversed': { status: 'ON_HOLD', payment_reference: 'PAY-000014' },
  'goods.release_authorized': {
    status: 'READY_FOR_RELEASE',
    currency: 'NGN',
    vendor_reference: 'VENDOR-LEKKI-ELEC',
    vendor_payment_amount: 45000000,
    payment_reference: 'PAY-000014',
    payment_status: 'CONFIRMED',
    release_authorized: true,
    release_reference: 'REL-000009',
    authorized_items: [{ sku: 'PHONE-001', quantity: 1 }],
    simulated: true,
  },
  'goods.release_suspended': { status: 'READY_FOR_RELEASE', release_reference: 'REL-000009', release_authorized: false, reason: 'CANCELLATION_REQUESTED' },
  'goods.dispatched': { status: 'DISPATCHED', tracking_reference: 'GIG-123', carrier: 'GIG Logistics', collected: false },
  'goods.delivered': { status: 'DELIVERED' },
  'order.cancelled': { status: 'CANCELLED', reason: 'Customer changed their mind' },
  'refund.initiated': { status: 'READY_FOR_RELEASE', refund_reference: 'RFD-000003', expected_amount: 45000000 },
  'refund.completed': { status: 'CANCELLED', refund_reference: 'RFD-000003', amount: 45000000 },
};

export const EVENT_NOTES: Partial<Record<WebhookEventType, string>> = {
  'application.created': 'Sent when POST /checkout/sessions succeeds. resource_version is 0.',
  'application.action_required': 'May include reason: "CART_REVISION_REQUIRED" when the customer is eligible for less than the cart total and partial financing is disabled — create a revised session with revises_session_id.',
  'application.declined': 'No decline reason or credit information is ever shared with merchants.',
  'financing.approved': 'Approval is NOT authority to release goods.',
  'financing.booked': 'Booking is NOT authority to release goods.',
  'vendor.payment_confirmed': 'Confirmed by the authoritative payment system, but still NOT a release authorisation — contractual conditions must also be met.',
  'goods.release_authorized': 'The only event that permits release — and only after you confirm it with GET /api/v1/releases/{release_reference}. Also sent with reinstated: true when a suspended release is reinstated.',
  'goods.release_suspended': 'Stop: do not release. Possible reason values include CANCELLATION_REQUESTED and VENDOR_PAYMENT_REVERSED; a release suspended by the Bank may omit reason. data.status can still read READY_FOR_RELEASE — always rely on release_authorized / the releases endpoint.',
  'goods.dispatched': 'collected is true when the customer collected in person (delivery is then completed immediately).',
  'order.cancelled': 'reason is present when the cancellation came from your POST /orders/{ref}/cancel.',
};

export function exampleEvent(type: WebhookEventType, opts: { test?: boolean } = {}) {
  return {
    event_id: 'evt_95L9ZTu48WZumW0FUOMXD8mI',
    event: type,
    version: '1.0',
    created_at: '2026-11-25T10:55:02.441Z',
    livemode: false,
    ...(opts.test ? { test: true } : {}),
    partner_id: 'a5e7531d-2293-47f3-9a90-f4a326227a4f',
    resource_version: type === 'application.created' ? 0 : 14,
    data: { ...REF, ...EVENT_DATA[type] },
  };
}

export const json = (v: unknown) => JSON.stringify(v, null, 2);
