import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-strong">404</p>
      <h1 className="mt-2 text-3xl font-semibold text-fg">Page not found</h1>
      <p className="mt-3 text-muted">This documentation page does not exist or has moved.</p>
      <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-ink-contrast hover:opacity-90">
        Back to the docs
      </Link>
    </main>
  );
}
