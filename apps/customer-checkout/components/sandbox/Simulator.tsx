'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Skeleton, createApiClient } from '@araf/ui';
import { safeHref } from '@/lib/api';
import { ErrorNotice } from '../checkout/ui';

/**
 * Neutral frame for SANDBOX provider stand-ins. Intentionally does not look like the ARAF
 * checkout: these pages represent third-party hosted pages (account opening, Mono, Remita).
 */
export function SimulatorShell({ provider, title, children }: { provider: string; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#eef0f3] text-[#1f2933] dark:bg-[#15181c] dark:text-[#e4e7eb]">
      <div role="note" className="border-b-2 border-dashed border-[#b45309] bg-[#fff7ed] px-4 py-2 text-center text-xs font-bold uppercase tracking-[0.12em] text-[#9a3412] dark:bg-[#2a1d10] dark:text-[#fdba74]">
        Sandbox simulator — stands in for {provider}
      </div>
      <main id="main" className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-md border border-[#cbd2d9] bg-white p-6 dark:border-[#323a43] dark:bg-[#1f2429]">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#616e7c] dark:text-[#9aa5b1]">{provider}</p>
          <h1 className="mt-1 text-xl font-semibold">{title}</h1>
          <div className="mt-5 space-y-4">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-[#616e7c] dark:text-[#9aa5b1]">Synthetic test environment. No real accounts, money or bank credentials are involved.</p>
      </main>
    </div>
  );
}

export function useSimulator<T>(path: string) {
  const api = useMemo(() => createApiClient(), []);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  useEffect(() => {
    api.get<T>(path).then(setData).catch(setError);
  }, [api, path]);
  const act = async (key: string, fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(key);
    setActionError(null);
    try {
      const url = safeHref(await fn());
      if (!url) throw new Error('The return link is not valid.');
      window.location.assign(url);
    } catch (e) {
      setActionError(e);
      setBusy(null);
    }
  };
  return { api, data, error, busy, actionError, act };
}

export function SimLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

export function SimNotFound({ error }: { error: unknown }) {
  return (
    <>
      <ErrorNotice error={error} />
      <p className="text-sm text-[#616e7c] dark:text-[#9aa5b1]">This simulated session was not found or has already been used. Return to the checkout and start this step again.</p>
      <Button variant="secondary" onClick={() => window.history.back()}>
        Go back
      </Button>
    </>
  );
}
