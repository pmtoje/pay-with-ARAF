'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function cn(...parts: Array<unknown>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

// ---- Buttons ----------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-ink-contrast hover:opacity-90 border border-transparent',
  gold: 'bg-gold text-white hover:bg-gold-strong border border-transparent dark:text-[#0c0c0d]',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90 border border-transparent',
};
const buttonSizes: Record<ButtonSize, string> = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---- Form controls ---------------------------------------------------------------------

const controlBase =
  'w-full rounded-md border border-border-strong bg-surface px-3 text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent disabled:opacity-60 aria-[invalid=true]:border-danger';

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

/** Accessible field wrapper: label, hint and error are programmatically associated. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(controlBase, 'h-11', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(controlBase, 'min-h-[96px] py-2', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(controlBase, 'h-11 pr-8', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, description, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-border-strong accent-[rgb(var(--color-gold))] focus:ring-2 focus:ring-focus" {...rest} />
      <label htmlFor={id} className="text-sm leading-relaxed text-fg">
        {label}
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </label>
    </div>
  );
}

/** Six-box OTP input with paste support; numeric keypad on mobile. */
export function OtpInput({ value, onChange, length = 6, disabled, label = 'Verification code' }: { value: string; onChange: (v: string) => void; length?: number; disabled?: boolean; label?: string }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, length));
  };
  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          disabled={disabled}
          value={d}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) return set(i, '');
            set(i, v[v.length - 1]);
            refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            if (text) {
              e.preventDefault();
              onChange(text);
              refs.current[Math.min(text.length, length - 1)]?.focus();
            }
          }}
          className="h-14 w-full max-w-[3.25rem] rounded-md border border-border-strong bg-surface text-center text-xl font-semibold tabular-nums text-fg focus:outline-none focus:ring-2 focus:ring-focus"
        />
      ))}
    </div>
  );
}

// ---- Surfaces & feedback ------------------------------------------------------------

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'action' | 'negative';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  gold: 'bg-gold-soft text-gold-strong border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  info: 'bg-info-soft text-info border-transparent',
  progress: 'bg-info-soft text-info border-transparent',
  action: 'bg-gold-soft text-gold-strong border-transparent',
  negative: 'bg-danger-soft text-danger border-transparent',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-medium', toneClasses[tone], className)}>{children}</span>;
}

/** Map common workflow statuses to tones and readable labels. */
export function statusTone(status: string): Tone {
  const s = status.toUpperCase();
  if (/(DECLIN|REJECT|FAIL|REVERS|CANCEL|EXPIRED|SUSPEND|DEAD|TERMINAT|INFECTED|MISMATCH|DISCREPANCY)/.test(s)) return 'danger';
  if (/(UNKNOWN|RECONCILIATION|EXCEPTION|ON_HOLD|ESCALAT|RETRY|ACTION_REQUIRED|INFORMATION_REQUIRED|PENDING_APPROVAL)/.test(s)) return 'warning';
  if (/(CONFIRMED|COMPLETED|DELIVERED|AUTHORIZED|READY_FOR_RELEASE|APPROVED|ACTIVE|SUCCEEDED|VERIFIED|BOOKED|CLEARED|SATISFIED|SIGNED|RESOLVED|MATCHED|ELIGIBLE)/.test(s)) return 'success';
  if (/(PENDING|PROCESSING|REVIEW|SUBMITT|IN_PROGRESS|INITIATED|QUEUED|DISPATCHED|OPEN|DRAFT)/.test(s)) return 'info';
  return 'neutral';
}

export function humanize(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={statusTone(status)}>{label ?? humanize(status)}</Badge>;
}

export function Alert({ tone = 'info', title, children, action, className }: { tone?: 'info' | 'success' | 'warning' | 'danger' | 'gold'; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  return (
    <div role={role} className={cn('flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm', toneClasses[tone], className)}>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-fg/80')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-surface-2', className ?? 'h-4 w-full')} />;
}

export function LoadingBlock({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i % 3 === 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gold-soft text-gold-strong" aria-hidden="true">
        {icon ?? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KeyValue({ items, columns = 2 }: { items: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }>; columns?: 1 | 2 | 3 }) {
  const grid = columns === 1 ? 'sm:grid-cols-1' : columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', grid)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-subtle">{it.label}</dt>
          <dd className={cn('mt-1 break-words text-sm text-fg', it.mono && 'font-mono text-[13px]')}>{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'gold' | 'default' }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums tracking-tight', tone === 'gold' ? 'text-gold-strong' : 'text-fg')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- Tabs -----------------------------------------------------------------------------

export function Tabs({ tabs, value, onChange, label }: { tabs: Array<{ id: string; label: ReactNode; count?: number }>; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            value === t.id ? 'border-gold text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-sm bg-surface-2 px-1.5 py-0.5 text-2xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Dialog ------------------------------------------------------------------------------

export function Dialog({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((x) => !x.hasAttribute('disabled'));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-lg border border-border bg-surface shadow-md sm:rounded-lg', width)}>
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Misc --------------------------------------------------------------------------------

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-live="polite"
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function SandboxBanner({ note }: { note?: string }) {
  return (
    <div role="note" className="w-full border-b border-warning/30 bg-warning-soft px-4 py-1.5 text-center text-xs font-medium text-warning">
      SANDBOX — simulated integrations, synthetic data, no real money moves{note ? ` · ${note}` : ''}
    </div>
  );
}

export interface StepperStep {
  id: string;
  label: string;
}

export function Stepper({ steps, current }: { steps: StepperStep[]; current: number }) {
  return (
    <ol className="flex w-full items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s.id} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={state === 'current' ? 'step' : undefined}>
            <span className={cn('h-1 w-full rounded-full', state === 'todo' ? 'bg-border' : 'bg-gold')} />
            <span className={cn('truncate text-2xs font-medium sm:text-xs', state === 'todo' ? 'text-subtle' : 'text-fg')}>
              <span className="sr-only">{state === 'done' ? 'Completed: ' : state === 'current' ? 'Current: ' : 'Upcoming: '}</span>
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Timeline({ items }: { items: Array<{ title: ReactNode; meta?: ReactNode; description?: ReactNode; tone?: Tone }> }) {
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {items.map((it, i) => (
        <li key={i} className="relative">
          <span className={cn('absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-surface', it.tone === 'danger' || it.tone === 'negative' ? 'bg-danger' : it.tone === 'warning' ? 'bg-warning' : it.tone === 'success' ? 'bg-success' : 'bg-gold')} />
          <p className="text-sm font-medium text-fg">{it.title}</p>
          {it.meta && <p className="text-xs text-subtle">{it.meta}</p>}
          {it.description && <p className="mt-0.5 text-sm text-muted">{it.description}</p>}
        </li>
      ))}
    </ol>
  );
}
