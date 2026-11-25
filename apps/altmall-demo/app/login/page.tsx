import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentCustomer, safeNext } from '@/lib/auth';
import { DEMO_CUSTOMER } from '@/lib/db';
import { LoginForm } from './AuthForms';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  return (
    <div className="container-page grid max-w-5xl gap-10 py-12 md:grid-cols-[1fr_340px]">
      <div className="max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Sign in</h1>
        <p className="mt-2 text-muted">Sign in to check out and track your orders.</p>
        <div className="mt-8">
          <LoginForm next={next} />
        </div>
      </div>
      <aside className="h-fit rounded-lg border border-dashed border-warning/50 bg-warning-soft/40 p-5" aria-labelledby="demo-h">
        <p id="demo-h" className="eyebrow text-warning">
          Sandbox demo credentials
        </p>
        <p className="mt-2 text-sm text-muted">This is a demonstration store. Use this synthetic shopper account, or create your own.</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-subtle">Email</dt>
            <dd className="font-mono text-[13px] text-fg">{DEMO_CUSTOMER.email}</dd>
          </div>
          <div>
            <dt className="text-subtle">Password</dt>
            <dd className="font-mono text-[13px] text-fg">{DEMO_CUSTOMER.password}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
