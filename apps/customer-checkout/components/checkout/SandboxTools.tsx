'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton, formatDateTime } from '@araf/ui';
import { useCheckout } from './context';
import { ErrorNotice } from './ui';

interface Scenario {
  scenario: string;
  title: string;
  description: string;
  bvn: string;
  date_of_birth: string;
  suggested_path: string;
}
interface Message {
  channel: string;
  destination: string;
  body: string;
  at: string;
}

export const SANDBOX_IDENTITY_EVENT = 'araf:sandbox-identity';

/** SANDBOX-only drawer: test identities and the simulated SMS inbox. */
export function SandboxTools() {
  const { api, sessionId, otpTick } = useCheckout();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'identities'>('inbox');
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [scenarioError, setScenarioError] = useState<unknown>(null);
  const [inbox, setInbox] = useState<Message[] | null>(null);
  const [inboxError, setInboxError] = useState<unknown>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    setInboxError(null);
    try {
      setInbox(await api.get<Message[]>(`/api/sandbox/checkout/${encodeURIComponent(sessionId)}/inbox`));
    } catch (e) {
      setInboxError(e);
    } finally {
      setLoadingInbox(false);
    }
  }, [api, sessionId]);

  useEffect(() => {
    if (open) void loadInbox();
  }, [open, otpTick, loadInbox]);

  useEffect(() => {
    if (!open || scenarios) return;
    api
      .get<Scenario[]>('/api/sandbox/scenarios')
      .then(setScenarios)
      .catch(setScenarioError);
  }, [open, scenarios, api]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const copy = async (s: Scenario) => {
    try {
      await navigator.clipboard.writeText(`${s.bvn} ${s.date_of_birth}`);
    } catch {
      /* clipboard unavailable */
    }
    window.dispatchEvent(new CustomEvent(SANDBOX_IDENTITY_EVENT, { detail: { bvn: s.bvn, date_of_birth: s.date_of_birth } }));
    setCopied(s.scenario);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="sandbox-tools"
        className="fixed bottom-3 right-3 z-40 inline-flex h-11 items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-2.5 sm:bottom-4 sm:right-4 sm:px-4 text-sm font-semibold text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="rounded-sm bg-warning px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider text-white dark:text-[#0c0c0d]">Sandbox</span>
        <span className="hidden sm:inline">Tools</span>
        <span className="sr-only sm:hidden">tools</span>
      </button>
      {open && (
        <div id="sandbox-tools" role="dialog" aria-modal="false" aria-label="Sandbox tools" className="fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-hidden rounded-t-lg border border-warning/40 bg-surface sm:inset-x-auto sm:bottom-20 sm:right-4 sm:w-[400px] sm:rounded-lg">
          <div className="flex items-center justify-between border-b border-border bg-warning-soft px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-warning">SANDBOX tools</p>
              <p className="text-xs text-fg/70">Test data only — not part of the live checkout.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-warning hover:bg-black/5" aria-label="Close sandbox tools">
              ✕
            </button>
          </div>
          <div role="tablist" aria-label="Sandbox tools" className="flex border-b border-border px-2">
            {(['inbox', 'identities'] as const).map((t) => (
              <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px h-11 border-b-2 px-3 text-sm font-medium ${tab === t ? 'border-gold text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
                {t === 'inbox' ? 'SMS inbox' : 'Test identities'}
              </button>
            ))}
          </div>
          <div className="max-h-[calc(80vh-120px)] overflow-y-auto p-4">
            {tab === 'inbox' ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted">One-time codes sent for this checkout.</p>
                  <Button size="sm" variant="secondary" className="h-11" loading={loadingInbox} onClick={() => void loadInbox()}>
                    Refresh
                  </Button>
                </div>
                <div aria-live="polite">
                  {inboxError ? (
                    <ErrorNotice error={inboxError} />
                  ) : !inbox ? (
                    <div className="space-y-2">
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                    </div>
                  ) : inbox.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted">No messages yet. Codes appear here after they are sent.</p>
                  ) : (
                    <ul className="space-y-2">
                      {inbox.map((m, i) => (
                        <li key={i} className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
                          <p className="text-sm text-fg">{m.body}</p>
                          <p className="mt-1 text-2xs text-subtle">
                            {m.channel} to {m.destination} · {formatDateTime(m.at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : scenarioError ? (
              <ErrorNotice error={scenarioError} />
            ) : !scenarios ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <ul className="space-y-2">
                <li className="text-xs text-muted">Select an identity to copy its BVN and date of birth (and fill the form if it is open).</li>
                {scenarios.map((s) => (
                  <li key={s.scenario}>
                    <button type="button" onClick={() => void copy(s)} className="w-full rounded-md border border-border px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-fg">{s.title}</span>
                        <span className="text-2xs font-medium text-gold-strong">{copied === s.scenario ? 'Copied' : 'Copy'}</span>
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-muted">
                        BVN {s.bvn} · DOB {s.date_of_birth}
                      </span>
                      <span className="mt-1 block text-xs text-subtle">{s.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
