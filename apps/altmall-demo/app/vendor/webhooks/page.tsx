import Link from 'next/link';
import type { Metadata } from 'next';
import { Badge, EmptyState, formatDateTime } from '@araf/ui';
import { requireVendor } from '@/lib/auth';
import { query } from '@/lib/db';
import { getSimulatedFailures } from '@/lib/webhooks';
import { statusCopy } from '@/lib/statuses';
import { VendorNav } from '../VendorNav';
import { FailureSimulator, RefreshOrderButton } from '../VendorActions';
import { AutoRefreshLog } from './AutoRefreshLog';

export const metadata: Metadata = { title: 'Webhook log' };
export const dynamic = 'force-dynamic';

interface Receipt {
  id: string;
  received_at: Date;
  event_id: string | null;
  type: string | null;
  merchant_order_reference: string | null;
  verified: boolean;
  verification_detail: string;
  http_status: number;
  outcome: string;
}

export default async function WebhookLogPage() {
  await requireVendor();
  const [receipts, failures, orders, stats] = await Promise.all([
    query<Receipt>('SELECT id::text AS id, received_at, event_id, type, merchant_order_reference, verified, verification_detail, http_status, outcome FROM webhook_receipts ORDER BY received_at DESC, id DESC LIMIT 150'),
    getSimulatedFailures(),
    query<{ reference: string; araf_status: string | null; release_authorized: boolean; last_event_version: number; araf_last_synced_at: Date | null }>(
      `SELECT reference, araf_status, release_authorized, last_event_version, araf_last_synced_at FROM orders WHERE araf_application_reference IS NOT NULL ORDER BY created_at DESC LIMIT 12`,
    ),
    query<{ total: number; verified: number; rejected: number; dupes: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE verified)::int AS verified, count(*) FILTER (WHERE NOT verified)::int AS rejected, count(*) FILTER (WHERE outcome LIKE 'Duplicate%')::int AS dupes FROM webhook_receipts`,
    ),
  ]);
  const s = stats[0];

  return (
    <>
      <VendorNav active="webhooks" />
      <div className="container-page space-y-8 py-8">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="recv-h">
            <h2 id="recv-h" className="font-semibold text-fg">
              Receiver
            </h2>
            <p className="mt-1 text-sm text-muted">
              <code className="font-mono text-xs text-fg">POST /api/araf/webhooks</code> verifies <code className="font-mono text-xs">ARAF-Signature</code> (HMAC-SHA256 over <code className="font-mono text-xs">t.rawBody</code>, constant-time, 300 s tolerance), de-duplicates by event ID, ignores out-of-order versions and confirms release authorisations with the API before trusting them.
            </p>
            <dl className="mt-4 grid grid-cols-4 gap-3 text-center">
              {[
                ['Received', s?.total ?? 0],
                ['Verified', s?.verified ?? 0],
                ['Rejected', s?.rejected ?? 0],
                ['Duplicates', s?.dupes ?? 0],
              ].map(([l, v]) => (
                <div key={l} className="rounded-md bg-surface-2 px-2 py-3">
                  <dt className="text-2xs uppercase tracking-wide text-subtle">{l}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="sim-h">
            <h2 id="sim-h" className="font-semibold text-fg">
              Retry demonstration
            </h2>
            <p className="mt-1 text-sm text-muted">
              Make the receiver return <strong className="font-medium text-fg">HTTP 500</strong> for the next N deliveries. Pay with ARAF will retry with exponential back-off; the retried delivery carries the same event ID.
            </p>
            {failures > 0 && (
              <p className="mt-3 text-sm font-medium text-warning" role="status">
                Failing the next {failures} deliver{failures === 1 ? 'y' : 'ies'}.
              </p>
            )}
            <div className="mt-4">
              <FailureSimulator current={failures} />
            </div>
          </section>
        </div>

        <section aria-labelledby="ord-h">
          <h2 id="ord-h" className="font-semibold text-fg">
            Order status
          </h2>
          {orders.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No Pay with ARAF orders yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
              {orders.map((o) => (
                <li key={o.reference} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-fg">{o.reference}</p>
                    <p className="text-xs text-muted">
                      {statusCopy(o.araf_status).label} · last event v{o.last_event_version < 0 ? '—' : o.last_event_version}
                      {o.release_authorized ? ' · release authorised' : ''} · checked {o.araf_last_synced_at ? formatDateTime(o.araf_last_synced_at) : 'never'}
                    </p>
                  </div>
                  <RefreshOrderButton reference={o.reference} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="log-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="log-h" className="font-semibold text-fg">
              Received events
            </h2>
            <AutoRefreshLog />
          </div>
          {receipts.length === 0 ? (
            <div className="mt-3 rounded-lg border border-border bg-surface">
              <EmptyState title="No webhooks received yet" description="Start a Pay with ARAF checkout from the store — application.created is delivered within seconds." />
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <caption className="sr-only">Webhook deliveries received by AltMall, newest first</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Received</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Event</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Order</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Signature</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Response</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.id} className="border-b border-border align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(r.received_at)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-fg">{r.type ?? '—'}</p>
                        <p className="font-mono text-2xs text-subtle">{r.event_id ?? 'no event id'}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fg">{r.merchant_order_reference ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge tone={r.verified ? 'success' : 'danger'}>{r.verified ? 'Verified' : 'Rejected'}</Badge>
                        {!r.verified && <p className="mt-1 text-xs text-muted">{r.verification_detail}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={r.http_status >= 500 ? 'warning' : r.http_status >= 400 ? 'danger' : 'neutral'}>{r.http_status}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{r.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-subtle">
            Back to{' '}
            <Link href="/vendor" className="link">
              orders
            </Link>
            .
          </p>
        </section>
      </div>
    </>
  );
}
