'use client';

import type { ReactNode } from 'react';
import { cn, humanize } from '@araf/ui';
import { IconCheck, IconStop } from './icons';

/**
 * Unmistakable goods-release verdict. AUTHORIZED is the ONLY state in which goods may be
 * handed over; every other state reads as "do not release".
 */
export function ReleaseVerdict({ status, reason, compact, children }: { status: string | undefined; reason?: string | null; compact?: boolean; children?: ReactNode }) {
  const authorized = status === 'AUTHORIZED';
  const consumed = status === 'CONSUMED';
  const title = authorized ? 'AUTHORISED — you may release the goods' : consumed ? 'RELEASED — goods already handed over' : status === 'SUSPENDED' ? 'SUSPENDED — do not release the goods' : status === 'REVOKED' ? 'REVOKED — do not release the goods' : 'NOT AUTHORISED — do not release the goods';
  const body = authorized
    ? 'The Bank has confirmed the vendor payment and all contractual conditions. Hand over only the authorised items to the customer.'
    : consumed
      ? 'This release authorisation was used when dispatch or collection was recorded.'
      : status === 'SUSPENDED'
        ? `The Bank suspended this release${reason ? ` (${humanize(reason)})` : ''}. Hold the goods until a new authorisation is issued.`
        : 'Payment confirmation, a customer screenshot or a redirect is not authority to release goods. Wait for the Bank’s release authorisation.';
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-3 rounded-md border-2',
        compact ? 'px-3 py-2.5' : 'px-4 py-4',
        authorized ? 'border-success bg-success-soft text-success' : consumed ? 'border-border-strong bg-surface-2 text-fg' : 'border-danger bg-danger-soft text-danger',
      )}
    >
      <span className={cn('mt-0.5 flex shrink-0 items-center justify-center rounded-full', compact ? 'h-7 w-7' : 'h-9 w-9', authorized ? 'bg-success text-white' : consumed ? 'bg-ink text-ink-contrast' : 'bg-danger text-white')} aria-hidden="true">
        {authorized || consumed ? <IconCheck className={compact ? 'h-4 w-4' : 'h-5 w-5'} /> : <IconStop className={compact ? 'h-4 w-4' : 'h-5 w-5'} />}
      </span>
      <div className="min-w-0">
        <p className={cn('font-bold tracking-wide', compact ? 'text-sm' : 'text-base sm:text-lg')}>{title}</p>
        {!compact && <p className="mt-0.5 text-sm text-fg/80">{body}</p>}
        {children}
      </div>
    </div>
  );
}
