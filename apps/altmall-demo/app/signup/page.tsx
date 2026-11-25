import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentCustomer, safeNext } from '@/lib/auth';
import { SignupForm } from '../login/AuthForms';

export const metadata: Metadata = { title: 'Create an account' };
export const dynamic = 'force-dynamic';

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  return (
    <div className="container-page max-w-md py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">Create your AltMall account</h1>
      <p className="mt-2 text-muted">It takes a minute. Your password is stored as a salted scrypt hash.</p>
      <div className="mt-8">
        <SignupForm next={next} />
      </div>
    </div>
  );
}
