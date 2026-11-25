'use client';

import { useState } from 'react';
import { Button, Dialog, Logo, ThemeToggle, formatNaira } from '@araf/ui';
import { safeHref } from '@/lib/api';
import { useCheckout } from './context';
import { LockIcon, SecurityNote } from './ui';

function Items() {
  const { summary } = useCheckout();
  return (
    <ul className="divide-y divide-border">
      {summary.items.map((it, i) => (
        <li key={i} className="flex items-start justify-between gap-4 py-2.5 text-sm">
          <span className="min-w-0">
            <span className="block text-fg">{it.name}</span>
            <span className="text-xs text-subtle">
              Qty {it.quantity} · {formatNaira(it.unit_amount)} each
            </span>
          </span>
          <span className="shrink-0 tabular-nums text-fg">{formatNaira(it.line_amount)}</span>
        </li>
      ))}
    </ul>
  );
}

export function OrderSummaryCard() {
  const { summary } = useCheckout();
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">Paying {summary.partner.name}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-fg">{formatNaira(summary.amount)}</p>
      </div>
      <div className="px-5 py-2">
        <Items />
      </div>
      <div className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        Non-interest (Murabaha) financing by The Alternative Bank. The Bank buys the item and sells it to you at a disclosed profit markup, repaid in instalments.
      </div>
    </div>
  );
}

export function CheckoutHeader() {
  const { summary, view } = useCheckout();
  const [help, setHelp] = useState(false);
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Logo className="min-w-0" />
        <span className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
        <span className="hidden truncate text-sm text-muted sm:block">
          Checkout for <span className="font-medium text-fg">{summary.partner.name}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 hidden items-center gap-1.5 text-xs text-muted md:inline-flex">
            <LockIcon className="h-3.5 w-3.5 text-gold-strong" /> Secure checkout
          </span>
          <button type="button" onClick={() => setHelp(true)} className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            Help
          </button>
          <ThemeToggle className="h-11 w-11" />
        </div>
      </div>
      {/* Mobile purchase summary (collapsible). */}
      <details className="group border-t border-border lg:hidden">
        <summary className="mx-auto flex min-h-[48px] max-w-5xl cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 text-sm">
            <span className="block truncate text-muted">
              {summary.partner.name} · {summary.items.length} item{summary.items.length === 1 ? '' : 's'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-base font-semibold tabular-nums text-fg">{formatNaira(summary.amount)}</span>
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-subtle transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="sr-only">Show order details</span>
          </span>
        </summary>
        <div className="mx-auto max-w-5xl px-4 pb-3 sm:px-6">
          <Items />
          <SecurityNote className="mt-2 border-t border-border pt-3" />
        </div>
      </details>
      <Dialog
        open={help}
        onClose={() => setHelp(false)}
        title="Need help?"
        footer={
          <Button variant="secondary" onClick={() => setHelp(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          <p>
            For questions about your financing application, contact The Alternative Bank customer care and quote your reference{' '}
            <span className="font-mono text-fg">{view.application_reference}</span>.
          </p>
          <p>For questions about your order, delivery or returns, contact {summary.partner.name}.</p>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-fg">
            We will never ask for your card PIN, internet-banking password or a one-time code by phone, SMS or email. Only enter codes on this page.
          </p>
          {safeHref(summary.partner.website) && (
            <p>
              <a className="font-medium text-gold-strong underline underline-offset-2" href={safeHref(summary.partner.website)!} target="_blank" rel="noopener noreferrer">
                Visit {summary.partner.name}
              </a>
            </p>
          )}
        </div>
      </Dialog>
    </header>
  );
}
