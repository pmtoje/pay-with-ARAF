'use client';

import { Button } from '@araf/ui';
import { ErrorNotice } from '@/components/checkout/ui';
import { SimLoading, SimNotFound, SimulatorShell, useSimulator } from '@/components/sandbox/Simulator';

export function RemitaSimulator({ reference }: { reference: string }) {
  const path = `/api/sandbox/remita/${encodeURIComponent(reference)}`;
  const { api, data, error, busy, actionError, act } = useSimulator<{ status: string }>(path);
  const authorize = (approve: boolean) => act(approve ? 'approve' : 'decline', async () => (await api.post<{ return_url: string }>(`${path}/authorize`, { approve })).return_url);
  return (
    <SimulatorShell provider="Remita direct debit mandate" title="Authorise direct debit mandate">
      {error ? (
        <SimNotFound error={error} />
      ) : !data ? (
        <SimLoading />
      ) : (
        <>
          <dl className="space-y-2 rounded-md bg-[#f5f7fa] px-4 py-3 text-sm dark:bg-[#15181c]">
            <div className="flex justify-between gap-3">
              <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Mandate reference</dt>
              <dd className="font-mono text-xs">{reference}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Status</dt>
              <dd className="font-mono text-xs">{data.status}</dd>
            </div>
          </dl>
          <p className="text-sm text-[#52606d] dark:text-[#9aa5b1]">In production the payer authorises the mandate with their bank via Remita. Choose an outcome to simulate.</p>
          <ErrorNotice error={actionError} />
          <Button size="lg" block loading={busy === 'approve'} disabled={!!busy} onClick={() => void authorize(true)}>
            Approve mandate
          </Button>
          <Button size="lg" block variant="secondary" loading={busy === 'decline'} disabled={!!busy} onClick={() => void authorize(false)}>
            Decline
          </Button>
        </>
      )}
    </SimulatorShell>
  );
}
