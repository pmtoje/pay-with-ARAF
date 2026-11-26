import 'server-only';
import { config } from './config';

/**
 * Minimal server-side client for the public Pay with ARAF partner API (v1).
 * Authenticated with AltMall's secret key — this module must never be imported by client code.
 */

export class ArafApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly correlationId?: string,
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  if (!config.arafSecretKey) throw new ArafApiError(0, 'NOT_CONFIGURED', 'Pay with ARAF is not configured on this store.');
  let res: Response;
  try {
    res = await fetch(`${config.arafApiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.arafSecretKey}`,
        Accept: 'application/json',
        'User-Agent': 'AltMall-demo/1.0',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ArafApiError(0, 'NETWORK_ERROR', `Could not reach Pay with ARAF (${(err as Error).message}).`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown>; correlation_id?: string } } | null)?.error;
    throw new ArafApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? `Pay with ARAF returned HTTP ${res.status}.`, e?.details, e?.correlation_id);
  }
  return json as T;
}

// ---- Response shapes (from apps/api checkout.service) ---------------------------------

export interface CheckoutSessionResponse {
  object: 'checkout_session';
  session_id: string;
  application_reference: string;
  checkout_url: string;
  status: string;
  amount: number;
  currency: 'NGN';
  expires_at: string;
}

export interface MerchantApplication {
  object: 'application';
  reference: string;
  status: string;
  merchant_order_reference: string;
  checkout_session_id: string;
  purchase_amount: number;
  customer_contribution: number;
  /** Customer equity AltMall collects directly; the Bank finances only the remainder. */
  equity: { required: boolean; amount: number; status: 'NOT_REQUIRED' | 'DUE_AFTER_APPROVAL' | 'AWAITING_PAYMENT' | 'CONFIRMED'; payable: boolean; payment_reference?: string | null; confirmed_at?: string | null };
  financed_amount: number;
  vendor_payment: { reference: string; status: string; amount: number; confirmed_at: string | null; simulated: boolean } | null;
  release: { reference?: string; status?: string; authorized: boolean; authorized_at?: string | null };
  timeline: Array<{ status: string; at: string }>;
  fulfilment: Array<{ status: string; at: string; tracking_reference: string | null }>;
  created_at: string;
  updated_at: string;
}

export interface ArafOrder {
  object: 'order';
  merchant_order_reference: string;
  status: string;
  amount: number;
  currency: 'NGN';
  items: Array<{ sku: string; name: string; quantity: number; unit_amount: number; line_amount: number; category: string }>;
  application: MerchantApplication | null;
}

export interface ArafRelease {
  object: 'release_authorization';
  reference: string;
  status: string;
  release_authorized: boolean;
  application_reference: string;
  merchant_order_reference: string;
  vendor_reference: string;
  authorized_amount: number;
  authorized_items: Array<{ sku: string; name?: string; quantity: number }>;
  payment_reference: string;
  payment_status: string;
  vendor_payment_amount: number;
  authorized_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  simulated: boolean;
}

export interface CreateSessionBody {
  merchant_order_reference: string;
  currency: 'NGN';
  amount: number;
  items: Array<{ sku: string; name: string; quantity: number; unit_amount: number; category: string; vendor_reference: string }>;
  customer: { email?: string; phone?: string };
  return_url: string;
  cancel_url: string;
}

export const araf = {
  createCheckoutSession: (body: CreateSessionBody, idempotencyKey: string) => call<CheckoutSessionResponse>('POST', '/api/v1/checkout/sessions', body, { 'Idempotency-Key': idempotencyKey }),
  getOrder: (ref: string) => call<ArafOrder>('GET', `/api/v1/orders/${encodeURIComponent(ref)}`),
  getRelease: (ref: string) => call<ArafRelease>('GET', `/api/v1/releases/${encodeURIComponent(ref)}`),
  confirmEquity: (ref: string, body: { amount: number; payment_reference: string }) => call<{ status: string; idempotent_replay: boolean }>('POST', `/api/v1/orders/${encodeURIComponent(ref)}/equity`, body),
  fulfil: (ref: string, body: { status: 'DISPATCHED'; tracking_reference?: string; carrier?: string }) => call<{ ok: boolean }>('POST', `/api/v1/orders/${encodeURIComponent(ref)}/fulfil`, body),
  deliver: (ref: string, body: { note?: string } = {}) => call<{ ok: boolean }>('POST', `/api/v1/orders/${encodeURIComponent(ref)}/deliver`, body),
  cancel: (ref: string, reason: string) => call<{ status: string; requires_reversal: boolean }>('POST', `/api/v1/orders/${encodeURIComponent(ref)}/cancel`, { reason }),
};

const CART_ERROR_COPY: Record<string, string> = {
  MULTIPLE_VENDORS_NOT_SUPPORTED: 'Pay with ARAF can finance items from one vendor per order. Split your basket into separate orders.',
  BELOW_PARTNER_MINIMUM: 'Pay with ARAF is available for orders of ₦20,000 or more.',
  ABOVE_PARTNER_MAXIMUM: 'Pay with ARAF is available for orders up to ₦5,000,000.',
  CATEGORY_NOT_ELIGIBLE: 'One or more items are not eligible for Pay with ARAF financing.',
  CATEGORY_NOT_PERMITTED_FOR_VENDOR: 'One item’s category is not approved for its vendor.',
  AMOUNT_MISMATCH: 'The order total did not match the items. Please refresh your basket and try again.',
  INVALID_QUANTITY: 'One of the quantities is not valid.',
  INVALID_UNIT_AMOUNT: 'One of the prices is not valid.',
};

/** Turn an API error into shopper-friendly copy (never shows internal detail). */
export function friendlyArafError(err: unknown): { title: string; lines: string[]; code: string } {
  if (!(err instanceof ArafApiError)) return { title: 'Something went wrong', lines: ['Please try again in a moment.'], code: 'UNKNOWN' };
  switch (err.code) {
    case 'CART_INVALID': {
      const errors = Array.isArray(err.details?.errors) ? (err.details!.errors as string[]) : [];
      return { title: 'This basket can’t be financed as it is', lines: errors.length ? errors.map((e) => CART_ERROR_COPY[e] ?? e) : [err.message], code: err.code };
    }
    case 'DUPLICATE_CHECKOUT':
      return { title: 'A financing application already exists for this order', lines: ['Continue the existing application from your order page.'], code: err.code };
    case 'VENDOR_NOT_ELIGIBLE':
      return { title: 'This vendor isn’t available for Pay with ARAF right now', lines: ['Please choose another payment method.'], code: err.code };
    case 'RETURN_URL_NOT_APPROVED':
      return { title: 'Pay with ARAF is not set up correctly on this store', lines: ['Please choose another payment method. (Return URL not approved.)'], code: err.code };
    case 'RATE_LIMITED':
    case 'IDEMPOTENCY_IN_PROGRESS':
      return { title: 'Pay with ARAF is busy', lines: ['Please wait a few seconds and try again.'], code: err.code };
    case 'NETWORK_ERROR':
    case 'NOT_CONFIGURED':
      return { title: 'Pay with ARAF is unavailable', lines: ['We couldn’t reach Pay with ARAF. Please try again or choose another payment method.'], code: err.code };
    default:
      if (err.status >= 500) return { title: 'Pay with ARAF is temporarily unavailable', lines: ['Please try again shortly or choose another payment method.'], code: err.code };
      return { title: 'We couldn’t start Pay with ARAF', lines: [err.message], code: err.code };
  }
}
