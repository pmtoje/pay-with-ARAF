'use client';

import type { ReactNode } from 'react';
import { Button, Logo, Spinner } from '@araf/ui';
import { PortalShell } from '@/components/portal-shell';
import { ErrorState } from '@/components/common';
import { isApiError } from '@/lib/api';
import { SessionProvider } from '@/lib/session';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={({ error, retry }) => (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-4">
          <Logo product="Partner" />
          {error && !isApiError(error, 'UNAUTHENTICATED') && !isApiError(error, 'MFA_REQUIRED') && !isApiError(error, 'SESSION_EXPIRED') ? (
            <div className="w-full max-w-md">
              <ErrorState error={error} onRetry={retry} title="We could not load your session" />
              <div className="text-center">
                <Button variant="ghost" onClick={() => (window.location.href = '/login')}>Go to sign in</Button>
              </div>
            </div>
          ) : (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" /> Loading your workspace…
            </p>
          )}
        </div>
      )}
    >
      <PortalShell>{children}</PortalShell>
    </SessionProvider>
  );
}
