import Link from 'next/link';
import { CATEGORIES, PRODUCTS, productsIn } from '@/lib/catalogue';
import { ProductArt } from '@/components/ProductArt';
import { IllustrativeNote, ProductCard } from '@/components/ProductCard';
import { PayWithArafMark } from '@/components/brand';

const STEPS = [
  { title: 'Choose Pay with ARAF at checkout', body: 'Fill your basket from one vendor and pick Pay with ARAF as your payment method.' },
  { title: 'Check your eligibility', body: 'On The Alternative Bank’s secure page, verify your identity and see if you qualify — usually in minutes.' },
  { title: 'The Bank buys, then sells to you', body: 'Under Murabaha, the Bank purchases your item from the vendor and sells it to you at a disclosed price. No interest.' },
  { title: 'Goods released, pay monthly', body: 'The vendor only releases your item once the Bank has paid. You repay in fixed monthly instalments.' },
];

export default function HomePage() {
  const featured = PRODUCTS.filter((p) => p.featured);
  return (
    <>
      {/* Hero */}
      <section className="border-b border-border bg-surface">
        <div className="container-page grid items-center gap-10 py-12 md:grid-cols-[1.1fr_1fr] md:py-20">
          <div>
            <p className="eyebrow text-mall">Electronics · Home · Solar</p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-[3.5rem]">
              Bring home what you need.
              <br />
              <span className="text-muted">Pay for it over time.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Phones, laptops, appliances, furniture and solar power from trusted Nigerian vendors — with the option of non-interest financing through Pay with ARAF.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/category/solar" className="btn-mall">
                Shop solar power
              </Link>
              <Link href="#how-it-works" className="btn-outline">
                How Pay with ARAF works
              </Link>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-border pt-6 text-sm">
              <div>
                <dt className="text-subtle">Vendors</dt>
                <dd className="mt-1 font-semibold text-fg">4 verified</dd>
              </div>
              <div>
                <dt className="text-subtle">Delivery</dt>
                <dd className="mt-1 font-semibold text-fg">Lagos · Abuja · Kano</dd>
              </div>
              <div>
                <dt className="text-subtle">Financing</dt>
                <dd className="mt-1 font-semibold text-fg">₦20k – ₦5m</dd>
              </div>
            </dl>
          </div>
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {(
              [
                ['tv', 0, 'col-span-2 aspect-[2/1]'],
                ['phone', 1, 'aspect-square'],
                ['fridge', 2, 'aspect-square'],
              ] as const
            ).map(([kind, tone, cls]) => (
              <div key={kind} className={`flex items-center justify-center rounded-lg border border-border bg-bg p-5 ${cls}`}>
                <ProductArt kind={kind} tone={tone} className="h-full w-full" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Departments */}
      <section className="container-page py-14" aria-labelledby="dept-h">
        <div className="flex items-end justify-between gap-4">
          <h2 id="dept-h" className="text-2xl font-semibold tracking-tight text-fg">
            Shop by department
          </h2>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {CATEGORIES.map((c, i) => (
            <li key={c.slug}>
              <Link
                href={`/category/${c.slug}`}
                className="group flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <ProductArt kind={c.art} tone={(i % 3) as 0 | 1 | 2} className="mx-auto h-20 w-full" />
                <span className="mt-3 text-sm font-medium text-fg">{c.name}</span>
                <span className="text-xs text-muted">{productsIn(c.slug).length} products</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Featured */}
      <section className="container-page pb-6" aria-labelledby="feat-h">
        <h2 id="feat-h" className="text-2xl font-semibold tracking-tight text-fg">
          Featured this week
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((p) => (
            <ProductCard key={p.sku} product={p} />
          ))}
        </div>
      </section>

      {/* Explainer */}
      <section id="how-it-works" className="mt-14 scroll-mt-24 border-y border-border bg-surface" aria-labelledby="how-h">
        <div className="container-page grid gap-10 py-14 lg:grid-cols-[1fr_2fr]">
          <div>
            <PayWithArafMark />
            <h2 id="how-h" className="mt-4 text-3xl font-semibold tracking-tight text-fg">
              Buy now, pay with ARAF
            </h2>
            <p className="mt-3 text-muted">
              Pay with ARAF is non-interest asset financing from The Alternative Bank, embedded in AltMall’s checkout. AltMall never sees your credit details — we only learn whether your order is approved and when it can be released.
            </p>
            <p className="mt-4 text-sm text-subtle">Available on orders from ₦20,000 to ₦5,000,000, from one vendor per order. Subject to eligibility.</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-lg border border-border bg-bg p-5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gold-soft text-sm font-semibold text-gold-strong">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-fg">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="container-page pt-8">
        <IllustrativeNote />
      </div>
    </>
  );
}
