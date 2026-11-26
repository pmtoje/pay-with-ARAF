import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Alert, Badge, Skeleton, Spinner, formatDateTime, formatNaira } from '@araf/ui';
import { requireCustomer } from '@/lib/auth';
import { getOrderForCustomer, orderItems, type OrderRow } from '@/lib/orders';
import { PRODUCT_BY_SKU, VENDORS } from '@/lib/catalogue';
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/statuses';
import { ProductArt } from '@/components/ProductArt';
import { ArafStatusPanel } from './ArafStatusPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ reference: string }> }): Promise<Metadata> {
  return { title: `Order ${(await params).reference}` };
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ reference: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { reference } = await params;
  const sp = await searchParams;
  const customer = await requireCustomer(`/orders/${reference}`);
  const order = await getOrderForCustomer(reference, customer.id);
  if (!order) notFound();
  const items = await orderItems(order.id);
  const local = ORDER_STATUS_LABEL[order.status] ?? { label: order.status, tone: 'neutral' as const };
  const fromAraf = sp.from === 'araf';

  return (
    <div className="container-page max-w-5xl py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/orders" className="hover:text-fg">
          ← My orders
        </Link>
      </nav>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-mall">Order</p>
          <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{order.reference}</h1>
          <p className="mt-1 text-sm text-muted">
            Placed {formatDateTime(order.created_at)} · {PAYMENT_METHOD_LABEL[order.payment_method] ?? order.payment_method}
          </p>
        </div>
        <Badge tone={local.tone}>{local.label}</Badge>
      </div>

      {sp.placed === '1' && order.payment_method !== 'araf' && (
        <Alert tone="success" title="Thank you — your order is confirmed" className="mt-6">
          This was a demo payment, so nothing was charged. {VENDORS[items[0]?.vendor_reference]?.name ?? 'The vendor'} will prepare your order.
        </Alert>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {order.araf_application_reference || order.payment_method === 'araf' ? (
            <Suspense fallback={<ConfirmingPanel />}>
              <ArafStatusPanel order={order} fromAraf={fromAraf} autoOpen={sp.pay === 'araf'} />
            </Suspense>
          ) : (
            <DemoPaymentPanel order={order} />
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="items-h">
            <h2 id="items-h" className="font-semibold text-fg">
              Items
            </h2>
            <ul className="mt-4 space-y-3">
              {items.map((i) => {
                const p = PRODUCT_BY_SKU[i.sku];
                return (
                  <li key={i.sku} className="flex items-center gap-3">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-surface-2 p-1.5" aria-hidden="true">
                      {p && <ProductArt kind={p.art} tone={p.tone} className="h-full w-full" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-snug text-fg">{i.name}</span>
                      <span className="block text-xs text-muted">
                        Qty {i.qty} · {formatNaira(Number(i.unit_kobo))} each
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex justify-between border-t border-border pt-3">
              <span className="font-semibold text-fg">Total</span>
              <span className="font-semibold tabular-nums text-fg">{formatNaira(Number(order.amount_kobo))}</span>
            </div>
            <p className="mt-2 text-xs text-muted">Sold by {VENDORS[items[0]?.vendor_reference]?.name ?? items[0]?.vendor_reference}</p>
          </section>
          <section className="rounded-lg border border-border bg-surface p-5" aria-labelledby="del-h">
            <h2 id="del-h" className="font-semibold text-fg">
              Delivery
            </h2>
            <address className="mt-3 text-sm not-italic leading-relaxed text-muted">
              <span className="text-fg">{order.delivery_name}</span>
              <br />
              {order.delivery_address}
              <br />
              {order.delivery_city}, {order.delivery_state}
              <br />
              {order.delivery_phone}
            </address>
            {order.tracking_reference && (
              <p className="mt-3 text-sm text-fg">
                Tracking: <span className="font-mono text-[13px]">{order.tracking_reference}</span>
                {order.carrier ? ` · ${order.carrier}` : ''}
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function ConfirmingPanel() {
  return (
    <section className="rounded-lg border border-border bg-surface p-6" aria-busy="true">
      <div role="status" aria-live="polite" className="flex items-center gap-3">
        <Spinner className="h-5 w-5 text-gold" />
        <p className="font-medium text-fg">We’re confirming your financing status with Pay with ARAF…</p>
      </div>
      <p className="mt-2 text-sm text-muted">We check directly with Pay with ARAF rather than relying on the browser redirect.</p>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </section>
  );
}

function DemoPaymentPanel({ order }: { order: OrderRow }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6" aria-labelledby="pay-h">
      <h2 id="pay-h" className="text-lg font-semibold text-fg">
        {order.status === 'PAID' ? 'Paid — preparing your order' : (ORDER_STATUS_LABEL[order.status]?.label ?? order.status)}
      </h2>
      <p className="mt-2 text-sm text-muted">
        Paid by {PAYMENT_METHOD_LABEL[order.payment_method]}. This is a simulated payment in the demo store, so no money moved. The vendor fulfilment console only handles Pay with ARAF orders in this demo.
      </p>
    </section>
  );
}
