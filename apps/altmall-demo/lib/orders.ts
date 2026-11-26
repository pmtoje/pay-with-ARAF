import 'server-only';
import { config } from './config';
import { one, query, tx } from './db';
import { araf, ArafApiError, friendlyArafError, type ArafOrder, type ArafRelease } from './araf';
import { localStatusFor } from './statuses';
import type { Customer } from './auth';

export interface OrderRow {
  id: string;
  reference: string;
  customer_id: string;
  status: string;
  payment_method: string;
  amount_kobo: string;
  delivery_name: string;
  delivery_phone: string;
  delivery_address: string;
  delivery_city: string;
  delivery_state: string;
  araf_session_id: string | null;
  araf_checkout_url: string | null;
  araf_application_reference: string | null;
  araf_status: string | null;
  araf_release_reference: string | null;
  araf_release_status: string | null;
  release_authorized: boolean;
  araf_attempts: number;
  araf_last_synced_at: Date | null;
  last_event_version: number;
  tracking_reference: string | null;
  carrier: string | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRow {
  sku: string;
  name: string;
  qty: number;
  unit_kobo: string;
  category: string;
  vendor_reference: string;
}

export interface OrderLine {
  sku: string;
  name: string;
  qty: number;
  unitKobo: number;
  category: string;
  vendorReference: string;
}

export interface Delivery {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
}

export async function addOrderEvent(orderId: string, kind: string, detail?: string): Promise<void> {
  await query('INSERT INTO order_events (order_id, kind, detail) VALUES ($1,$2,$3)', [orderId, kind, detail ?? null]);
}

export async function createOrder(customer: Customer, lines: OrderLine[], delivery: Delivery, method: string): Promise<OrderRow> {
  const total = lines.reduce((s, l) => s + l.unitKobo * l.qty, 0);
  return tx(async (c) => {
    const seq = await c.query<{ n: string }>(`SELECT nextval('order_reference_seq')::text AS n`);
    const reference = `ALTMALL-ORD-${seq.rows[0].n.padStart(6, '0')}`;
    const status = method === 'araf' ? 'AWAITING_FINANCING' : 'PAID';
    const o = await c.query<OrderRow>(
      `INSERT INTO orders (reference, customer_id, status, payment_method, amount_kobo, delivery_name, delivery_phone, delivery_address, delivery_city, delivery_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [reference, customer.id, status, method, total, delivery.name, delivery.phone, delivery.address, delivery.city, delivery.state],
    );
    const order = o.rows[0];
    for (const l of lines) {
      await c.query('INSERT INTO order_items (order_id, sku, name, qty, unit_kobo, category, vendor_reference) VALUES ($1,$2,$3,$4,$5,$6,$7)', [order.id, l.sku, l.name, l.qty, l.unitKobo, l.category, l.vendorReference]);
    }
    await c.query('INSERT INTO order_events (order_id, kind, detail) VALUES ($1,$2,$3)', [order.id, 'ORDER_PLACED', method === 'araf' ? 'Order placed — payment by Pay with ARAF' : `Order placed and paid (${method === 'card_demo' ? 'card' : 'bank transfer'}, demo)`]);
    return order;
  });
}

export async function getOrder(reference: string): Promise<OrderRow | null> {
  return one<OrderRow>('SELECT * FROM orders WHERE reference = $1', [reference]);
}

export async function getOrderForCustomer(reference: string, customerId: string): Promise<OrderRow | null> {
  return one<OrderRow>('SELECT * FROM orders WHERE reference = $1 AND customer_id = $2', [reference, customerId]);
}

export async function orderItems(orderId: string): Promise<OrderItemRow[]> {
  return query<OrderItemRow>('SELECT sku, name, qty, unit_kobo::text AS unit_kobo, category, vendor_reference FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
}

export async function orderEvents(orderId: string) {
  return query<{ kind: string; detail: string | null; created_at: Date }>('SELECT kind, detail, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at DESC, id DESC', [orderId]);
}

/** Nigerian mobile numbers → E.164 (+234…). */
export function toE164(phone: string): string | null {
  const d = phone.replace(/[\s()-]/g, '');
  if (/^\+234[789][01]\d{8}$/.test(d)) return d;
  if (/^234[789][01]\d{8}$/.test(d)) return `+${d}`;
  if (/^0[789][01]\d{8}$/.test(d)) return `+234${d.slice(1)}`;
  return null;
}

/**
 * Create a Pay with ARAF checkout session for an existing AltMall order (server-side, secret key).
 * Returns the hosted checkout URL to redirect the shopper to.
 */
/**
 * AltMall passes Pay with ARAF everything it already knows about the shopper so the Bank's checkout
 * only asks for what is missing. Identity details (date of birth, BVN) are optional, sent
 * server-to-server only, and never stored by AltMall.
 */
export async function startArafCheckout(order: OrderRow, customerEmail: string, identity: { date_of_birth?: string; bvn?: string } = {}): Promise<{ ok: true; checkoutUrl: string } | { ok: false; title: string; lines: string[]; code: string }> {
  const items = await orderItems(order.id);
  const attempt = order.araf_attempts + 1;
  const idempotencyKey = attempt === 1 ? `altmall-${order.reference}` : `altmall-${order.reference}-retry-${attempt}`;
  await query('UPDATE orders SET araf_attempts = $2, updated_at = now() WHERE id = $1', [order.id, attempt]);
  const amount = items.reduce((s, i) => s + Number(i.unit_kobo) * i.qty, 0);
  try {
    const session = await araf.createCheckoutSession(
      {
        merchant_order_reference: order.reference,
        currency: 'NGN',
        amount,
        items: items.map((i) => ({ sku: i.sku, name: i.name, quantity: i.qty, unit_amount: Number(i.unit_kobo), category: i.category, vendor_reference: i.vendor_reference })),
        customer: {
          email: customerEmail,
          phone: toE164(order.delivery_phone) ?? undefined,
          ...splitName(order.delivery_name),
          address: { line1: order.delivery_address, city: order.delivery_city, state: order.delivery_state },
          ...(identity.date_of_birth ? { date_of_birth: identity.date_of_birth } : {}),
          ...(identity.bvn ? { bvn: identity.bvn } : {}),
        },
        return_url: `${config.altmallUrl}/orders/${order.reference}?from=araf`,
        cancel_url: `${config.altmallUrl}/cart?araf=cancelled&order=${order.reference}`,
      },
      idempotencyKey,
    );
    await query(
      `UPDATE orders SET araf_session_id = $2, araf_checkout_url = $3, araf_application_reference = $4, araf_status = COALESCE(CASE WHEN araf_application_reference = $4 THEN araf_status END, 'CUSTOMER_ACTION_REQUIRED'),
         last_event_version = CASE WHEN araf_application_reference = $4 THEN last_event_version ELSE -1 END,
         release_authorized = false, araf_release_reference = NULL, araf_release_status = NULL,
         payment_method = 'araf', status = 'AWAITING_FINANCING', updated_at = now() WHERE id = $1`,
      [order.id, session.session_id, session.checkout_url, session.application_reference],
    );
    await addOrderEvent(order.id, 'ARAF_SESSION_CREATED', `Pay with ARAF application ${session.application_reference} started`);
    return { ok: true, checkoutUrl: session.checkout_url };
  } catch (err) {
    const f = friendlyArafError(err);
    const e = err as ArafApiError;
    console.warn('[altmall] checkout session failed', order.reference, e.code, e.message, JSON.stringify(e.details ?? {}));
    await addOrderEvent(order.id, 'ARAF_SESSION_FAILED', `${f.title} (${f.code})`);
    if (order.araf_attempts === 0 && !order.araf_session_id) await query(`UPDATE orders SET status = 'FINANCING_FAILED', updated_at = now() WHERE id = $1`, [order.id]);
    return { ok: false, ...f };
  }
}

function splitName(full: string): { first_name?: string; last_name?: string } {
  const parts = full.trim().split(/\s+/);
  return parts.length >= 2 ? { first_name: parts[0], last_name: parts.slice(1).join(' ') } : {};
}

export interface SyncResult {
  order: OrderRow;
  remote: ArafOrder | null;
  release: ArafRelease | null;
  error: string | null;
}

/**
 * Fetch the authoritative status from Pay with ARAF (never trust the browser redirect) and
 * persist it. For releases, GET /api/v1/releases/{reference} is the source of truth.
 */
export async function syncOrderFromAraf(order: OrderRow): Promise<SyncResult> {
  if (!order.araf_application_reference) return { order, remote: null, release: null, error: null };
  let remote: ArafOrder;
  try {
    remote = await araf.getOrder(order.reference);
  } catch (err) {
    const e = err as ArafApiError;
    return { order, remote: null, release: null, error: e instanceof ArafApiError ? `${e.code}: ${e.message}` : String(err) };
  }
  const app = remote.application;
  let release: ArafRelease | null = null;
  const releaseRef = app?.release?.reference ?? null;
  if (releaseRef) {
    try {
      release = await araf.getRelease(releaseRef);
    } catch (err) {
      console.warn('[altmall] release lookup failed', releaseRef, (err as Error).message);
    }
  }
  const arafStatus = app?.status ?? order.araf_status;
  const dispatched = app?.fulfilment.find((f) => f.status === 'DISPATCHED' || f.status === 'COLLECTED');
  const updated = await one<OrderRow>(
    `UPDATE orders SET araf_status = $2, araf_application_reference = COALESCE($3, araf_application_reference),
       araf_release_reference = COALESCE($4, araf_release_reference), araf_release_status = COALESCE($5, araf_release_status),
       release_authorized = $6, araf_last_synced_at = now(),
       tracking_reference = COALESCE(tracking_reference, $7),
       status = CASE WHEN payment_method <> 'araf' OR cancel_reason IS NOT NULL THEN status ELSE $8 END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [order.id, arafStatus, app?.reference ?? null, releaseRef, release?.status ?? null, release ? release.release_authorized : false, dispatched?.tracking_reference ?? null, arafStatus ? localStatusFor(arafStatus) : order.status],
  );
  if (updated && updated.araf_status !== order.araf_status) await addOrderEvent(order.id, 'ARAF_STATUS', `Status confirmed with Pay with ARAF: ${arafStatus}`);
  return { order: updated ?? order, remote, release, error: null };
}

export async function listCustomerOrders(customerId: string) {
  return query<OrderRow & { item_count: number; first_sku: string; first_name: string }>(
    `SELECT o.*, (SELECT COALESCE(SUM(qty),0)::int FROM order_items i WHERE i.order_id = o.id) AS item_count,
            (SELECT sku FROM order_items i WHERE i.order_id = o.id ORDER BY id LIMIT 1) AS first_sku,
            (SELECT name FROM order_items i WHERE i.order_id = o.id ORDER BY id LIMIT 1) AS first_name
     FROM orders o WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
    [customerId],
  );
}
