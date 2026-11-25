'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Alert, ApiError, Button, Dialog, EmptyState, Field, LoadingBlock, Textarea, cn, errorLines } from '@araf/ui';
import { useSession } from '@/lib/session';
import { Icon } from './icons';

// ---- Errors ------------------------------------------------------------------------------

export function ErrorAlert({ error, title = 'Something went wrong', onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  if (!error) return null;
  const lines = errorLines(error);
  const forbidden = error instanceof ApiError && error.status === 403;
  const corr = error instanceof ApiError ? error.correlationId : undefined;
  return (
    <Alert
      tone="danger"
      className={className}
      title={forbidden ? 'You do not have access to this' : title}
      action={onRetry && !forbidden ? <Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button> : undefined}
    >
      <ul className="space-y-0.5">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {corr && <p className="mt-1 font-mono text-2xs text-subtle">Reference: {corr}</p>}
    </Alert>
  );
}

// ---- Async block -------------------------------------------------------------------------

export function Async<T>({ state, children, rows = 4, empty, isEmpty }: { state: { data: T | undefined; error: unknown; loading: boolean; reload: () => void }; children: (data: T) => ReactNode; rows?: number; empty?: ReactNode; isEmpty?: (d: T) => boolean }) {
  if (state.error && state.data === undefined) return <div className="p-5"><ErrorAlert error={state.error} onRetry={state.reload} /></div>;
  if (state.data === undefined) return <LoadingBlock rows={rows} />;
  if (empty && (isEmpty ? isEmpty(state.data) : Array.isArray(state.data) && state.data.length === 0)) return <>{empty}</>;
  return (
    <>
      {state.error ? <div className="px-5 pt-4"><ErrorAlert error={state.error} onRetry={state.reload} title="Could not refresh" /></div> : null}
      {children(state.data)}
    </>
  );
}

// ---- Toasts ------------------------------------------------------------------------------

interface Toast { id: number; message: ReactNode; tone: 'success' | 'danger' | 'info' }
const ToastCtx = createContext<(message: ReactNode, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: ReactNode, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex items-start gap-2 rounded-md border bg-surface px-4 py-3 text-sm shadow-md', t.tone === 'danger' ? 'border-danger/40' : t.tone === 'info' ? 'border-info/40' : 'border-success/40')}>
            <span className={cn('mt-0.5', t.tone === 'danger' ? 'text-danger' : t.tone === 'info' ? 'text-info' : 'text-success')}>{t.tone === 'danger' ? Icon.x() : Icon.check()}</span>
            <span className="text-fg">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---- Action dialog (confirmation + mandatory reason) -------------------------------------

export interface ActionDialogProps<R> {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'gold' | 'danger';
  /** Ask for a reason / comment / note. */
  reason?: { label: string; minLength?: number; hint?: ReactNode; placeholder?: string; optional?: boolean };
  children?: ReactNode;
  /** Extra validation for custom fields. Return a message to block submission. */
  validate?: () => string | null;
  onConfirm: (reason: string) => Promise<R>;
  onDone?: (result: R) => void;
  successMessage?: ReactNode | ((r: R) => ReactNode);
  irreversible?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function ActionDialog<R>({ open, onClose, title, description, confirmLabel, tone = 'primary', reason, children, validate, onConfirm, onDone, successMessage, irreversible, size }: ActionDialogProps<R>) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setTouched(false);
    }
  }, [open]);
  const min = reason?.minLength ?? 3;
  const reasonError = reason && !reason.optional && text.trim().length < min ? `Enter at least ${min} characters.` : null;
  const submit = async () => {
    setTouched(true);
    const v = validate?.();
    if (reasonError || v) {
      if (v) setError(new Error(v));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await onConfirm(text.trim());
      toast(typeof successMessage === 'function' ? successMessage(r) : successMessage ?? 'Done');
      onClose();
      onDone?.(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : tone === 'gold' ? 'gold' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {irreversible && (
          <Alert tone="warning" title="This cannot be undone">
            The action is recorded in the audit log with your name and reason.
          </Alert>
        )}
        {children}
        {reason && (
          <Field label={reason.label} required={!reason.optional} hint={reason.hint} error={touched ? reasonError : null}>
            {(ids) => (
              <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={text} placeholder={reason.placeholder} maxLength={1000} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
        )}
        <div aria-live="assertive">{error ? <ErrorAlert error={error} title="The action was not completed" /> : null}</div>
      </div>
    </Dialog>
  );
}

// ---- Access ------------------------------------------------------------------------------

export function NoAccess({ permission }: { permission: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <EmptyState
        icon={Icon.lock('h-5 w-5')}
        title="You do not have access to this area"
        description={
          <>
            This page requires the <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs">{permission}</code> permission. Role changes are requested by a user manager and approved by a second officer.
          </>
        }
      />
    </div>
  );
}

export function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useSession();
  return can(perm) ? <>{children}</> : <NoAccess permission={perm} />;
}

// ---- Small display helpers --------------------------------------------------------------

export function JsonBlock({ value, maxHeight = 'max-h-80' }: { value: unknown; maxHeight?: string }) {
  if (value === null || value === undefined) return <p className="text-sm text-subtle">—</p>;
  return <pre className={cn('overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-fg', maxHeight)}>{JSON.stringify(value, null, 2)}</pre>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12.5px] tracking-tight', className)}>{children}</span>;
}

export function Section({ title, description, actions, children, className, flush }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-end gap-3 border-b border-border px-4 py-3', className)}>{children}</div>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ id: T; label: ReactNode }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-border-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'h-8 rounded-[5px] px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            value === o.id ? 'bg-ink text-ink-contrast' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Compact labelled control for filter bars. */
export function FilterField({ label, children, className }: { label: string; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-2xs font-semibold uppercase tracking-wide text-subtle">{label}</label>
      {children(id)}
    </div>
  );
}

export const filterControl = 'h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-focus';

export function MultiSelect({ label, options, value, onChange, renderOption }: { label: string; options: readonly string[]; value: string[]; onChange: (v: string[]) => void; renderOption?: (o: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <span id={`${id}-l`} className="text-2xs font-semibold uppercase tracking-wide text-subtle">{label}</span>
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-labelledby={`${id}-l ${id}-v`} onClick={() => setOpen((o) => !o)} className={cn(filterControl, 'inline-flex min-w-[11rem] items-center justify-between gap-2 text-left')}>
        <span id={`${id}-v`} className="truncate">{value.length ? `${value.length} selected` : 'Any'}</span>
        <span className="rotate-90 text-subtle">{Icon.chevron('h-3.5 w-3.5')}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-md">
          <div className="mb-1 flex justify-between px-1">
            <button type="button" className="text-xs font-medium text-gold-strong hover:underline" onClick={() => onChange([])}>Clear</button>
            <button type="button" className="text-xs font-medium text-muted hover:underline" onClick={() => setOpen(false)}>Done</button>
          </div>
          {options.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--color-gold))]" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} />
              <span className="truncate">{renderOption ? renderOption(o) : o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function SubtleLink({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  return (
    <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined} className="inline-flex items-center gap-1 font-medium text-gold-strong underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      {children}
      {external && Icon.external('h-3.5 w-3.5')}
    </a>
  );
}

export function Pending({ children }: { children: ReactNode }) {
  return <span className="text-sm text-subtle">{children}</span>;
}

export function DisabledReason({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted"><span className="mt-0.5 text-subtle">{Icon.lock('h-3.5 w-3.5')}</span><span>{children}</span></p>;
}
