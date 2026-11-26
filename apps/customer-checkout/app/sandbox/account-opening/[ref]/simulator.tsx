'use client';

import { Button } from '@araf/ui';
import { ErrorNotice } from '@/components/checkout/ui';
import { SimLoading, SimNotFound, SimulatorShell, useSimulator } from '@/components/sandbox/Simulator';

export function AccountOpeningSimulator({ reference }: { reference: string }) {
  const path = `/api/sandbox/account-opening/${encodeURIComponent(reference)}`;
  const { api, data, error, busy, actionError, act } = useSimulator<{ status: string; name: string; prefilled?: { email?: string; phone?: string; address?: { line1: string; city: string; state: string } } }>(path);
  return (
    <SimulatorShell provider="The Alternative Bank account opening platform" title="Open a current account">
      {error ? (
        <SimNotFound error={error} />
      ) : !data ? (
        <SimLoading />
      ) : (
        <>
          <dl className="space-y-2 rounded-md bg-[#f5f7fa] px-4 py-3 text-sm dark:bg-[#15181c]">
            <div className="flex justify-between gap-3">
              <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Applicant</dt>
              <dd className="font-medium">{data.name}</dd>
            </div>
            {data.prefilled?.email && (
              <div className="flex justify-between gap-3">
                <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Email (pre-filled)</dt>
                <dd className="font-medium">{data.prefilled.email}</dd>
              </div>
            )}
            {data.prefilled?.phone && (
              <div className="flex justify-between gap-3">
                <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Phone (pre-filled)</dt>
                <dd className="font-medium">{data.prefilled.phone}</dd>
              </div>
            )}
            {data.prefilled?.address && (
              <div className="flex justify-between gap-3">
                <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Address (pre-filled)</dt>
                <dd className="text-right font-medium">{data.prefilled.address.line1}, {data.prefilled.address.city}, {data.prefilled.address.state}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-[#616e7c] dark:text-[#9aa5b1]">Request status</dt>
              <dd className="font-mono text-xs">{data.status}</dd>
            </div>
          </dl>
          <p className="text-sm text-[#52606d] dark:text-[#9aa5b1]">In production the customer completes KYC and account opening here — details the store already provided arrive pre-filled, so only missing ones are asked. Choose an outcome to simulate.</p>
          <ErrorNotice error={actionError} />
          <Button size="lg" block loading={busy === 'complete'} disabled={!!busy} onClick={() => void act('complete', async () => (await api.post<{ return_url: string }>(`${path}/complete`)).return_url)}>
            Complete account opening
          </Button>
          <Button size="lg" block variant="secondary" loading={busy === 'abandon'} disabled={!!busy} onClick={() => void act('abandon', async () => (await api.post<{ return_url: string }>(`${path}/abandon`)).return_url)}>
            Leave and come back later
          </Button>
        </>
      )}
    </SimulatorShell>
  );
}
