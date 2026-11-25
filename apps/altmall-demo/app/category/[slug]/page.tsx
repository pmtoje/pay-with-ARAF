import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { VENDORS, categoryBySlug, productsIn } from '@/lib/catalogue';
import { IllustrativeNote, ProductCard } from '@/components/ProductCard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = categoryBySlug((await params).slug);
  return { title: c?.name ?? 'Department' };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = categoryBySlug(slug);
  if (!category) notFound();
  const products = productsIn(slug);
  const vendor = VENDORS[category.vendorReference];
  return (
    <div className="container-page py-10">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-fg">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-fg">
            {category.name}
          </li>
        </ol>
      </nav>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-fg">{category.name}</h1>
          <p className="mt-2 text-muted">{category.tagline}.</p>
        </div>
        <p className="text-sm text-muted">
          {products.length} products · Sold and delivered by <span className="font-medium text-fg">{vendor.name}</span>, {vendor.city}
        </p>
      </div>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <ProductCard key={p.sku} product={p} headingLevel={2} />
        ))}
      </div>
      <div className="mt-10">
        <IllustrativeNote />
      </div>
    </div>
  );
}
