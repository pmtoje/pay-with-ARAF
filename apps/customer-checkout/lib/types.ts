/** Response shapes of the hosted-checkout API (apps/api/src/customer/journey.service.ts). */

export type Stage = 'VERIFY_IDENTITY' | 'CONFIRM_ELIGIBILITY' | 'CONNECT_FINANCES' | 'REVIEW_OFFER' | 'SUBMIT' | 'TRACK';

export interface CustomerStatus {
  stage: Stage;
  label: string;
  description: string;
  tone: 'neutral' | 'progress' | 'action' | 'success' | 'negative';
}

export interface Summary {
  session_id: string;
  application_reference: string;
  partner: { name: string; website: string | null };
  currency: 'NGN';
  amount: number;
  items: Array<{ name: string; quantity: number; unit_amount: number; line_amount: number; category: string | null }>;
  cancel_url: string | null;
  return_url: string | null;
  /** Merchant websites approved to embed this checkout. */
  embed_origins?: string[];
  /** Which details the merchant already provided (values stay on the server). */
  prefill?: { from: string; bvn: boolean; bvn_hint: string | null; date_of_birth: boolean; gender?: boolean; name: boolean; email: boolean; phone: boolean; address: boolean };
  expires_at: string;
  expired: boolean;
  superseded_by: string | null;
  sandbox: boolean;
  identity_verified: boolean;
}

export interface Offer {
  id: string;
  reference: string;
  status: 'PRESENTED' | 'ACCEPTED';
  purchase_amount: number;
  financing_amount: number;
  contribution: number;
  tenor_months: number;
  annual_profit_rate_percent: number;
  markup_percent_total: number;
  profit: number;
  deferred_sale_price: number;
  monthly_repayment: number;
  fees: number;
  expires_at: string;
  terms_version: string;
  schedule: Array<{ number: number; due_date: string; amount: number }>;
}

export interface FinancingDoc {
  id: string;
  type: string;
  version: number;
  status: string;
  signed_at: string | null;
}

export interface View {
  application_reference: string;
  state: string;
  status: CustomerStatus;
  authenticated: boolean;
  needs_reauthentication: boolean;
  sandbox: boolean;
  customer?: { first_name: string; bvn: string; phone?: string | null } | null;
  income_profile?: 'SALARY_EARNER' | 'BUSINESS_OWNER' | null;
  account?: { id: string; account_number: string; account_name: string; product: string; source: string } | null;
  enhanced_review?: { status: string; queue: string; clarification_note: string | null; requested_fields: string[] } | null;
  statement?: {
    required_months: number;
    connections: Array<{ id: string; channel: string; status: string; findings: string[]; failure: string | null }>;
    analysis_status: string | null;
  };
  eligibility?: { outcome: string; max_eligible_amount: number | null; reasons: string[] } | null;
  offer?: Offer | null;
  documents?: FinancingDoc[];
  mandate?: { status: string; reference: string | null; failure: string | null } | null;
  vendor_payment?: { status: string; confirmed_at: string | null; simulated: boolean } | null;
  release?: { status: string; reference: string; authorized_at: string | null } | null;
  fulfilment?: Array<{ status: string; at: string; tracking_reference: string | null; carrier: string | null }>;
  exception?: { message: string | null } | null;
  contact_window_hours?: { min: number; max: number } | null;
  /** The Bank's question when it asked for more information. */
  information_request?: { question: string | null; requested_at: string } | null;
  equity?: EquityView;
  annual_profit_rate_percent?: number;
}

export interface EquityView {
  required: boolean;
  amount: number;
  status: 'NOT_REQUIRED' | 'DUE_AFTER_APPROVAL' | 'AWAITING_PAYMENT' | 'CONFIRMED';
  payable: boolean;
  payment_reference?: string | null;
  confirmed_at?: string | null;
  purchase_amount: number | null;
  financed_amount: number | null;
  pay_url: string | null;
}

export interface ConsentItem {
  type: string;
  version: string;
  required: boolean;
  lawful_basis: string;
  provider: string | null;
  text: string;
}

export interface OfferOptions {
  purchase_amount: number;
  financing_amount: number;
  contribution: number;
  max_eligible_amount: number | null;
  annual_profit_rate_percent: number;
  max_tenor_months: number;
  equity: { enabled: boolean; required: boolean; min: number; max: number; amount: number; payee: 'MERCHANT' };
  options: Array<{
    tenor_months: number;
    annual_profit_rate_percent: number;
    markup_percent_total: number;
    profit: number;
    deferred_sale_price: number;
    monthly_repayment: number;
    final_instalment: number;
    affordable: boolean;
  }>;
}

export interface AccountRow {
  id: string;
  account_number: string;
  account_name: string;
  product: string;
  status: string;
  eligible: boolean;
  ineligible_reason: string | null;
}

export interface OtpSent {
  otp_sent_to: string;
  expires_in_seconds?: number;
  resend_available_in_seconds?: number;
}

export function isView(v: unknown): v is View {
  return !!v && typeof v === 'object' && 'state' in v && 'status' in v && 'authenticated' in v;
}
