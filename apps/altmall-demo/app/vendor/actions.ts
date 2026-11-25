'use server';

import { timingSafeEqual, createHash } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createVendorSession, destroyVendorSession, isVendor } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { araf, ArafApiError } from '@/lib/araf';
import { addOrderEvent, getOrder, syncOrderFromAraf } from '@/lib/orders';
import { setSimulatedFailures } from '@/lib/webhooks';

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

const digest = (v: string) => createHash('sha256').update(v).digest();

export async function vendorLogin(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const password = String(form.get('password') ?? '');
  if (!password || !timingSafeEqual(digest(password), digest(config.vendorPassword))) return { error: 'That password is incorrect.' };
  await createVendorSession();
  redirect('/vendor');
}

export async function vendorLogout(): Promise<void> {
  await destroyVendorSession();
  redirect('/vendor/login');
}

function apiMessage(err: unknown): string {
  if (err instanceof ArafApiError) {
    if (err.code === 'RELEASE_NOT_AUTHORIZED') return 'Pay with ARAF refused: the release is not authorised. Goods may only ship after the Bank has paid the vendor and authorised release.';
    if (err.code === 'INVALID_STATE') return `Pay with ARAF refused: this action isn’t available at the order’s current stage.`;
    if (err.code === 'FULFILMENT_DUPLICATE') return 'Dispatch was already recorded for this order.';
    return `Pay with ARAF returned ${err.code}: ${err.message}`;
  }
  return 'Something went wrong. Please try again.';
}

async function guard(): Promise<ActionResult | null> {
  if (!(await isVendor())) return { ok: false, message: 'Your vendor session has ended. Sign in again.' };
  return null;
}

export async function refreshOrder(reference: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const order = await getOrder(reference);
  if (!order) return { ok: false, message: 'Order not found.' };
  const r = await syncOrderFromAraf(order);
  revalidatePath('/vendor');
  revalidatePath('/vendor/webhooks');
  if (r.error) return { ok: false, message: `Couldn’t refresh: ${r.error}` };
  return { ok: true, message: `Confirmed with Pay with ARAF: ${r.order.araf_status ?? 'no application'}${r.order.release_authorized ? ' · release authorised' : ''}` };
}

export async function dispatchOrder(reference: string, carrier: string, tracking: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  carrier = carrier.trim();
  tracking = tracking.trim();
  if (carrier.length < 2 || carrier.length > 120) return { ok: false, message: 'Enter the carrier name.' };
  if (!/^[A-Za-z0-9._:\-/ ]{3,120}$/.test(tracking)) return { ok: false, message: 'Enter a tracking reference (letters, digits, - / . _ only).' };
  const order = await getOrder(reference);
  if (!order || order.payment_method !== 'araf') return { ok: false, message: 'Order not found.' };
  // Re-verify with the API immediately before shipping — never rely on cached or webhook state alone.
  const synced = await syncOrderFromAraf(order);
  if (synced.error) return { ok: false, message: `Couldn’t verify the release with Pay with ARAF: ${synced.error}` };
  if (!synced.release?.release_authorized) {
    revalidatePath('/vendor');
    return { ok: false, message: 'Not dispatched: Pay with ARAF has not authorised release for this order. The vendor must be paid before goods are released.' };
  }
  try {
    await araf.fulfil(reference, { status: 'DISPATCHED', tracking_reference: tracking, carrier });
  } catch (err) {
    return { ok: false, message: apiMessage(err) };
  }
  await query('UPDATE orders SET tracking_reference = $2, carrier = $3, updated_at = now() WHERE id = $1', [order.id, tracking, carrier]);
  await addOrderEvent(order.id, 'DISPATCHED', `Dispatched via ${carrier} (${tracking})`);
  await syncOrderFromAraf((await getOrder(reference))!);
  revalidatePath('/vendor');
  return { ok: true, message: `Dispatch confirmed for ${reference}.` };
}

export async function deliverOrder(reference: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const order = await getOrder(reference);
  if (!order || order.payment_method !== 'araf') return { ok: false, message: 'Order not found.' };
  try {
    await araf.deliver(reference, { note: 'Delivered by AltMall vendor (demo console)' });
  } catch (err) {
    return { ok: false, message: apiMessage(err) };
  }
  await addOrderEvent(order.id, 'DELIVERED', 'Delivery confirmed by vendor');
  await syncOrderFromAraf((await getOrder(reference))!);
  revalidatePath('/vendor');
  return { ok: true, message: `Delivery confirmed for ${reference}.` };
}

export async function cancelOrder(reference: string, reason: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  reason = reason.trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false, message: 'Give a reason (3–500 characters).' };
  const order = await getOrder(reference);
  if (!order || order.payment_method !== 'araf') return { ok: false, message: 'Order not found.' };
  let res: { status: string; requires_reversal: boolean };
  try {
    res = await araf.cancel(reference, reason);
  } catch (err) {
    return { ok: false, message: apiMessage(err) };
  }
  const local = res.status === 'CANCELLED' ? 'CANCELLED' : 'ON_HOLD';
  await query('UPDATE orders SET cancel_reason = $2, status = $3, release_authorized = false, updated_at = now() WHERE id = $1', [order.id, reason, local]);
  await addOrderEvent(order.id, 'CANCELLED', res.requires_reversal ? `Cancellation requested after vendor payment — the Bank will manage the reversal (${reason})` : `Order cancelled by vendor (${reason})`);
  await syncOrderFromAraf((await getOrder(reference))!);
  revalidatePath('/vendor');
  return { ok: true, message: res.requires_reversal ? 'Cancellation requested. Because the vendor was already paid, the Bank will manage a controlled reversal; release is suspended.' : `Order ${reference} cancelled.` };
}

export async function setFailureCounter(n: number): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > 20) return { ok: false, message: 'Choose between 0 and 20.' };
  await setSimulatedFailures(v);
  revalidatePath('/vendor/webhooks');
  return { ok: true, message: v ? `The next ${v} webhook deliver${v === 1 ? 'y' : 'ies'} will receive HTTP 500.` : 'Simulated failures cleared.' };
}
