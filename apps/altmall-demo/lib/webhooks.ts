import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { one, query } from './db';

/**
 * Pay with ARAF webhook signature verification, implemented independently with node:crypto
 * (exactly as any external merchant would, from the published scheme):
 *
 *   ARAF-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>[,v1=<…>]
 */
export type Verification = { ok: true; timestamp: number } | { ok: false; reason: string };

export function verifySignature(rawBody: string, header: string | null, secret: string, toleranceSeconds: number, now = Math.floor(Date.now() / 1000)): Verification {
  if (!secret) return { ok: false, reason: 'Webhook secret not configured' };
  if (!header) return { ok: false, reason: 'Missing ARAF-Signature header' };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === null || v1.length === 0) return { ok: false, reason: 'Malformed ARAF-Signature header' };
  if (Math.abs(now - t) > toleranceSeconds) return { ok: false, reason: `Timestamp outside ${toleranceSeconds}s tolerance` };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
  const match = v1.some((sig) => {
    const b = Buffer.from(sig, 'hex');
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
  return match ? { ok: true, timestamp: t } : { ok: false, reason: 'Signature mismatch' };
}

export async function recordReceipt(r: { eventId?: string | null; type?: string | null; orderRef?: string | null; verified: boolean; detail: string; httpStatus: number; outcome: string }) {
  await query(
    'INSERT INTO webhook_receipts (event_id, type, merchant_order_reference, verified, verification_detail, http_status, outcome) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [r.eventId ?? null, r.type ?? null, r.orderRef ?? null, r.verified, r.detail, r.httpStatus, r.outcome],
  ).catch((err) => console.error('[altmall] could not record webhook receipt', (err as Error).message));
}

/** Atomically consume one "simulated failure" credit. */
export async function consumeSimulatedFailure(): Promise<boolean> {
  const row = await one<{ value: number }>(
    `UPDATE settings SET value = to_jsonb((value #>> '{}')::int - 1) WHERE key = 'webhook_fail_remaining' AND (value #>> '{}')::int > 0 RETURNING value`,
  );
  return !!row;
}

export async function getSimulatedFailures(): Promise<number> {
  const row = await one<{ n: number }>(`SELECT (value #>> '{}')::int AS n FROM settings WHERE key = 'webhook_fail_remaining'`);
  return row?.n ?? 0;
}

export async function setSimulatedFailures(n: number): Promise<void> {
  await query(`INSERT INTO settings (key, value) VALUES ('webhook_fail_remaining', to_jsonb($1::int)) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [n]);
}
