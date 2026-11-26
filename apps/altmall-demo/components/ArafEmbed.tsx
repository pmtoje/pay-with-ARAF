'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * AltMall's use of the Pay with ARAF embed SDK (/v1/araf.js, served by the Bank's checkout).
 * The shopper never leaves AltMall: the Bank's checkout opens in a panel on this page and
 * closes back to it. AltMall then re-reads the status from Pay with ARAF on its server — a
 * closed panel or a "complete" event is never treated as proof of approval or payment.
 */
export const BNPL_LABEL = 'Buy Now Pay Later with AltBank';

type Sdk = { open: (o: { checkoutUrl: string; onClose?: (e: { reason: string }) => void; onEvent?: (e: { type: string }) => void }) => { close: () => void } };
const loaded = new Map<string, Promise<Sdk>>();

export function loadArafSdk(checkoutUrl: string): Promise<Sdk> {
  const origin = new URL(checkoutUrl).origin;
  const existing = loaded.get(origin);
  if (existing) return existing;
  const p = new Promise<Sdk>((resolve, reject) => {
    const w = window as unknown as { ArafCheckout?: Sdk & { origin: string } };
    if (w.ArafCheckout && w.ArafCheckout.origin === origin) return resolve(w.ArafCheckout);
    const s = document.createElement('script');
    s.src = `${origin}/v1/araf.js`;
    s.async = true;
    s.onload = () => (w.ArafCheckout ? resolve(w.ArafCheckout) : reject(new Error('Pay with ARAF did not load')));
    s.onerror = () => {
      loaded.delete(origin);
      reject(new Error('Pay with ARAF could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  loaded.set(origin, p);
  return p;
}

/** Opens the embedded checkout and refreshes this (server-rendered) page when it closes. */
export function useArafCheckout() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const open = useCallback(
    async (checkoutUrl: string, afterClose?: (reason: string) => void) => {
      setError(null);
      setOpening(true);
      try {
        const sdk = await loadArafSdk(checkoutUrl);
        sdk.open({
          checkoutUrl,
          onClose: ({ reason }) => {
            router.refresh();
            afterClose?.(reason);
          },
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setOpening(false);
      }
    },
    [router],
  );
  return { open, error, opening };
}

/** The standard call to action on a payment screen. */
export function BnplButton({ onClick, loading, className, label = BNPL_LABEL, type = 'button' }: { onClick?: () => void; loading?: boolean; className?: string; label?: string; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={loading} aria-busy={loading || undefined} className={cn('inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-lg bg-[#0c0c0d] px-5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b08a2e] focus-visible:ring-offset-2 disabled:opacity-70', className)}>
      <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[#b08a2e] text-[13px] font-extrabold text-[#0c0c0d]">
        A
      </span>
      {loading ? 'Opening secure checkout…' : label}
    </button>
  );
}

/** Order page: open (or continue) the embedded checkout; auto-opens right after the order is placed. */
export function OpenArafCheckout({ checkoutUrl, label, autoOpen, variant = 'primary' }: { checkoutUrl: string; label: string; autoOpen?: boolean; variant?: 'primary' | 'secondary' }) {
  const { open, error, opening } = useArafCheckout();
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (!autoOpen || done.current) return;
    done.current = true;
    void open(checkoutUrl, () => {
      // Drop ?pay=araf so a page refresh does not reopen the panel.
      router.replace(window.location.pathname + '?from=araf');
    });
  }, [autoOpen, checkoutUrl, open, router]);
  return (
    <div className="mt-4">
      {variant === 'primary' ? (
        <BnplButton onClick={() => void open(checkoutUrl)} loading={opening} label={label} className="sm:w-auto" />
      ) : (
        <button type="button" onClick={() => void open(checkoutUrl)} className="btn-outline h-11 text-sm">
          {label}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
