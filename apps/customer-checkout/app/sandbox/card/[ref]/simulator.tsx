'use client';

import { Button } from '@araf/ui';
import { ErrorNotice } from '@/components/checkout/ui';
import { SimLoading, SimNotFound, SimulatorShell, useSimulator } from '@/components/sandbox/Simulator';

/** Sandbox stand-in for Paystack's card page. In production the customer enters their real debit card on Paystack. */
export function CardSimulator({ reference }: { reference: string }) {
  const path = `/api/sandbox/card/${encodeURIComponent(reference)}`;
  const { api, data, error, busy, actionError, act } = useSimulator<{ status: string; amount: number }>(path);
  const authorize = (approve: boolean) => act(approve ? 'approve' : 'decline', async () => (await api.post<{ return_url: string }>(`${path}/authorize`, { approve })).return_url);
  return (
    <SimulatorShell provider="Paystack card" title="Add your debit card">
      {error ? (
        <SimNotFound error={error} />
      ) : !data ? (
        <SimLoading />
      ) : (
        <>
          <dl className="space-y-2 rounded-md bg-[#f5f7fa] px-4 py-3 text-sm dark:bg-[#15181c]">
            <div className="flex justify-between gap-3">
              <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Test card</dt>
              <dd className="font-mono text-xs">4084 0840 8408 4081 · 12/30 · CVV 408</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Card check (refunded)</dt>
              <dd className="font-mono text-xs">₦{(data.amount / 100).toLocaleString('en-NG')}</dd>
            </div>
          </dl>
          <p className="text-sm text-[#52606d] dark:text-[#9aa5b1]">In production the customer enters their own debit card from any Nigerian bank on Paystack. Choose an outcome to simulate.</p>
          <ErrorNotice error={actionError} />
          <Button size="lg" block loading={busy === 'approve'} disabled={!!busy || data.status !== 'pending'} onClick={() => void authorize(true)}>
            Pay ₦{(data.amount / 100).toLocaleString('en-NG')} with the test card
          </Button>
          <Button size="lg" block variant="secondary" loading={busy === 'decline'} disabled={!!busy || data.status !== 'pending'} onClick={() => void authorize(false)}>
            Decline
          </Button>
        </>
      )}
    </SimulatorShell>
  );
}
