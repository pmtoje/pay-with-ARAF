'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Skeleton, Stepper, createApiClient, formatNaira } from '@araf/ui';
import { base as baseOf, errorCode, safeHref, type Api } from '@/lib/api';
import { FAST_POLL, SLOW_POLL, STEPS, stageIndex } from '@/lib/journey';
import type { Summary, View } from '@/lib/types';
import { CheckoutContextProvider, type CheckoutContextValue, type Flash } from './context';
import { CheckoutHeader, OrderSummaryCard } from './Header';
import { SandboxTools } from './SandboxTools';
import { StepRouter } from './StepRouter';
import { ErrorNotice, MerchantLink, SecurityNote } from './ui';
import { CancelApplication } from './steps/Cancel';
import { initEmbed, isEmbedded, post } from '@/lib/embed';

export type ReturnAction =
  | { kind: 'account-opening'; state: string | null }
  | { kind: 'mono'; code: string | null; error: string | null }
  | { kind: 'mandate' };

/**
 * CSRF token for this tab. Kept in memory; mirrored to sessionStorage (this tab only, cleared
 * when the tab closes) so returning from a provider redirect in the same tab does not force a
 * fresh one-time code. A new tab or browser always opens a new session and re-verifies.
 */
const storeKey = (id: string) => `araf_cx_${id}`;
function readStored(id: string): string | null {
  try {
    return sessionStorage.getItem(storeKey(id));
  } catch {
    return null;
  }
}
function writeStored(id: string, token: string | null) {
  try {
    if (token) sessionStorage.setItem(storeKey(id), token);
    else sessionStorage.removeItem(storeKey(id));
  } catch {
    /* storage unavailable: memory only */
  }
}

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'expired'; reason?: string } | { kind: 'error'; error: unknown };

