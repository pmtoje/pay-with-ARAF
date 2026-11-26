'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Skeleton, Spinner, cn } from '@araf/ui';
import { describeError, safeHref } from '@/lib/api';
import { closeEmbed, isEmbedded } from '@/lib/embed';

export function StepCard({ eyebrow, title, description, children, footer, className }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface', className)} aria-labelledby="step-title">
      <div className="px-5 pb-1 pt-5 sm:px-7 sm:pt-7">
        {eyebrow && <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">{eyebrow}</p>}
        <h1 id="step-title" tabIndex={-1} className="text-xl font-semibold tracking-tight text-fg focus:outline-none sm:text-2xl">
          {title}
        </h1>
        {description && <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>}
      </div>
      {children && <div className="space-y-5 px-5 py-5 sm:px-7">{children}</div>}
      {footer && <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">{footer}</div>}
    </section>
  );
}

export function ErrorNotice({ error, action, className }: { error: unknown; action?: ReactNode; className?: string }) {
  if (!error) return null;
  const { title, lines } = describeError(error);
  return (
    <Alert tone="danger" title={title} action={action} className={className}>
      {lines.length > 0 && (
        <ul className="space-y-0.5">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/** Short "why we need this" helper. */
export function Why({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-muted">
      <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0 text-subtle" />
      <span>{children}</span>
    </p>
  );
}

export function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'h-4 w-4'} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SecurityNote({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 text-xs leading-relaxed text-muted', className)}>
      <LockIcon className="mt-px h-3.5 w-3.5 shrink-0 text-gold-strong" />
      <span>Bank-grade encryption · we never ask for your PIN or internet-banking password.</span>
    </p>
  );
}

/** Selectable card used for radio-style choices. Renders a native radio for accessibility. */
export function ChoiceCard({ name, value, checked, onChange, title, description, disabled, aside, badge }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; title: ReactNode; description?: ReactNode; disabled?: boolean; aside?: ReactNode; badge?: ReactNode }) {
  return (
    <label
      className={cn(
        'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border px-4 py-3.5 transition-colors focus-within:ring-2 focus-within:ring-focus',
        checked ? 'border-gold bg-gold-soft/40' : 'border-border-strong hover:bg-surface-2',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--color-gold))]" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
          {title}
          {badge}
        </span>
        {description && <span className="mt-0.5 block text-sm leading-relaxed text-muted">{description}</span>}
      </span>
      {aside && <span className="shrink-0 text-right">{aside}</span>}
    </label>
  );
}

/**
 * Back to the merchant. Embedded (inside the merchant's own page) it closes the panel instead of
 * navigating, so the shopper never leaves the merchant's website.
 */
export function MerchantLink({ href, children, variant = 'secondary', block, reason = 'return' }: { href: string | null | undefined; children: ReactNode; variant?: 'primary' | 'secondary' | 'gold'; block?: boolean; reason?: 'return' | 'cancel' | 'equity' }) {
  const url = safeHref(href);
  const styles = {
    primary: 'bg-ink text-ink-contrast hover:opacity-90 border-transparent',
    gold: 'bg-gold text-white hover:bg-gold-strong border-transparent dark:text-[#0c0c0d]',
    secondary: 'bg-surface text-fg border-border-strong hover:bg-surface-2',
  }[variant];
  if (isEmbedded()) {
    return (
      <button type="button" onClick={() => closeEmbed(reason)} className={cn('inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg', styles, block && 'w-full')}>
        {children}
      </button>
    );
  }
  if (!url) return null;
  return (
    <a href={url} className={cn('inline-flex h-11 items-center justify-center gap-2 rounded-md border px-5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg', styles, block && 'w-full')}>
      {children}
    </a>
  );
}

/** Calm "work in progress" panel with skeleton lines and a polite live region. */
export function ProgressPanel({ title, description, lines = 3 }: { title: string; description?: ReactNode; lines?: number }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold-strong">
          <Spinner className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-fg">{title}</p>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
      </div>
      <div className="space-y-2.5" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-1/2' : i % 2 ? 'w-5/6' : 'w-full')} />
        ))}
      </div>
    </div>
  );
}

export function useCountdown(initial = 0) {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export function ResendButton({ cooldown, onResend, busy }: { cooldown: number; onResend: () => void; busy?: boolean }) {
  return (
    <Button variant="ghost" size="sm" className="h-11 px-2 text-gold-strong" disabled={cooldown > 0} loading={busy} onClick={onResend}>
      {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
    </Button>
  );
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={cn('text-right tabular-nums', strong ? 'text-base font-semibold text-fg' : 'text-sm text-fg')}>{value}</dd>
    </div>
  );
}
