'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { Api } from '@/lib/api';
import { SESSION_CODES, errorCode } from '@/lib/api';
import { isView, type Summary, type View } from '@/lib/types';

export interface Flash {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  body?: ReactNode;
  error?: unknown;
}

export interface CheckoutContextValue {
  sessionId: string;
  base: string;
  api: Api;
  csrf: () => string | null;
  summary: Summary;
  view: View;
  applyView: (v: View) => void;
  refresh: () => Promise<void>;
  /** Handles session-level errors (expiry, CSRF). Returns true when the error was absorbed. */
  recover: (err: unknown) => Promise<boolean>;
  otpTick: number;
  notifyOtpSent: () => void;
  flash: Flash | null;
  setFlash: (f: Flash | null) => void;
}

const Ctx = createContext<CheckoutContextValue | null>(null);

export function CheckoutContextProvider({ value, children }: { value: CheckoutContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCheckout(): CheckoutContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCheckout must be used inside the checkout');
  return v;
}

/**
 * One async action at a time per component: loading flag, error capture, no double submits.
 * Responses shaped like the customer view are applied automatically.
 */
export function useAction() {
  const ctx = useCheckout();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, opts: { onError?: (e: unknown) => boolean | void; keepError?: boolean } = {}): Promise<T | undefined> => {
      if (lock.current) return undefined;
      lock.current = true;
      setBusy(key);
      if (!opts.keepError) setError(null);
      try {
        const r = await fn();
        if (isView(r)) ctx.applyView(r);
        return r;
      } catch (e) {
        if (SESSION_CODES.has(errorCode(e) ?? '') && (await ctx.recover(e))) return undefined;
        if (opts.onError?.(e)) return undefined;
        setError(e);
        if (errorCode(e) === 'INVALID_STATE') void ctx.refresh();
        return undefined;
      } finally {
        lock.current = false;
        setBusy(null);
      }
    },
    [ctx],
  );
  return { busy, error, setError, run };
}
