'use client';

import { useState } from 'react';
import { Button } from '@araf/ui';
import { ErrorNotice } from '@/components/checkout/ui';
import { SimLoading, SimNotFound, SimulatorShell, useSimulator } from '@/components/sandbox/Simulator';

function withParam(url: string, key: string, value: string) {
  const u = new URL(url, window.location.origin);
  u.searchParams.set(key, value);
  return u.toString();
}

export function MonoSimulator({ sessionRef }: { sessionRef: string }) {
  const path = `/api/sandbox/mono/${encodeURIComponent(sessionRef)}`;
  const { api, data, error, busy, actionError, act } = useSimulator<{ status: string; institutions: string[] }>(path);
  const [institution, setInstitution] = useState('');
  const authorize = (outcome: 'SUCCESS' | 'FAILURE') =>
    act(outcome, async () => {
      const r = await api.post<{ redirect_url: string; code: string | null }>(`${path}/authorize`, { institution, outcome });
      return outcome === 'SUCCESS' && r.code ? withParam(r.redirect_url, 'code', r.code) : withParam(r.redirect_url, 'error', 'access_denied');
    });
  return (
    <SimulatorShell provider="Mono Connect" title="Share read-only access to your bank">
      {error ? (
        <SimNotFound error={error} />
      ) : !data ? (
        <SimLoading />
      ) : data.status !== 'PENDING' ? (
        <SimNotFound error={new Error(`This connection session is ${data.status.toLowerCase()}.`)} />
      ) : (
        <>
          <p className="text-sm text-[#52606d] dark:text-[#9aa5b1]">
            The real Mono widget authenticates you with your bank directly. Your bank login is never shared with Pay with ARAF or The Alternative Bank — only read-only statement data is.
          </p>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">Choose your bank</legend>
            {data.institutions.map((i) => (
              <label key={i} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${institution === i ? 'border-[#3e4c59] bg-[#f5f7fa] dark:border-[#9aa5b1] dark:bg-[#15181c]' : 'border-[#cbd2d9] dark:border-[#323a43]'}`}>
                <input type="radio" name="institution" checked={institution === i} onChange={() => setInstitution(i)} className="h-4 w-4" />
                {i}
              </label>
            ))}
          </fieldset>
          <ErrorNotice error={actionError} />
          <Button size="lg" block disabled={!institution || !!busy} loading={busy === 'SUCCESS'} onClick={() => void authorize('SUCCESS')}>
            Authorise read-only access
          </Button>
          <Button size="lg" block variant="secondary" disabled={!institution || !!busy} loading={busy === 'FAILURE'} onClick={() => void authorize('FAILURE')}>
            Simulate failure
          </Button>
        </>
      )}
    </SimulatorShell>
  );
}
