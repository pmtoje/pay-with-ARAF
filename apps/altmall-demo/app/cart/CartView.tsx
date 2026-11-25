'use client';

import Link from 'next/link';
import { Alert, EmptyState, Skeleton, formatNaira } from '@araf/ui';
import { ARAF_RULES, VENDORS } from '@/lib/catalogue';
import { useCart } from '@/components/cart';
import { ProductArt } from '@/components/ProductArt';
import { PayWithArafMark } from '@/components/brand';
import { QtyStepper } from '../products/[sku]/AddToCart';

export function arafEligibility(subtotal: number, vendorCount: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (vendorCount > 1) reasons.push('Pay with ARAF can finance items from one vendor per order.');
  if (subtotal < ARAF_RULES.minKobo) reasons.push(`Pay with ARAF is available on orders of ${formatNaira(ARAF_RULES.minKobo, { noKobo: true })} or more.`);
  if (subtotal > ARAF_RULES.maxKobo) reasons.push(`Pay with ARAF is available on orders up to ${formatNaira(ARAF_RULES.maxKobo, { noKobo: true })}.`);
  return { ok: reasons.length === 0, reasons };
}

export function CartView({ cancelledOrder }: { cancelledOrder: string | null }) {
  const cart = useCart();

  const cancelledNotice =
    cancelledOrder !== null ? (
      <Alert
        tone="warning"
        title="You left Pay with ARAF before finishing"
        className="mt-6"
        action={
          cancelledOrder ? (
            <Link href={`/orders/${cancelledOrder}`} className="btn-outline h-10 px-4 text-sm">
              View order {cancelledOrder}
            </Link>
          ) : undefined
        }
      >
        Nothing has been charged. Your order is saved — you can continue your financing application or choose another payment method from the order page.
      </Alert>
    ) : null;

  if (!cart.ready) {
    return (
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]" role="status" aria-label="Loading basket">
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <>
        {cancelledNotice}
        <div className="mt-8 rounded-lg border border-border bg-surface">
          <EmptyState
            title="Your basket is empty"
            description="Browse phones, laptops, appliances, furniture and solar — and pay with ARAF if you prefer to spread the cost."
            action={
              <Link href="/" className="btn-mall h-11 text-sm">
                Start shopping
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const elig = arafEligibility(cart.subtotalKobo, cart.vendors.length);
  const byVendor = cart.vendors.map((v) => ({ vendor: VENDORS[v], lines: cart.detailed.filter((d) => d.product.vendorReference === v) }));

  return (
    <>
      {cancelledNotice}
      {cart.vendors.length > 1 && (
        <Alert tone="warning" title="Items from more than one vendor" className="mt-6">
          Pay with ARAF requires a single vendor per order, because The Alternative Bank buys the goods from that vendor on your behalf. You can still pay by card or bank transfer, or keep one vendor’s items and order the rest separately.
          <div className="mt-3 flex flex-wrap gap-2">
            {byVendor.map(({ vendor, lines }) => (
              <button
                key={vendor.reference}
                type="button"
                className="inline-flex h-10 items-center rounded-md border border-border-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                onClick={() => cart.keepOnlyVendor(vendor.reference)}
              >
                Keep only {vendor.name} ({lines.reduce((s, l) => s + l.qty, 0)})
              </button>
            ))}
          </div>
        </Alert>
      )}
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-8">
          {byVendor.map(({ vendor, lines }) => (
            <section key={vendor.reference} aria-label={`Items from ${vendor.name}`}>
              <h2 className="text-sm font-medium text-muted">
                Sold by <span className="text-fg">{vendor.name}</span> · {vendor.city}
              </h2>
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
                {lines.map(({ product, qty, lineKobo }) => (
                  <li key={product.sku} className="flex gap-4 p-4">
                    <Link href={`/products/${product.sku}`} className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-surface-2 p-2 sm:h-28 sm:w-28" tabIndex={-1} aria-hidden="true">
                      <ProductArt kind={product.art} tone={product.tone} className="h-full w-full" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <Link href={`/products/${product.sku}`} className="font-medium leading-snug text-fg hover:underline">
                          {product.name}
                        </Link>
                        <p className="mt-1 text-sm tabular-nums text-muted">{formatNaira(product.priceKobo)} each</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end">
                        <p className="font-semibold tabular-nums text-fg sm:order-first">{formatNaira(lineKobo)}</p>
                        <QtyStepper value={qty} onChange={(v) => cart.setQty(product.sku, v)} label={`Quantity for ${product.name}`} />
                        <button type="button" onClick={() => cart.remove(product.sku)} className="h-11 rounded-md px-2 text-sm text-muted underline-offset-4 hover:text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                          Remove<span className="sr-only"> {product.name}</span>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-24" aria-labelledby="summary-h">
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 id="summary-h" className="font-semibold text-fg">
              Order summary
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Items ({cart.count})</dt>
                <dd className="tabular-nums text-fg">{formatNaira(cart.subtotalKobo)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd className="text-fg">Free</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-3 text-base">
                <dt className="font-semibold text-fg">Total</dt>
                <dd className="font-semibold tabular-nums text-fg">{formatNaira(cart.subtotalKobo)}</dd>
              </div>
            </dl>
            <Link href="/checkout" className="btn-mall mt-5 w-full">
              Continue to checkout
            </Link>
          </div>
          <div className="rounded-lg border border-border bg-surface p-5" aria-live="polite">
            <PayWithArafMark size="sm" />
            {elig.ok ? (
              <p className="mt-2 text-sm text-muted">This basket can be paid with ARAF — non-interest financing from The Alternative Bank, subject to eligibility.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-warning">
                {elig.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
