import Link from 'next/link';
import { formatNaira } from '@araf/ui';
import { CATEGORIES, VENDORS, illustrativeMonthlyKobo, type Product } from '@/lib/catalogue';
import { ProductArt } from './ProductArt';

export function ProductCard({ product, headingLevel = 3 }: { product: Product; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const cat = CATEGORIES.find((c) => c.slug === product.category);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong">
      <div className="flex aspect-[4/3] items-center justify-center bg-surface-2/60 p-6">
        <ProductArt kind={product.art} tone={product.tone} className="h-full w-full max-w-[260px] transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 border-t border-border p-4">
        <p className="text-2xs font-medium uppercase tracking-[0.12em] text-subtle">{cat?.name}</p>
        <H className="text-[15px] font-medium leading-snug text-fg">
          <Link href={`/products/${product.sku}`} className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-focus">
            {product.name}
          </Link>
        </H>
        <p className="text-xs text-muted">Sold by {VENDORS[product.vendorReference].name}</p>
        <div className="mt-auto pt-3">
          <p className="text-lg font-semibold tabular-nums tracking-tight text-fg">{formatNaira(product.priceKobo, { noKobo: true })}</p>
          <p className="text-xs text-muted">
            or from ≈ <span className="font-medium tabular-nums text-gold-strong">{formatNaira(illustrativeMonthlyKobo(product.priceKobo), { noKobo: true })}/mo</span> with Pay with ARAF<sup aria-hidden="true">*</sup>
            <span className="sr-only"> (illustrative, subject to eligibility)</span>
          </p>
        </div>
      </div>
    </article>
  );
}

export function IllustrativeNote() {
  return (
    <p className="text-xs text-subtle">
      * Illustrative example only: price divided over 12 months, before the Bank’s profit and any contribution. Not a quote or an offer of credit. Pay with ARAF financing is provided by The Alternative Bank, subject to eligibility; your actual terms are shown inside Pay with ARAF.
    </p>
  );
}
