'use client';

import type { ReactNode } from 'react';
import { Button, Logo, Skeleton } from '@araf/ui';
import { SessionProvider } from '@/lib/session';
import { AdminShell } from '@/components/shell';
import { ErrorAlert } from '@/components/common';

function ShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-bg" role="status" aria-label="Loading your workspace">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <div className="flex h-16 items-center border-b border-border px-5"><Logo product="Bank admin" /></div>
        <div className="space-y-3 p-5">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-4 w-3/4" />)}</div>
      </aside>
      <div className="flex-1">
        <div className="h-16 border-b border-border bg-surface" />
        <div className="mx-auto max-w-7xl space-y-4 px-6 py-8">
          <Skeleton className="h-7 w-64" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
          <Skeleton className="h-64" />
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={<ShellSkeleton />}
      onError={(e) => (
        <div className="mx-auto max-w-lg px-6 py-24">
          <Logo product="Bank admin" />
          <div className="mt-8"><ErrorAlert error={e} title="The portal could not load your session" /></div>
          <Button className="mt-4" onClick={() => window.location.reload()}>Reload</Button>
        </div>
      )}
    >
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
