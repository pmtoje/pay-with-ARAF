import Link from 'next/link';
import type { Metadata } from 'next';
import { Badge, EmptyState, formatDate, formatNaira } from '@araf/ui';
import { requireCustomer } from '@/lib/auth';
import { listCustomerOrders } from '@/lib/orders';
import { PRODUCT_BY_SKU } from '@/lib/catalogue';
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, statusCopy } from '@/lib/statuses';
import { ProductArt } from '@/components/ProductArt';

export const metadata: Metadata = { title: 'My orders' };
export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const customer = await requireCustomer('/orders');
  const orders = await listCustomerOrders(customer.id);
  return (
    <div className="container-page max-w-4xl py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">My orders</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {customer.email}</p>
      {orders.length === 0 ? (
        <div className="mt-8 rounded-lg border border-border bg-surface">
          <EmptyState
            title="No orders yet"
            description="When you place an order it will appear here, with live Pay with ARAF status where relevant."
            action={
              <Link href="/" className="btn-mall h-11 text-sm">
                Start shopping
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-surface">
          {orders.map((o) => {
            const local = ORDER_STATUS_LABEL[o.status] ?? { label: o.status, tone: 'neutral' as const };
            const p = PRODUCT_BY_SKU[o.first_sku];
            return (
              <li key={o.id} className="relative flex items-center gap-4 p-4 hover:bg-surface-2/50">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-surface-2 p-1.5" aria-hidden="true">
                  {p && <ProductArt kind={p.art} tone={p.tone} className="h-full w-full" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-fg">
                    <Link href={`/orders/${o.reference}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus">
                      {o.reference}
                    </Link>
                  </p>
                  <p className="truncate text-sm text-muted">
                    {o.first_name}
                    {o.item_count > 1 ? ` + ${o.item_count - 1} more` : ''}
                  </p>
                  <p className="text-xs text-subtle">
                    {formatDate(o.created_at)} · {PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method}
                    {o.payment_method === 'araf' && o.araf_status ? ` · ${statusCopy(o.araf_status).label}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-semibold tabular-nums text-fg">{formatNaira(Number(o.amount_kobo))}</span>
                  <Badge tone={local.tone === 'gold' ? 'gold' : local.tone}>{local.label}</Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
