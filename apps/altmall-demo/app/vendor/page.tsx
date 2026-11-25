import Link from 'next/link';
import type { Metadata } from 'next';
import { Badge, EmptyState, formatDateTime, formatNaira } from '@araf/ui';
import { cn } from '@/lib/cn';
import { requireVendor } from '@/lib/auth';
import { query } from '@/lib/db';
import { syncOrderFromAraf, type OrderRow } from '@/lib/orders';
import { VENDORS } from '@/lib/catalogue';
import { statusCopy, TERMINAL_NEGATIVE } from '@/lib/statuses';
import { VendorNav } from './VendorNav';
import { OrderRowActions } from './VendorActions';

export const metadata: Metadata = { title: 'Vendor console' };
export const dynamic = 'force-dynamic';

type Row = OrderRow & { email: string; items: Array<{ name: string; qty: number; vendor_reference: string }> };

const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready to ship' },
  { id: 'waiting', label: 'Awaiting the Bank' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'closed', label: 'Closed' },
] as const;

function viewOf(o: OrderRow): string {
  if (o.release_authorized) return 'ready';
  if (o.araf_status === 'DISPATCHED') return 'shipped';
  if (o.cancel_reason || !o.araf_status || TERMINAL_NEGATIVE.includes(o.araf_status) || ['DELIVERED', 'COMPLETED'].includes(o.araf_status) || o.payment_method !== 'araf') return 'closed';
  return 'waiting';
}

export default async function VendorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireVendor();
  const view = (await searchParams).view ?? 'all';
  const base = await query<Row>(
    `SELECT o.*, c.email,
       (SELECT json_agg(json_build_object('name', i.name, 'qty', i.qty, 'vendor_reference', i.vendor_reference) ORDER BY i.id) FROM order_items i WHERE i.order_id = o.id) AS items
     FROM orders o JOIN customers c ON c.id = o.customer_id
     WHERE o.araf_application_reference IS NOT NULL
     ORDER BY o.created_at DESC LIMIT 100`,
  );
  // Refresh live orders from the API so "release authorised" is verified, not assumed.
  const live = base.filter((o) => o.payment_method === 'araf' && !o.cancel_reason && !(o.araf_status && (TERMINAL_NEGATIVE.includes(o.araf_status) || o.araf_status === 'COMPLETED'))).slice(0, 25);
  const synced = new Map<string, { order: OrderRow; error: string | null }>();
  await Promise.all(live.map(async (o) => synced.set(o.id, await syncOrderFromAraf(o))));
  const rows: Array<Row & { syncError: string | null }> = base.map((o) => {
    const s = synced.get(o.id);
    return { ...o, ...(s?.order ?? {}), email: o.email, items: o.items, syncError: s?.error ?? null };
  });
  const counts = Object.fromEntries(VIEWS.map((v) => [v.id, v.id === 'all' ? rows.length : rows.filter((r) => viewOf(r) === v.id).length]));
  const shown = view === 'all' ? rows : rows.filter((r) => viewOf(r) === view);

  return (
    <>
      <VendorNav active="orders" />
      <div className="container-page py-8">
        <section aria-labelledby="rule-h" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="rule-h" className="font-semibold text-fg">
            The vendor gets paid before goods are released
          </h2>
          <ol className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
            {[
              ['Approved', 'Financing approval is not permission to ship.'],
              ['Vendor paid', 'The Bank pays the vendor and confirms the payment.'],
              ['Release authorised', 'Pay with ARAF authorises release — verified here via GET /api/v1/releases.'],
              ['Dispatch & deliver', 'Only now can you confirm dispatch, then delivery.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mall-soft text-xs font-semibold text-mall">{i + 1}</span>
                <span>
                  <span className="block font-medium text-fg">{t}</span>
                  <span className="block text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <nav aria-label="Filter orders" className="mt-8 flex gap-1 overflow-x-auto">
          {VIEWS.map((v) => (
            <Link
              key={v.id}
              href={v.id === 'all' ? '/vendor' : `/vendor?view=${v.id}`}
              aria-current={view === v.id ? 'page' : undefined}
              className={cn('inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', view === v.id ? 'bg-ink text-ink-contrast' : 'text-muted hover:bg-surface-2 hover:text-fg')}
            >
              {v.label}
              <span className="tabular-nums opacity-70">{counts[v.id]}</span>
            </Link>
          ))}
        </nav>

        {shown.length === 0 ? (
          <div className="mt-4 rounded-lg border border-border bg-surface">
            <EmptyState
              title={rows.length === 0 ? 'No Pay with ARAF orders yet' : 'Nothing in this view'}
              description={rows.length === 0 ? 'When a shopper checks out with Pay with ARAF, the order appears here.' : 'Try another filter.'}
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {shown.map((o) => {
              const c = statusCopy(o.araf_status);
              const vendor = VENDORS[o.items?.[0]?.vendor_reference ?? ''];
              return (
                <li key={o.id} className="rounded-lg border border-border bg-surface">
                  <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.3fr_1.2fr_auto] lg:items-start">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-fg">{o.reference}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatNaira(Number(o.amount_kobo))} · {o.email}
                      </p>
                      <p className="mt-1 truncate text-sm text-fg">{(o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
                      <p className="mt-1 text-xs text-subtle">
                        {vendor?.name ?? o.items?.[0]?.vendor_reference} · placed {formatDateTime(o.created_at)} · app {o.araf_application_reference}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={c.tone}>{o.araf_status ? c.label : 'Unknown'}</Badge>
                        {o.release_authorized ? (
                          <Badge tone="success">Release authorised · verified via API</Badge>
                        ) : o.araf_release_status === 'SUSPENDED' ? (
                          <Badge tone="danger">Release suspended</Badge>
                        ) : o.araf_release_status === 'CONSUMED' ? (
                          <Badge tone="neutral">Release used (dispatched)</Badge>
                        ) : (
                          <Badge tone="neutral">Release not authorised</Badge>
                        )}
                        {o.payment_method !== 'araf' && <Badge tone="neutral">Paid another way</Badge>}
                      </div>
                      <p className="text-sm text-muted">{o.cancel_reason ? `Cancelled by vendor: ${o.cancel_reason}` : c.vendor}</p>
                      {o.tracking_reference && (
                        <p className="text-xs text-muted">
                          Tracking <span className="font-mono">{o.tracking_reference}</span>
                          {o.carrier ? ` · ${o.carrier}` : ''}
                        </p>
                      )}
                      {o.syncError && <p className="text-xs text-warning">Couldn’t refresh from Pay with ARAF: {o.syncError}</p>}
                      <p className="text-2xs text-subtle">{o.araf_last_synced_at ? `Checked with Pay with ARAF ${formatDateTime(o.araf_last_synced_at)}` : 'Not yet checked with Pay with ARAF'}</p>
                    </div>
                    <OrderRowActions
                      reference={o.reference}
                      canDispatch={o.release_authorized && o.payment_method === 'araf'}
                      canDeliver={o.araf_status === 'DISPATCHED' && o.payment_method === 'araf'}
                      canCancel={o.payment_method === 'araf' && !o.cancel_reason && !!o.araf_status && !TERMINAL_NEGATIVE.includes(o.araf_status) && !['DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(o.araf_status)}
                      blockedReason={!o.release_authorized && o.payment_method === 'araf' && o.araf_status && !['DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(o.araf_status) && !TERMINAL_NEGATIVE.includes(o.araf_status) ? 'Can’t ship yet: Pay with ARAF hasn’t authorised release. The Bank must pay the vendor first.' : null}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
