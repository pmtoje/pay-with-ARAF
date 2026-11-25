import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-page max-w-xl py-24 text-center">
      <p className="eyebrow text-mall">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">We couldn’t find that page</h1>
      <p className="mt-3 text-muted">The product or order may have moved, or the link may be mistyped.</p>
      <Link href="/" className="btn-mall mt-8">
        Back to the store
      </Link>
    </div>
  );
}