export function CheckoutApp({ sessionId, returnAction }: { sessionId: string; returnAction?: ReturnAction }) {
  const tokenRef = useRef<string | null>(null);
  // Writes carry an Idempotency-Key and are retried with the same key on slow / dropped connections.
  const api: Api = useMemo(() => createApiClient({ csrfToken: () => tokenRef.current, retryWrites: { attempts: 4, timeoutMs: 25_000 } }), []);
  const [offline, setOffline] = useState(false);
  const embedded = useMemo(() => isEmbedded(), []);
  const base = baseOf(sessionId);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [flash, setFlash] = useState<Flash | null>(null);
  const [otpTick, setOtpTick] = useState(0);
  const [pollTick, setPollTick] = useState(0);
  const booted = useRef(false);
  const reconnecting = useRef<Promise<boolean> | null>(null);
  const lastInteraction = useRef(Date.now());

  const setToken = useCallback(
    (t: string | null) => {
      tokenRef.current = t;
      writeStored(sessionId, t);
    },
    [sessionId],
  );

  const openSession = useCallback(async () => {
    try {
      const res = await api.post<{ csrf_token: string }>(`${base}/open`);
      setToken(res.csrf_token);
      const v = await api.get<View>(`${base}/state`);
      setView(v);
      setPhase({ kind: 'ready' });
      return true;
    } catch (e) {
      if (errorCode(e) === 'CHECKOUT_EXPIRED') setPhase({ kind: 'expired' });
      else setPhase({ kind: 'error', error: e });
      return false;
    }
  }, [api, base, setToken]);

  // Bootstrap: public summary → existing tab session or open a new one → state.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      let s: Summary;
      try {
        s = await api.get<Summary>(base);
      } catch (e) {
        setPhase({ kind: 'error', error: e });
        return;
      }
      setSummary(s);
      const stored = readStored(sessionId);
      if (stored) {
        tokenRef.current = stored;
        try {
          const v = await api.get<View>(`${base}/state`);
          setView(v);
          setPhase({ kind: 'ready' });
          return;
        } catch {
          setToken(null);
        }
      }
      if (s.expired) {
        setPhase({ kind: 'expired' });
        return;
      }
      await openSession();
    })();
  }, [api, base, openSession, sessionId, setToken]);

  const refresh = useCallback(async () => {
    try {
      setView(await api.get<View>(`${base}/state`));
    } catch (e) {
      if (['SESSION_EXPIRED', 'CSRF_FAILED'].includes(errorCode(e) ?? '')) await openSession();
    }
  }, [api, base, openSession]);

  const recover = useCallback(
    async (err: unknown) => {
      const code = errorCode(err);
      if (!code || !['SESSION_EXPIRED', 'CSRF_FAILED', 'UNAUTHENTICATED'].includes(code)) return false;
      if (!reconnecting.current) {
        reconnecting.current = (async () => {
          if (code !== 'CSRF_FAILED') {
            try {
              // The browser session may still exist but need re-verification (inactivity).
              const v = await api.get<View>(`${base}/state`);
              setView(v);
              if (v.needs_reauthentication || !v.authenticated) return true;
            } catch {
              /* fall through to a fresh session */
            }
          }
          return openSession();
        })().finally(() => {
          reconnecting.current = null;
        });
      }
      await reconnecting.current;
      setFlash({ tone: 'info', title: 'For your security, please confirm it’s you', body: 'Your progress has been saved.' });
      return true;
    },
    [api, base, openSession],
  );

  // Connectivity: tell the customer when they are offline; re-read the true state when back online.
  useEffect(() => {
    const on = () => {
      setOffline(false);
      void refresh();
    };
    const off = () => setOffline(true);
    setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [refresh]);

  // Embedded in a merchant page: learn the (approved) parent origin, then report status only.
  const [parentKnown, setParentKnown] = useState(0);
  useEffect(() => {
    if (!embedded || !summary) return;
    return initEmbed(summary.embed_origins ?? [], () => setParentKnown((n) => n + 1));
  }, [embedded, summary]);
  useEffect(() => {
    if (!embedded || !view) return;
    post('araf:status', { application_reference: view.application_reference, stage: view.status.stage, label: view.status.label });
    const outcome = ['DECLINED'].includes(view.state) ? 'DECLINED' : ['CANCELLED', 'EXPIRED'].includes(view.state) ? view.state : view.state === 'ARAF_SUBMITTED' || view.state === 'ARAF_UNDER_REVIEW' ? 'SUBMITTED' : ['GOODS_DELIVERED', 'COMPLETED'].includes(view.state) ? 'DELIVERED' : null;
    if (outcome) post('araf:complete', { application_reference: view.application_reference, outcome });
  }, [embedded, view?.state, view?.status.stage, parentKnown]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyView = useCallback((v: View) => setView(v), []);
  const notifyOtpSent = useCallback(() => setOtpTick((t) => t + 1), []);

  // Inactivity tracking (the API also enforces a 5-minute idle timeout).
  useEffect(() => {
    const mark = () => {
      lastInteraction.current = Date.now();
    };
    window.addEventListener('pointerdown', mark);
    window.addEventListener('keydown', mark);
    return () => {
      window.removeEventListener('pointerdown', mark);
      window.removeEventListener('keydown', mark);
    };
  }, []);

  // Polling: fast while asynchronous work is in progress, slow while waiting on the Bank.
  useEffect(() => {
    if (!view?.authenticated) return;
    const fast = FAST_POLL.has(view.state);
    const slow = SLOW_POLL.has(view.state);
    if (!fast && !slow) return;
    const t = setTimeout(async () => {
      const idle = Date.now() - lastInteraction.current > 4 * 60_000;
      if (document.hidden || (slow && idle)) return setPollTick((n) => n + 1);
      try {
        setView(await api.get<View>(`${base}/state`));
      } catch (e) {
        if (!(await recover(e))) setPollTick((n) => n + 1);
      }
    }, fast ? 2000 : 10000);
    return () => clearTimeout(t);
  }, [view, pollTick, api, base, recover]);

  // Provider return pages: run the pending return action once the customer is verified.
  const returnDone = useRef(false);
  useEffect(() => {
    if (!returnAction || returnDone.current || !view?.authenticated) return;
    returnDone.current = true;
    (async () => {
      try {
        if (returnAction.kind === 'account-opening') {
          if (!returnAction.state) throw Object.assign(new Error('missing'), { code: 'ACCOUNT_OPENING_INCOMPLETE' });
          setView(await api.post<View>(`${base}/account-opening/complete`, { state: returnAction.state }));
          setFlash({ tone: 'success', title: 'Your Alternative Bank account is confirmed', body: 'We will use it for your repayments.' });
        } else if (returnAction.kind === 'mono') {
          if (returnAction.error || !returnAction.code) {
            setFlash({ tone: 'warning', title: 'Your bank was not connected', body: 'The connection was cancelled or did not complete. You can try again or choose another option.' });
          } else {
            setView(await api.post<View>(`${base}/statements/mono/exchange`, { code: returnAction.code }));
            setFlash({ tone: 'success', title: 'Bank connected', body: 'We received read-only statement data from your bank.' });
          }
        } else {
          const v = await api.post<View>(`${base}/mandate/verify`, {});
          setView(v);
          const status = v.mandate?.status;
          if (status === 'ACTIVE' || (v.state !== 'MANDATE_PENDING' && status !== 'FAILED')) setFlash({ tone: 'success', title: 'Repayment mandate active', body: 'Thank you. Your direct debit mandate has been confirmed.' });
          else if (status === 'FAILED') setFlash({ tone: 'danger', title: 'Your mandate was not activated', body: v.exception?.message ?? 'You can try setting it up again below.' });
          else setFlash({ tone: 'info', title: 'Mandate confirmation pending', body: 'We have not received confirmation from your bank yet. We will keep checking.' });
        }
      } catch (e) {
        if (await recover(e)) {
          returnDone.current = false;
          return;
        }
        if (returnAction.kind === 'account-opening' && (errorCode(e) === 'ACCOUNT_OPENING_INCOMPLETE' || (e as { code?: string }).code === 'ACCOUNT_OPENING_INCOMPLETE')) {
          setFlash({ tone: 'warning', title: 'We haven’t confirmed your account yet', body: 'If you finished opening your account, it may take a moment to be confirmed. Otherwise, continue account opening below.' });
        } else setFlash({ tone: 'danger', title: 'We could not complete that step', error: e });
        void refresh();
      } finally {
        try {
          window.history.replaceState(null, '', `/c/${encodeURIComponent(sessionId)}`);
        } catch {
          /* ignore */
        }
      }
    })();
  }, [returnAction, view, api, base, recover, refresh, sessionId]);

  // Move focus to the new step heading when the stage changes (screen-reader friendly).
  const lastState = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    if (lastState.current && lastState.current !== view.state) {
      document.getElementById('step-title')?.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    lastState.current = view.state;
  }, [view]);

  if (phase.kind === 'loading' || (phase.kind === 'ready' && (!summary || !view))) return <LoadingScreen summary={summary} />;
  if (phase.kind === 'expired' || phase.kind === 'error' || !summary || !view) {
    return <UnavailableScreen summary={summary} phase={phase} onRetry={() => window.location.reload()} />;
  }

  const ctx: CheckoutContextValue = { sessionId, base, api, csrf: () => tokenRef.current, summary, view, applyView, refresh, recover, otpTick, notifyOtpSent, flash, setFlash };
  const stage = stageIndex(view.status.stage);
  const tracking = view.status.stage === 'TRACK';

  return (
    <CheckoutContextProvider value={ctx}>
      <div className="min-h-screen bg-bg">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <CheckoutHeader />
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 sm:px-6 sm:pt-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
            <div className="min-w-0 space-y-5">
              {!tracking && !view.needs_reauthentication && (
                <div>
                  <div className="hidden sm:block">
                    <Stepper steps={STEPS} current={stage} />
                  </div>
                  <div className="sm:hidden">
                    <p className="mb-2 flex items-baseline justify-between text-xs">
                      <span className="font-semibold text-fg">{STEPS[Math.min(stage, STEPS.length - 1)].label}</span>
                      <span className="text-subtle">
                        Step {Math.min(stage + 1, STEPS.length)} of {STEPS.length}
                      </span>
                    </p>
                    <div className="flex gap-1.5" aria-hidden="true">
                      {STEPS.map((st, i) => (
                        <span key={st.id} className={`h-1 flex-1 rounded-full ${i <= stage ? 'bg-gold' : 'bg-border'}`} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <p className="sr-only" role="status" aria-live="polite">
                {view.status.label}. {view.status.description}
              </p>
              {offline && (
                <Alert tone="warning" title="You’re offline">
                  Your progress is saved with the Bank. We’ll pick up where you left off as soon as your connection is back — there’s no need to start again.
                </Alert>
              )}
              {flash && (
                <div className="relative">
                  <Alert tone={flash.tone} title={flash.title} className="pr-12">
                    {flash.body}
                    {!!flash.error && <ErrorNotice error={flash.error} className="mt-2 border-0 bg-transparent p-0" />}
                  </Alert>
                  <button type="button" onClick={() => setFlash(null)} className="absolute right-0.5 top-0.5 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label="Dismiss message">
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              )}
              <StepRouter />
              <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-subtle">
                <span>
                  Reference <span className="font-mono text-muted">{view.application_reference}</span>
                </span>
                {view.authenticated && <CancelApplication />}
              </div>
            </div>
            <aside className="hidden lg:block" aria-label="Order summary">
              <div className="sticky top-6 space-y-4">
                <OrderSummaryCard />
                <SecurityNote className="px-1" />
              </div>
            </aside>
          </div>
        </main>
        {summary.sandbox && <SandboxTools />}
      </div>
    </CheckoutContextProvider>
  );
}

function LoadingScreen({ summary }: { summary: Summary | null }) {
  return (
    <div className="min-h-screen bg-bg">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6" role="status" aria-label="Loading your checkout">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 rounded-lg border border-border bg-surface p-6">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="hidden space-y-3 rounded-lg border border-border bg-surface p-5 lg:block">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        </div>
        <span className="sr-only">Loading your secure checkout…</span>
      </main>
    </div>
  );
}

function UnavailableScreen({ summary, phase, onRetry }: { summary: Summary | null; phase: Phase; onRetry: () => void }) {
  const superseded = summary?.superseded_by;
  const notFound = phase.kind === 'error' && errorCode(phase.error) === 'NOT_FOUND';
  const expired = phase.kind === 'expired';
  const title = superseded ? 'Your cart was updated' : expired ? 'This checkout has expired' : notFound ? 'Checkout not found' : 'We could not load your checkout';
  return (
    <div className="min-h-screen bg-bg">
      <main id="main" className="mx-auto flex max-w-lg flex-col px-4 py-12 sm:py-20">
        <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">Pay with ARAF</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
            {superseded ? (
              <p>A newer checkout replaced this one after your cart changed. Continue with the updated checkout — your progress carries over where it can.</p>
            ) : expired ? (
              <p>For your security, checkout links are only valid for a limited time. Please return to {summary?.partner.name ?? 'the merchant'} to start again.</p>
            ) : notFound ? (
              <p>This checkout link is not valid. Please return to the merchant and choose Pay with ARAF again.</p>
            ) : (
              <ErrorNotice error={(phase as { error?: unknown }).error} />
            )}
            {summary && (
              <p>
                {summary.partner.name} · <span className="tabular-nums">{formatNaira(summary.amount)}</span>
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {superseded && (
              <a href={`/c/${encodeURIComponent(superseded)}`} className="inline-flex h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-medium text-ink-contrast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                Continue with updated checkout
              </a>
            )}
            {!superseded && !expired && !notFound && <Button onClick={onRetry}>Try again</Button>}
            {safeHref(summary?.cancel_url) && <MerchantLink href={summary?.cancel_url}>Back to {summary?.partner.name ?? 'merchant'}</MerchantLink>}
            {!summary && (
              <a href="/" className="inline-flex h-11 items-center justify-center rounded-md border border-border-strong px-5 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                About Pay with ARAF
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
