import Link from 'next/link';
import { Logo } from '@araf/ui';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Logo product="Bank admin" />
      <h1 className="mt-10 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page you requested does not exist or has moved.</p>
      <Link href="/" className="mt-6 inline-flex h-10 w-fit items-center rounded-md bg-ink px-4 text-sm font-medium text-ink-contrast hover:opacity-90">Back to the portal</Link>
    </main>
  );
}
