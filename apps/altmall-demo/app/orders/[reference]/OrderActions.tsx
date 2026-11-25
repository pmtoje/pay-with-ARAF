'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Alert, Button } from '@araf/ui';
import { payAnotherWay, retryAraf } from '@/app/actions/checkout';

/** Re-fetch the server-confirmed status periodically (bounded), pausing when the tab is hidden. */
export function AutoRefresh({ intervalMs, maxRuns = 45 }: { intervalMs: number; maxRuns?: number }) {
  const router = useRouter();
  const runs = useRef(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (runs.current++ >= maxRuns) return window.clearInterval(id);
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs, maxRuns]);
  return null;
}

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={() => start(() => router.refresh())} className="h-9">
      Refresh status
    </Button>
  );
}

export function PayAnotherWay({ reference }: { reference: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pay = async (method: 'card_demo' | 'transfer_demo') => {
    setBusy(method);
    setError(null);
    try {
      const r = await payAnotherWay(reference, method);
      if (!r.ok) setError(r.message ?? 'Please try again.');
      else router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="font-semibold text-fg">Choose another payment method</h3>
      <p className="mt-1 text-sm text-muted">Your order is saved. Complete it with a demo payment — nothing is charged.</p>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="lg" onClick={() => pay('card_demo')} loading={busy === 'card_demo'} disabled={!!busy}>
          Pay by card (demo)
        </Button>
        <Button size="lg" variant="secondary" onClick={() => pay('transfer_demo')} loading={busy === 'transfer_demo'} disabled={!!busy}>
          Bank transfer (demo)
        </Button>
      </div>
    </div>
  );
}

export function RetryAraf({ reference }: { reference: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="ghost"
        className="underline underline-offset-4"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await retryAraf(reference);
            if (r.ok) window.location.assign(r.redirect);
            else {
              setError(r.message);
              setBusy(false);
            }
          } catch {
            setError('Something went wrong. Please try again.');
            setBusy(false);
          }
        }}
      >
        Start a new Pay with ARAF application
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
