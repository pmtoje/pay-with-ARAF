/** Response shapes of the partner-portal API (apps/api/src/partners/partner-portal.controller.ts). */

export type Permission =
  | 'p.dashboard.read'
  | 'p.application.read'
  | 'p.fulfilment.manage'
  | 'p.settlement.read'
  | 'p.refund.request'
  | 'p.integration.manage'
  | 'p.integration.read'
  | 'p.team.manage'
  | 'p.report.export';

export interface Me {
  user: { id: string; email: string; full_name: string; roles: string[]; permissions: string[] };
  partner: { id: string; partnerCode: string; tradingName: string; status: string } | null;
  mfa_verified: boolean;
  environment: 'SANDBOX' | 'PRODUCTION';
  sandbox: boolean;
}

export interface Overview {
  range: { from: string; to: string };
  total_applications: number;
  total_requested_value: number;
  eligible_applications: number;
  submitted_to_araf: number;
  approved: number;
  declined: number;
  pending_customer_action: number;
  vendor_payments_pending: number;
  vendor_payments_confirmed: number;
  confirmed_payment_value: number;
  ready_for_release: number;
  dispatched: number;
  delivered: number;
  conversion_rate: number | null;
  average_processing_hours: number | null;
  daily: Array<{ date: string; applications: number; value: number }>;
  status_breakdown: Array<{ status: string; count: number }>;
}

export interface ApplicationRow {
  reference: string;
  merchant_order_reference?: string;
  status: string;
  purchase_amount: number | null;
  created_at: string;
  updated_at: string;
}

export interface Paged<T> {
  page: number;
  page_size: number;
  total: number;
  data: T[];
}

export interface ApplicationDetail {
  object: 'application';
  reference: string;
  status: string;
  merchant_order_reference: string;
  checkout_session_id: string;
  currency: string;
  purchase_amount: number | null;
  customer_contribution: number | null;
  equity?: { required: boolean; amount: number; status: string; payable: boolean; payment_reference?: string | null; confirmed_at?: string | null };
  financed_amount?: number | null;
  araf_fee?: { rate_percent: number; amount: number | null; charged: string; settlement: string };
  vendor_payment: { reference: string; status: string; amount: number | null; confirmed_at: string | null; simulated: boolean } | null;
  release: { reference?: string; status?: string; authorized: boolean; authorized_at?: string | null };
  timeline: Array<{ status: string; at: string }>;
  fulfilment: Array<{ status: string; at: string; tracking_reference: string | null }>;
  livemode: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReleaseItem {
  release_reference: string;
  release_status: 'AUTHORIZED' | 'SUSPENDED' | string;
  suspension_reason: string | null;
  application_reference: string;
  merchant_order_reference: string;
  products: string[];
  vendor: string;
  payment_amount: number | null;
  payment_reference: string;
  payment_status: string;
  customer_contact: { email: string | null; phone: string | null };
  authorized_at: string | null;
  prepared: boolean;
  simulated: boolean;
}

export interface Settlement {
  payment_reference: string;
  application_reference?: string;
  merchant_order_reference?: string | null;
  vendor_reference?: string;
  vendor_name?: string;
  amount: number | null;
  currency: string;
  status: string;
  beneficiary_account: string | null;
  beneficiary_bank: string | null;
  provider_reference: string | null;
  reconciliation_status: string;
  initiated_at: string | null;
  confirmed_at: string | null;
  simulated: boolean;
}

export interface Refund {
  reference: string;
  application_reference?: string;
  status: string;
  expected_amount: number | null;
  received_amount: number | null;
  simulated: boolean;
  created_at: string;
}

export interface Credential {
  id: string;
  name: string;
  environment: string;
  prefix: string;
  last4: string;
  scopes: string[];
  ip_allowlist: string[];
  status: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface CreatedCredential {
  id: string;
  secret: string;
  prefix: string;
  environment: string;
  scopes: string[];
  warning: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  status: string;
  secret_last4: string;
  consecutive_failures: number;
  created_at: string;
  rotation_in_progress: boolean;
}

export interface Integration {
  partner: { id: string; code: string; name: string; status: string };
  environment: 'SANDBOX' | 'PRODUCTION';
  api_base_url: string;
  production_available: boolean;
  credentials: Credential[];
  webhook_endpoints: WebhookEndpoint[];
  approved_return_origins: string[];
  checkout: { sdk_url: string; checkout_origin: string; button_label: string; embed_origins: string[]; button?: { theme: 'dark' | 'gold'; show_amount: boolean }; support?: { email: string | null; phone: string | null } };
  configuration: {
    id: string;
    version: number;
    status: string;
    min_transaction_kobo: number;
    max_transaction_kobo: number;
    permitted_products: string[];
    permitted_tenors: number[];
    eligible_categories: string[];
    application_expiry_minutes: number;
    order_reservation_minutes: number;
    partial_financing_enabled: boolean;
    annual_profit_rate_percent?: number;
    allow_multiple_vendors: boolean;
    settlement_arrangement: string;
    sandbox_enabled: boolean;
    production_enabled: boolean;
    approved_at: string | null;
  } | null;
  event_types: Array<{ type: string; description: string }>;
  health: { total: number; succeeded: number; retrying: number; dead_lettered: number; success_rate: number | null };
}

export interface WebhookDelivery {
  id: string;
  endpoint: string;
  status: string;
  attempts: number;
  last_status_code: number | null;
  last_error: string | null;
  next_attempt_at: string | null;
  succeeded_at: string | null;
}

export interface WebhookEventRow {
  id: string;
  event: string;
  created_at: string;
  application_reference: string | null;
  merchant_order_reference: string | null;
  payload: Record<string, unknown>;
  deliveries: WebhookDelivery[];
}

export interface ApiLog {
  id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  correlation_id: string;
  idempotency_key: string | null;
  credential_id: string | null;
  at: string;
}

export interface Team {
  users: Array<{ id: string; email: string; full_name: string; status: string; roles: string[]; last_login_at: string | null }>;
  pending_invitations: Array<{ id: string; email: string; full_name: string; roles: string[]; expires_at: string }>;
  available_roles: Array<{ code: string; name: string; description: string }>;
}

export interface PartnerNotification {
  id: string;
  template: string;
  subject: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  current: boolean;
}

/** Merchant statuses (packages/business-rules/src/statuses.ts → MerchantStatus). */
export const MERCHANT_STATUSES = [
  'CUSTOMER_ACTION_REQUIRED',
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'ELIGIBLE',
  'SUBMITTED',
  'APPROVED',
  'VENDOR_PAYMENT_PENDING',
  'VENDOR_PAYMENT_CONFIRMED',
  'READY_FOR_RELEASE',
  'DISPATCHED',
  'DELIVERED',
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
  'ON_HOLD',
] as const;

export const MERCHANT_STATUS_LABEL: Record<string, string> = {
  CUSTOMER_ACTION_REQUIRED: 'Customer action required',
  IN_PROGRESS: 'In progress',
  UNDER_REVIEW: 'Under Bank review',
  ELIGIBLE: 'Eligible (indicative)',
  SUBMITTED: 'Submitted — not yet approved',
  APPROVED: 'Financing approved',
  VENDOR_PAYMENT_PENDING: 'Vendor payment pending',
  VENDOR_PAYMENT_CONFIRMED: 'Vendor payment confirmed',
  READY_FOR_RELEASE: 'Ready for release',
  DISPATCHED: 'Dispatched',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  ON_HOLD: 'On hold',
};
