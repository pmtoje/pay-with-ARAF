import Link from 'next/link';
import { Logo } from '@araf/ui';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <Logo product="Partner" />
      <h1 className="text-2xl font-semibold text-fg">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">The page you are looking for does not exist or has moved.</p>
      <Link href="/" className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-ink-contrast hover:opacity-90">
        Back to overview
      </Link>
    </main>
  );
}
