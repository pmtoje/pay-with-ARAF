import { NextResponse, type NextRequest } from 'next/server';
import { config } from '@/lib/config';
import { one, query } from '@/lib/db';
import { araf, ArafApiError } from '@/lib/araf';
import { addOrderEvent, type OrderRow } from '@/lib/orders';
import { localStatusFor } from '@/lib/statuses';
import { consumeSimulatedFailure, recordReceipt, verifySignature } from '@/lib/webhooks';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Envelope {
  event_id: string;
  event: string;
  version?: string;
  created_at?: string;
  resource_version?: number;
  data?: Record<string, unknown> & { application_reference?: string | null; merchant_order_reference?: string | null; status?: string };
}

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });

/**
 * Pay with ARAF webhook receiver.
 *  1. Verify the HMAC signature over the exact raw body (constant time, 300 s tolerance) → 400 on failure.
 *  2. De-duplicate by event_id (duplicates → 200 without reprocessing).
 *  3. Ignore out-of-order events (resource_version lower than the last one applied).
 *  4. Update the order. A release authorisation is only trusted after GET /api/v1/releases/{ref}.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const headerEventId = req.headers.get('araf-event-id');
  const verification = verifySignature(raw, req.headers.get('araf-signature'), config.arafWebhookSecret, config.webhookToleranceSeconds);
  if (!verification.ok) {
    await recordReceipt({ eventId: headerEventId?.slice(0, 80), verified: false, detail: verification.reason, httpStatus: 400, outcome: 'Rejected' });
    return json(400, { error: 'invalid_signature' });
  }

  let evt: Envelope;
  try {
    evt = JSON.parse(raw) as Envelope;
    if (!evt || typeof evt.event_id !== 'string' || typeof evt.event !== 'string') throw new Error('shape');
  } catch {
    await recordReceipt({ eventId: headerEventId, verified: true, detail: 'Signature valid', httpStatus: 400, outcome: 'Malformed payload' });
    return json(400, { error: 'malformed_payload' });
  }
  if (headerEventId && headerEventId !== evt.event_id) {
    await recordReceipt({ eventId: headerEventId, type: evt.event, verified: false, detail: 'ARAF-Event-Id does not match payload', httpStatus: 400, outcome: 'Rejected' });
    return json(400, { error: 'event_id_mismatch' });
  }
  const orderRef = evt.data?.merchant_order_reference ?? null;
  const base = { eventId: evt.event_id, type: evt.event, orderRef, verified: true, detail: 'Signature valid' };

  // Demo control: simulate an unavailable endpoint so ARAF's retry schedule can be observed.
  if (await consumeSimulatedFailure()) {
    await recordReceipt({ ...base, httpStatus: 500, outcome: 'Simulated endpoint failure (ARAF will retry)' });
    return json(500, { error: 'simulated_failure' });
  }

  const inserted = await one<{ event_id: string }>(
    `INSERT INTO webhook_events (event_id, type, merchant_order_reference, resource_version, raw) VALUES ($1,$2,$3,$4,$5::jsonb)
     ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [evt.event_id, evt.event, orderRef, typeof evt.resource_version === 'number' ? evt.resource_version : null, raw],
  );
  if (!inserted) {
    await recordReceipt({ ...base, httpStatus: 200, outcome: 'Duplicate — already received, not reprocessed' });
    return json(200, { received: true, duplicate: true });
  }

  let outcome: string;
  try {
    outcome = await processEvent(evt);
  } catch (err) {
    // Processing failed after storage: un-store so the retried delivery is processed again.
    await query('DELETE FROM webhook_events WHERE event_id = $1', [evt.event_id]);
    console.error('[altmall] webhook processing failed', evt.event_id, (err as Error).message);
    await recordReceipt({ ...base, httpStatus: 500, outcome: `Processing error — will be retried` });
    return json(500, { error: 'processing_failed' });
  }
  await query('UPDATE webhook_events SET processed = true, outcome = $2 WHERE event_id = $1', [evt.event_id, outcome]);
  await recordReceipt({ ...base, httpStatus: 200, outcome });
  return json(200, { received: true });
}

async function processEvent(evt: Envelope): Promise<string> {
  const data = evt.data ?? {};
  const ref = data.merchant_order_reference;
  if (!ref) return 'Ignored — no order reference';
  const order = await one<OrderRow>('SELECT * FROM orders WHERE reference = $1', [ref]);
  if (!order) return 'Ignored — unknown order';

  const appRef = data.application_reference ?? null;
  if (appRef && order.araf_application_reference && appRef !== order.araf_application_reference) return `Ignored — event for superseded application ${appRef}`;
  const version = typeof evt.resource_version === 'number' ? evt.resource_version : null;
  if (version !== null && version < order.last_event_version) return `Ignored — out of order (v${version} < v${order.last_event_version})`;

  const status = typeof data.status === 'string' ? data.status : order.araf_status;
  const sets: string[] = ['araf_status = $2', 'last_event_version = GREATEST(last_event_version, $3)', 'araf_application_reference = COALESCE(araf_application_reference, $4)', 'updated_at = now()'];
  const params: unknown[] = [order.id, status, version ?? order.last_event_version, appRef];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    sets.push(sql.replace('?', `$${params.length}`));
  };
  let note = `Applied — status ${status ?? 'unchanged'}`;

  switch (evt.event) {
    case 'goods.release_authorized': {
      const releaseRef = typeof data.release_reference === 'string' ? data.release_reference : null;
      if (!releaseRef) return 'Ignored — release reference missing';
      // Never trust the webhook alone: confirm with the API before allowing dispatch.
      let release;
      try {
        release = await araf.getRelease(releaseRef);
      } catch (err) {
        // 404 = the API does not know this release: never authorise. Other errors → retry later.
        if (err instanceof ArafApiError && err.status === 404) {
          await addOrderEvent(order.id, 'WEBHOOK', `${evt.event} — release ${releaseRef} not found via API; ignored`);
          return `Release ${releaseRef} NOT found via API — not authorised`;
        }
        throw err;
      }
      add('araf_release_reference = ?', releaseRef);
      add('araf_release_status = ?', release.status);
      add('release_authorized = ?', release.release_authorized);
      note = release.release_authorized ? `Release ${releaseRef} confirmed via API — dispatch allowed` : `Release ${releaseRef} NOT confirmed by API (status ${release.status})`;
      break;
    }
    case 'goods.release_suspended': {
      add('release_authorized = ?', false);
      add('araf_release_status = ?', 'SUSPENDED');
      if (typeof data.release_reference === 'string') add('araf_release_reference = ?', data.release_reference);
      note = 'Release suspended — dispatch blocked';
      break;
    }
    case 'goods.dispatched': {
      add('release_authorized = ?', false);
      if (typeof data.tracking_reference === 'string') add('tracking_reference = COALESCE(tracking_reference, ?)', data.tracking_reference);
      if (typeof data.carrier === 'string') add('carrier = COALESCE(carrier, ?)', data.carrier);
      break;
    }
    default:
      break;
  }
  if (status && order.payment_method === 'araf' && !order.cancel_reason) add('status = ?', localStatusFor(status));
  await query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $1`, params);
  await addOrderEvent(order.id, 'WEBHOOK', `${evt.event}${status ? ` → ${status}` : ''}`);
  return note;
}
