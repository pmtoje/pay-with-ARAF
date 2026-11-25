import type { Metadata } from 'next';
import { Explorer } from './explorer';

export const metadata: Metadata = { title: 'API explorer' };

export default function ExplorerPage() {
  return (
    <main id="main" className="max-w-[80rem] px-4 py-10 sm:px-8 lg:px-12">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gold-strong">Tools · Sandbox only</p>
      <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">API explorer</h1>
      <p className="mt-3 max-w-3xl text-lg leading-8 text-muted">Send real requests to the sandbox partner API with your test key. Requests go through this site’s same-origin proxy to <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.84em]">/api/v1</code>.</p>
      <div className="mt-8">
        <Explorer />
      </div>
    </main>
  );
}
