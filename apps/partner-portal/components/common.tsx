'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, ApiError, Badge, Button, Dialog, Field, Input, Select, cn, errorLines } from '@araf/ui';

/** Error panel with the API's safe message, validation details and correlation ID. */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }: { error: unknown; onRetry?: () => void; title?: string }) {
  const lines = errorLines(error);
  const correlation = error instanceof ApiError ? error.correlationId : undefined;
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <Alert
      tone="danger"
      title={forbidden ? 'You do not have access to this' : title}
      action={onRetry && !forbidden ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : undefined}
      className="m-4"
    >
      <ul className="space-y-0.5">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {correlation && <p className="mt-1 font-mono text-2xs text-muted">Correlation ID: {correlation}</p>}
    </Alert>
  );
}

/** Inline form error (aria-live). */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const correlation = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <div role="alert" className="rounded-md border border-transparent bg-danger-soft px-3 py-2 text-sm text-danger">
      <ul className="space-y-0.5">
        {errorLines(error).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {correlation && <p className="mt-1 font-mono text-2xs opacity-80">Correlation ID: {correlation}</p>}
    </div>
  );
}

export function SimulatedBadge({ simulated }: { simulated?: boolean }) {
  if (!simulated) return null;
  return (
    <Badge tone="warning" className="uppercase tracking-wide">
      Simulated
    </Badge>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[13px]', className)}>{children}</span>;
}

/** Confirmation dialog for consequential actions. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger' | 'gold';
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {children}
        <FormError error={error} />
      </div>
    </Dialog>
  );
}

// ---- Date range filter --------------------------------------------------------------------

export type RangeKey = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'all' | 'custom';

export interface RangeValue {
  range: RangeKey;
  from?: string;
  to?: string;
}

const RANGE_OPTIONS: Array<{ id: RangeKey; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

export function rangeQuery(v: RangeValue): Record<string, string | undefined> {
  if (v.range === 'custom') return v.from && v.to ? { range: 'custom', from: v.from, to: v.to } : { range: '30d' };
  return { range: v.range };
}

export function rangeLabel(v: RangeValue): string {
  if (v.range === 'custom' && v.from && v.to) return `${v.from} → ${v.to}`;
  if (v.range === 'all') return 'All time';
  return RANGE_OPTIONS.find((o) => o.id === v.range)?.label ?? '';
}

/** Segmented date-range control (today, yesterday, 7d, 30d, month, custom → range/from/to). */
export function RangeFilter({ value, onChange, allowAll }: { value: RangeValue; onChange: (v: RangeValue) => void; allowAll?: boolean }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(value.from ?? new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(value.to ?? today);
  const options = allowAll ? [...RANGE_OPTIONS.slice(0, 5), { id: 'all' as RangeKey, label: 'All time' }, RANGE_OPTIONS[5]] : RANGE_OPTIONS;
  const invalid = from > to;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div role="radiogroup" aria-label="Date range" className="inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value.range === o.id}
            onClick={() => onChange(o.id === 'custom' ? { range: 'custom', from, to } : { range: o.id })}
            className={cn(
              'min-h-[36px] rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              value.range === o.id ? 'bg-ink text-ink-contrast' : 'text-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value.range === 'custom' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid) onChange({ range: 'custom', from, to });
          }}
        >
          <Field label="From" className="w-40">
            {({ id }) => <Input id={id} type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-9" />}
          </Field>
          <Field label="To" className="w-40" error={invalid ? 'Must be on or after “From”' : null}>
            {({ id, describedBy, invalid: inv }) => <Input id={id} type="date" value={to} max={today} aria-invalid={inv} aria-describedby={describedBy} onChange={(e) => setTo(e.target.value)} className="h-9" />}
          </Field>
          <Button type="submit" variant="secondary" size="sm" className="mb-0.5 h-9" disabled={invalid}>
            Apply
          </Button>
        </form>
      )}
    </div>
  );
}

export function SelectFilter({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; className?: string }) {
  return (
    <Field label={label} className={className}>
      {({ id }) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-10">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/** Screen-reader announcement region for async results. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div role="status" aria-live="polite" className={cn('fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-md border px-4 py-2.5 text-sm font-medium shadow-md', msg.tone === 'success' ? 'border-success/30 bg-surface text-success' : 'border-danger/30 bg-surface text-danger')}>
      {msg.text}
    </div>
  ) : null;
  return { toast: (text: string, tone: 'success' | 'danger' = 'success') => setMsg({ text, tone }), toastNode: node };
}
