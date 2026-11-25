import type { Metadata } from 'next';
import Link from 'next/link';
import { Verifier } from './verifier';

export const metadata: Metadata = { title: 'Webhook signature verifier' };

export default function VerifierPage() {
  return (
    <main id="main" className="max-w-[80rem] px-4 py-10 sm:px-8 lg:px-12">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gold-strong">Tools</p>
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Webhook signature verifier</h1>
      <p className="mt-3 max-w-3xl text-lg leading-8 text-muted">
        Check an <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.84em]">ARAF-Signature</code> header against a raw body and your endpoint secret, exactly as described in{' '}
        <Link href="/webhooks/signatures" className="font-medium text-gold-strong underline underline-offset-4">
          Verifying signatures
        </Link>
        .
      </p>
      <div className="mt-8">
        <Verifier />
      </div>
    </main>
  );
}
