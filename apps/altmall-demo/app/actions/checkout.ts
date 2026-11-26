'use server';

import { revalidatePath } from 'next/cache';
import { currentCustomer } from '@/lib/auth';
import { ARAF_RULES, MAX_QTY, PRODUCT_BY_SKU } from '@/lib/catalogue';
import { query } from '@/lib/db';
import { addOrderEvent, createOrder, getOrderForCustomer, startArafCheckout, syncOrderFromAraf, toE164, type OrderLine } from '@/lib/orders';
import { NG_STATES } from '@/lib/states';
import { ARAF_OPEN, TERMINAL_NEGATIVE } from '@/lib/statuses';
import { araf } from '@/lib/araf';

export type PaymentMethod = 'araf' | 'card_demo' | 'transfer_demo';

export interface PlaceOrderInput {
  lines: Array<{ sku: string; qty: number }>;
  delivery: { name: string; phone: string; address: string; city: string; state: string };
  method: PaymentMethod;
  /** Optional, Buy Now Pay Later only: passed to the Bank once, never stored by AltMall. */
  identity?: { date_of_birth?: string; bvn?: string };
}

export type PlaceOrderResult =
  | { ok: true; reference: string; redirect: string; external: boolean }
  | { ok: false; title: string; lines: string[]; fields?: Record<string, string>; reference?: string; signInRequired?: boolean };

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const customer = await currentCustomer();
  if (!customer) return { ok: false, title: 'Please sign in again', lines: ['Your session has ended.'], signInRequired: true };

  // ---- Server-side validation: never trust prices, names or vendors from the browser. ----
  if (!input || !Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 50) return { ok: false, title: 'Your basket is empty', lines: [] };
  const lines: OrderLine[] = [];
  for (const l of input.lines) {
    const p = typeof l?.sku === 'string' ? PRODUCT_BY_SKU[l.sku] : undefined;
    const qty = Math.trunc(Number(l?.qty));
    if (!p || !Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, title: 'Your basket changed', lines: ['One of the items is no longer available. Please review your basket.'] };
    if (lines.some((x) => x.sku === p.sku)) continue;
    lines.push({ sku: p.sku, name: p.name, qty, unitKobo: p.priceKobo, category: p.category, vendorReference: p.vendorReference });
  }
  const d = input.delivery ?? ({} as PlaceOrderInput['delivery']);
  const delivery = { name: String(d.name ?? '').trim(), phone: String(d.phone ?? '').trim(), address: String(d.address ?? '').trim(), city: String(d.city ?? '').trim(), state: String(d.state ?? '').trim() };
  const fields: Record<string, string> = {};
  if (delivery.name.length < 2 || delivery.name.length > 80) fields.name = 'Enter the recipient’s full name.';
  const phone = toE164(delivery.phone);
  if (!phone) fields.phone = 'Enter a Nigerian mobile number, e.g. 0803 123 4567.';
  if (delivery.address.length < 6 || delivery.address.length > 200) fields.address = 'Enter a street address (house number and street).';
  if (delivery.city.length < 2 || delivery.city.length > 60) fields.city = 'Enter a town or city.';
  if (!NG_STATES.includes(delivery.state)) fields.state = 'Choose a state.';
  if (!['araf', 'card_demo', 'transfer_demo'].includes(input.method)) fields.method = 'Choose a payment method.';
  if (Object.keys(fields).length) return { ok: false, title: 'Please check your details', lines: Object.values(fields), fields };

  const total = lines.reduce((s, l) => s + l.unitKobo * l.qty, 0);
  if (input.method === 'araf') {
    const reasons: string[] = [];
    if (new Set(lines.map((l) => l.vendorReference)).size > 1) reasons.push('Pay with ARAF can finance items from one vendor per order. Remove items from other vendors or choose another payment method.');
    if (total < ARAF_RULES.minKobo) reasons.push('Pay with ARAF is available on orders of ₦20,000 or more.');
    if (total > ARAF_RULES.maxKobo) reasons.push('Pay with ARAF is available on orders up to ₦5,000,000.');
    if (reasons.length) return { ok: false, title: 'This basket can’t be paid with ARAF', lines: reasons };
  }

  if (input.method === 'araf') {
    // The Bank receives the shopper's identity details from AltMall (server-to-server) and runs the checks.
    const id = input.identity ?? {};
    if (!id.date_of_birth || !/^\d{4}-\d{2}-\d{2}$/.test(id.date_of_birth) || !id.bvn || !/^\d{11}$/.test(id.bvn)) {
      return { ok: false, title: 'Add your date of birth and BVN', lines: ['The Alternative Bank needs them to check your eligibility.'], fields: { ...(!id.date_of_birth ? { dob: 'Enter your date of birth.' } : {}), ...(!id.bvn || !/^\d{11}$/.test(id.bvn) ? { bvn: 'Enter the 11 digits of your BVN.' } : {}) } };
    }
  }
  const order = await createOrder(customer, lines, { ...delivery, phone: phone! }, input.method);
  revalidatePath('/orders');
  if (input.method !== 'araf') return { ok: true, reference: order.reference, redirect: `/orders/${order.reference}?placed=1`, external: false };

  const id = input.identity ?? {};
  const identity = {
    ...(id.date_of_birth && /^\d{4}-\d{2}-\d{2}$/.test(id.date_of_birth) ? { date_of_birth: id.date_of_birth } : {}),
    ...(id.bvn && /^\d{11}$/.test(id.bvn) ? { bvn: id.bvn } : {}),
  };
  const started = await startArafCheckout(order, customer.email, identity);
  if (!started.ok) return { ok: false, title: started.title, lines: started.lines, reference: order.reference };
  // The shopper stays on AltMall: the order page opens the Bank's checkout in an embedded panel.
  return { ok: true, reference: order.reference, redirect: `/orders/${order.reference}?pay=araf`, external: false };
}

