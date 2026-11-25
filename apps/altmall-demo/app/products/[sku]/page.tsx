import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatNaira } from '@araf/ui';
import { PRODUCT_BY_SKU, VENDORS, categoryBySlug, illustrativeMonthlyKobo, productsIn } from '@/lib/catalogue';
import { ProductArt } from '@/components/ProductArt';
import { ProductCard } from '@/components/ProductCard';
import { PayWithArafMark } from '@/components/brand';
import { AddToCart } from './AddToCart';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ sku: string }> }): Promise<Metadata> {
  const p = PRODUCT_BY_SKU[(await params).sku];
  return { title: p?.name ?? 'Product' };
}

export default async function ProductPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const product = PRODUCT_BY_SKU[sku];
  if (!product) notFound();
  const category = categoryBySlug(product.category)!;
  const vendor = VENDORS[product.vendorReference];
  const monthly = illustrativeMonthlyKobo(product.priceKobo);
  const related = productsIn(product.category).filter((p) => p.sku !== sku);

  return (
    <div className="container-page py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-fg">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/category/${category.slug}`} className="hover:text-fg">
              {category.name}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="truncate text-fg">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex aspect-[4/3] items-center justify-center rounded-lg border border-border bg-surface p-8 sm:p-14">
          <ProductArt kind={product.art} tone={product.tone} className="h-full w-full" title={`Illustration of ${product.name}`} />
        </div>

        <div>
          <p className="eyebrow text-mall">{category.name}</p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-3xl">{product.name}</h1>
          <p className="mt-2 text-sm text-muted">
            Sold and delivered by <span className="font-medium text-fg">{vendor.name}</span> · {vendor.city} · SKU <span className="font-mono text-xs">{product.sku}</span>
          </p>
          <p className="mt-6 text-3xl font-semibold tabular-nums tracking-tight text-fg">{formatNaira(product.priceKobo)}</p>

          <div className="mt-4 rounded-lg border border-gold/40 bg-gold-soft/50 p-4">
            <PayWithArafMark size="sm" />
            <p className="mt-2 text-sm text-fg">
              or pay monthly with Pay with ARAF from <strong className="tabular-nums">≈ {formatNaira(monthly, { noKobo: true })}/month</strong> — subject to eligibility.
            </p>
            <p className="mt-1.5 text-xs text-muted">
              Indicative example only: the price divided over an illustrative 12 months, before the Bank’s profit and any contribution. It is not a quote. Your actual terms are set by The Alternative Bank and shown inside Pay with ARAF.
            </p>
          </div>

          <AddToCart sku={product.sku} vendorName={vendor.name} />

          <p className="mt-6 leading-relaxed text-muted">{product.description}</p>
          <ul className="mt-4 space-y-2">
            {product.highlights.map((h) => (
              <li key={h} className="flex gap-2 text-sm text-fg">
                <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-mall" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="mt-14 grid gap-10 lg:grid-cols-[1.15fr_1fr]" aria-labelledby="specs-h">
        <div>
          <h2 id="specs-h" className="text-xl font-semibold tracking-tight text-fg">
            Specifications
          </h2>
          <dl className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {product.specs.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(0,9rem)_1fr] gap-4 px-4 py-3 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted">{k}</dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-fg">Delivery &amp; returns</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted">
            <li>Delivered by {vendor.name} within 2–5 working days of payment (or release, for Pay with ARAF orders).</li>
            <li>With Pay with ARAF, the vendor ships only after The Alternative Bank has paid them and authorised release.</li>
            <li>7-day returns for unopened items. Manufacturer warranty as listed.</li>
          </ul>
        </div>
      </section>

      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="rel-h">
          <h2 id="rel-h" className="text-xl font-semibold tracking-tight text-fg">
            More in {category.name}
          </h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <ProductCard key={p.sku} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