/** Switch an order whose financing did not complete to a demo payment method. */
export async function payAnotherWay(reference: string, method: 'card_demo' | 'transfer_demo'): Promise<{ ok: boolean; message?: string }> {
  const customer = await currentCustomer();
  if (!customer) return { ok: false, message: 'Please sign in again.' };
  if (method !== 'card_demo' && method !== 'transfer_demo') return { ok: false, message: 'Choose a payment method.' };
  let order = await getOrderForCustomer(reference, customer.id);
  if (!order) return { ok: false, message: 'Order not found.' };
  if (order.status === 'PAID' || order.status === 'DISPATCHED' || order.status === 'DELIVERED' || order.cancel_reason) return { ok: false, message: 'This order no longer needs payment.' };
  // Authoritative check: do not take a second payment while financing is still live.
  if (order.araf_application_reference) {
    const s = await syncOrderFromAraf(order);
    if (s.error) return { ok: false, message: 'We couldn’t confirm your Pay with ARAF status right now. Please try again shortly.' };
    order = s.order;
    if (order.araf_status && !TERMINAL_NEGATIVE.includes(order.araf_status)) {
      return { ok: false, message: ARAF_OPEN.includes(order.araf_status) ? 'Your Pay with ARAF application is still active. Cancel it in Pay with ARAF first, or wait for it to finish.' : 'This order is already being paid with ARAF.' };
    }
  }
  await query(`UPDATE orders SET payment_method = $2, status = 'PAID', updated_at = now() WHERE id = $1`, [order.id, method]);
  await addOrderEvent(order.id, 'PAID', `Paid by ${method === 'card_demo' ? 'card' : 'bank transfer'} (demo)`);
  revalidatePath(`/orders/${reference}`);
  return { ok: true };
}

/**
 * The shopper pays their equity (down payment) to AltMall — demo payment, nothing is charged.
 * AltMall then confirms receipt to Pay with ARAF, which only finances the remaining amount.
 * The amount is always taken from Pay with ARAF's authoritative order view, never from the browser.
 */
export async function payEquity(reference: string, method: 'card_demo' | 'transfer_demo'): Promise<{ ok: boolean; message?: string }> {
  const customer = await currentCustomer();
  if (!customer) return { ok: false, message: 'Please sign in again.' };
  if (method !== 'card_demo' && method !== 'transfer_demo') return { ok: false, message: 'Choose a payment method.' };
  const order = await getOrderForCustomer(reference, customer.id);
  if (!order || !order.araf_application_reference) return { ok: false, message: 'Order not found.' };
  const s = await syncOrderFromAraf(order);
  const equity = s.remote?.application?.equity;
  if (s.error || !equity) return { ok: false, message: 'We couldn’t confirm your Pay with ARAF status right now. Please try again shortly.' };
  if (equity.status === 'CONFIRMED') return { ok: true };
  if (!equity.payable) return { ok: false, message: 'Your equity becomes payable once The Alternative Bank approves your financing.' };
  const paymentReference = `ALTMALL-EQ-${order.reference.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 64);
  await addOrderEvent(order.id, 'EQUITY_PAID', `Equity of ₦${(equity.amount / 100).toLocaleString('en-NG')} received by ${method === 'card_demo' ? 'card' : 'bank transfer'} (demo) · ${paymentReference}`);
  try {
    await araf.confirmEquity(order.reference, { amount: equity.amount, payment_reference: paymentReference });
  } catch (err) {
    console.warn('[altmall] equity confirmation failed', (err as Error).message);
    return { ok: false, message: 'We received your payment but couldn’t confirm it with Pay with ARAF yet. Please refresh in a moment.' };
  }
  await addOrderEvent(order.id, 'EQUITY_CONFIRMED', 'Equity receipt confirmed to Pay with ARAF');
  revalidatePath(`/orders/${reference}`);
  return { ok: true };
}

/** Start a new Pay with ARAF application for an order whose previous one expired or was cancelled. */
export async function retryAraf(reference: string): Promise<{ ok: true; redirect: string } | { ok: false; message: string }> {
  const customer = await currentCustomer();
  if (!customer) return { ok: false, message: 'Please sign in again.' };
  let order = await getOrderForCustomer(reference, customer.id);
  if (!order) return { ok: false, message: 'Order not found.' };
  if (order.status === 'PAID' || order.cancel_reason) return { ok: false, message: 'This order no longer needs payment.' };
  if (order.araf_application_reference) {
    const s = await syncOrderFromAraf(order);
    order = s.order;
    if (order.araf_status && !['EXPIRED', 'CANCELLED'].includes(order.araf_status)) return { ok: false, message: 'A Pay with ARAF application for this order is still active.' };
  }
  const started = await startArafCheckout(order, customer.email);
  if (!started.ok) return { ok: false, message: `${started.title}. ${started.lines.join(' ')}` };
  return { ok: true, redirect: started.checkoutUrl };
}
