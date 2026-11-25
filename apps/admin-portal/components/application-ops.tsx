'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Field, Input, Select, cn, formatNaira, humanize } from '@araf/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { TERMINAL_STATES } from '@/lib/labels';
import { ActionDialog, Mono } from './common';
import { Icon } from './icons';
import type { AppDetail } from './application-types';

type OpId = 'invoice' | 'booking' | 'payment' | 'possession' | 'evaluate' | 'suspend' | 'reinstate' | 'refund' | 'cancel';

interface OpDef {
  id: OpId;
  group: string;
  title: string;
  description: ReactNode;
  perm: string;
  enabled: boolean;
  blocked?: ReactNode;
  tone?: 'primary' | 'gold' | 'danger';
  label: string;
}

const humanList = (xs: string[]) => xs.map((x) => humanize(x)).join(', ');

export function OperationsPanel({ app, onChanged }: { app: AppDetail; onChanged: () => void }) {
  const { can } = useSession();
  const [open, setOpen] = useState<OpId | null>(null);
  const [gateResult, setGateResult] = useState<{ authorized: boolean; blockers: string[]; pending_conditions?: string[]; reference?: string } | null>(null);
  const [refundTarget, setRefundTarget] = useState('');
  const [refundAmount, setRefundAmount] = useState('');

  const invoice = app.financing_documents.find((d) => d.type === 'VENDOR_INVOICE');
  const cond = (code: string) => app.conditions.find((c) => c.code === code)?.status;
  const confirmedPayment = app.payments.find((p) => p.status === 'CONFIRMED');
  const terminal = TERMINAL_STATES.includes(app.status);
  const refundable = [...app.cancellations.filter((c) => c.requires_reversal && c.status === 'REQUESTED').map((c) => ({ id: `c:${c.id}`, label: `Cancellation — ${c.reason}` })), ...app.returns.filter((r) => r.status === 'REQUESTED').map((r) => ({ id: `r:${r.id}`, label: `${humanize(r.type)} — ${r.reason}` }))];

  const ops: OpDef[] = [
    {
      id: 'invoice', group: 'Credit administration (CAD)', title: 'Verify vendor invoice', perm: 'cad.conditions.manage', label: 'Verify invoice',
      description: 'Confirm the vendor invoice is issued in the Bank’s name for the approved asset and amount.',
      enabled: invoice?.status === 'ISSUED',
      blocked: !invoice ? 'No vendor invoice has been issued yet (issued after financing approval).' : invoice.status !== 'ISSUED' ? `Invoice is already ${humanize(invoice.status).toLowerCase()}.` : undefined,
    },
    {
      id: 'booking', group: 'Credit administration (CAD)', title: 'Request booking in core banking', perm: 'booking.execute', label: 'Request booking',
      description: 'Books the approved financing in core banking (idempotent). Booking is not payment.',
      enabled: app.status === 'BOOKING_PENDING',
      blocked: app.booking?.status === 'BOOKED' ? `Already booked (${app.booking.reference}).` : app.status !== 'BOOKING_PENDING' ? `Available when the application is “Booking pending” (currently ${humanize(app.status)}). Documents must be signed and the mandate active.` : undefined,
    },
    {
      id: 'possession', group: 'Credit administration (CAD)', title: 'Record possession evidence', perm: 'cad.conditions.manage', label: 'Record evidence',
      description: 'Evidence of the Bank’s ownership / constructive possession of the asset after the vendor is paid.',
      enabled: cond('ASSET_ACQUIRED') === 'SATISFIED' && cond('POSSESSION_EVIDENCED') !== 'SATISFIED',
      blocked: cond('POSSESSION_EVIDENCED') === 'SATISFIED' ? 'Possession is already evidenced.' : cond('ASSET_ACQUIRED') !== 'SATISFIED' ? 'Requires the asset to be acquired (vendor payment confirmed) first.' : undefined,
    },
    {
      id: 'payment', group: 'Settlement', title: 'Initiate vendor payment', perm: 'payment.initiate', label: 'Create instruction', tone: 'gold',
      description: 'Creates a payment instruction (maker). It executes only after a Finance Officer approves it.',
      enabled: Array.isArray(app.payment_blockers) && app.payment_blockers.length === 0,
      blocked: app.payment_blockers === null ? `Available once financing is booked (currently ${humanize(app.status)}).` : app.payment_blockers.length ? <>Blocked by: <strong>{humanList(app.payment_blockers)}</strong></> : undefined,
    },
    {
      id: 'evaluate', group: 'Goods release', title: 'Evaluate release gate', perm: 'application.read', label: 'Evaluate gate',
      description: 'Re-checks every release condition. Authorises release only when payment is confirmed by the authoritative source and all conditions hold.',
      enabled: true,
    },
    {
      id: 'suspend', group: 'Goods release', title: 'Suspend release authorisation', perm: 'release.suspend', label: 'Suspend release', tone: 'danger',
      description: 'Places a compliance hold — the merchant is told not to release the goods.',
      enabled: app.release?.status === 'AUTHORIZED',
      blocked: !app.release ? 'No release authorisation exists yet.' : app.release.status !== 'AUTHORIZED' ? `Release is ${humanize(app.release.status).toLowerCase()}.` : undefined,
    },
    {
      id: 'reinstate', group: 'Goods release', title: 'Reinstate release authorisation', perm: 'release.suspend', label: 'Reinstate',
      description: 'Removes the compliance hold and re-authorises release if the gate still passes.',
      enabled: app.release?.status === 'SUSPENDED',
      blocked: app.release?.status !== 'SUSPENDED' ? 'Only a suspended release can be reinstated.' : undefined,
    },
    {
      id: 'refund', group: 'Cancellations & refunds', title: 'Start vendor refund', perm: 'refund.manage', label: 'Start refund',
      description: 'For a cancellation after payment or an approved return. Creates a refund request for checker approval (refund.approve).',
      enabled: !!confirmedPayment,
      blocked: !confirmedPayment ? 'Requires a confirmed vendor payment to refund.' : undefined,
    },
    {
      id: 'cancel', group: 'Cancellations & refunds', title: 'Cancel application', perm: 'application.cancel', label: 'Cancel application', tone: 'danger',
      description: 'Before payment this cancels immediately. After a payment instruction exists it opens a controlled reversal (refund) workflow.',
      enabled: !terminal,
      blocked: terminal ? `The application is already ${humanize(app.status).toLowerCase()}.` : undefined,
    },
  ];

  const groups = [...new Set(ops.map((o) => o.group))];

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Each step is distinct">
        Approval (ARAF) ≠ booking (core banking) ≠ payment instruction (maker) ≠ payment confirmed (authoritative source) ≠ release authorised (all conditions). Actions are enabled only when their preconditions hold; the platform re-checks every rule.
      </Alert>
      {gateResult && (
        <Alert
          tone={gateResult.authorized ? 'success' : 'warning'}
          title={gateResult.authorized ? `Release authorised${gateResult.reference ? ` — ${gateResult.reference}` : ''}` : 'Release not authorised'}
          action={<Button size="sm" variant="ghost" onClick={() => setGateResult(null)}>Dismiss</Button>}
        >
          {gateResult.authorized ? 'The merchant has been notified that goods may be released.' : (
            <ul className="list-disc pl-5">
              {gateResult.blockers.map((b) => <li key={b}>Blocked: {humanize(b)}</li>)}
              {(gateResult.pending_conditions ?? []).map((c) => <li key={c}>Pending condition: {humanize(c)}</li>)}
            </ul>
          )}
        </Alert>
      )}
      {groups.map((g) => (
        <div key={g}>
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-subtle">{g}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {ops.filter((o) => o.group === g).map((o) => {
              const allowed = can(o.perm);
              return (
                <li key={o.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{o.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{o.description}</p>
                    {!allowed ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-subtle">{Icon.lock('h-3.5 w-3.5')} Requires <Mono>{o.perm}</Mono></p>
                    ) : !o.enabled && o.blocked ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning"><span className="mt-0.5">{Icon.lock('h-3.5 w-3.5')}</span><span>{o.blocked}</span></p>
                    ) : null}
                  </div>
                  <Button size="sm" className="shrink-0 self-start" variant={o.tone === 'danger' ? 'danger' : o.tone === 'gold' ? 'gold' : 'secondary'} disabled={!allowed || !o.enabled} onClick={() => setOpen(o.id)}>
                    {o.label}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <ActionDialog open={open === 'invoice'} onClose={() => setOpen(null)} title="Verify vendor invoice" description={`Confirm the invoice for ${app.reference} is in the Bank’s name and matches the approved asset and amount (${formatNaira(app.amounts.financing)}).`} confirmLabel="Mark invoice verified" onConfirm={() => api.post(`/api/admin/applications/${app.id}/invoice/verify`)} successMessage="Vendor invoice verified" onDone={onChanged} />
      <ActionDialog
        open={open === 'booking'}
        onClose={() => setOpen(null)}
        title="Request booking in core banking"
        description="The financing is booked against the customer’s account with an idempotency key. If the outcome is unknown it is reconciled before any retry."
        confirmLabel="Request booking"
        onConfirm={() => api.post<{ status: string; booking_reference?: string; reason?: string; message?: string }>(`/api/admin/applications/${app.id}/booking`)}
        successMessage={(r) => (r.status === 'BOOKED' ? `Booked — ${r.booking_reference}` : r.status === 'UNKNOWN' ? 'Booking outcome unknown — will be reconciled' : `Booking failed: ${r.reason ?? r.status}`)}
        onDone={onChanged}
      />
      <ActionDialog
        open={open === 'payment'}
        onClose={() => setOpen(null)}
        title="Initiate vendor payment"
        description="Creates a payment instruction to the vendor’s approved settlement account. It requires Finance Officer approval before execution."
        confirmLabel="Create payment instruction"
        tone="gold"
        onConfirm={() => api.post<{ reference: string; status: string }>(`/api/admin/applications/${app.id}/vendor-payment`)}
        successMessage={(r) => `Instruction ${r.reference} created — awaiting approval`}
        onDone={onChanged}
      >
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-subtle">Amount (financed cost)</dt><dd className="font-semibold tabular-nums">{formatNaira(app.amounts.financing)}</dd></div>
          <div><dt className="text-xs text-subtle">Booking</dt><dd>{app.booking?.reference ?? '—'}</dd></div>
        </dl>
      </ActionDialog>
      <ActionDialog open={open === 'possession'} onClose={() => setOpen(null)} title="Record possession evidence" description="Describe the evidence of the Bank’s ownership or constructive possession (e.g. vendor delivery note to the Bank’s agent, warehouse receipt reference)." confirmLabel="Record evidence" reason={{ label: 'Evidence', minLength: 5, placeholder: 'e.g. Vendor delivery note DN-2231 to Bank agent, 14:05' }} onConfirm={(evidence) => api.post<{ authorized: boolean; blockers: string[]; pending_conditions?: string[]; reference?: string }>(`/api/admin/applications/${app.id}/possession`, { evidence })} successMessage="Possession evidence recorded" onDone={(r) => { setGateResult(r); onChanged(); }} />
      <ActionDialog open={open === 'evaluate'} onClose={() => setOpen(null)} title="Evaluate release gate" description="Re-evaluates the goods release gate now. If every condition holds, a release authorisation is issued and the merchant notified." confirmLabel="Evaluate" onConfirm={() => api.post<{ authorized: boolean; blockers: string[]; pending_conditions?: string[]; reference?: string }>(`/api/admin/applications/${app.id}/release/evaluate`)} successMessage={(r) => (r.authorized ? 'Release authorised' : 'Release gate evaluated — not authorised')} onDone={(r) => { setGateResult(r); onChanged(); }} />
      <ActionDialog open={open === 'suspend'} onClose={() => setOpen(null)} title="Suspend release authorisation" description="A compliance hold is placed and the merchant is told not to release the goods." confirmLabel="Suspend release" tone="danger" reason={{ label: 'Reason', minLength: 3 }} onConfirm={(reason) => api.post(`/api/admin/applications/${app.id}/release/suspend`, { reason })} successMessage="Release suspended" onDone={onChanged} />
      <ActionDialog open={open === 'reinstate'} onClose={() => setOpen(null)} title="Reinstate release authorisation" description="The compliance hold is removed and the release gate re-evaluated." confirmLabel="Reinstate" reason={{ label: 'Reason', minLength: 3 }} onConfirm={(reason) => api.post(`/api/admin/applications/${app.id}/release/reinstate`, { reason })} successMessage="Release reinstated" onDone={onChanged} />
      <ActionDialog
        open={open === 'refund'}
        onClose={() => setOpen(null)}
        title="Start vendor refund"
        description={`Requests a refund from the vendor of up to ${formatNaira(confirmedPayment?.amount)}. A checker with refund.approve must approve it.`}
        confirmLabel="Request refund"
        validate={() => {
          const n = refundAmount ? Number(refundAmount) : undefined;
          if (n !== undefined && (!Number.isFinite(n) || n <= 0)) return 'Enter a positive amount, or leave blank for the full payment.';
          if (n !== undefined && confirmedPayment && n * 100 > confirmedPayment.amount) return 'The refund cannot exceed the confirmed payment.';
          return null;
        }}
        onConfirm={() => {
          const body: Record<string, unknown> = {};
          if (refundTarget.startsWith('c:')) body.cancellation_id = refundTarget.slice(2);
          if (refundTarget.startsWith('r:')) body.return_id = refundTarget.slice(2);
          if (refundAmount) body.amount_naira = Number(refundAmount);
          return api.post<{ reference: string }>(`/api/admin/applications/${app.id}/refunds`, body);
        }}
        successMessage={(r) => `Refund ${r.reference} requested — awaiting approval`}
        onDone={() => { setRefundTarget(''); setRefundAmount(''); onChanged(); }}
      >
        <div className="space-y-4">
          <Field label="Related request" hint={refundable.length ? 'Approving links the refund to this cancellation or return.' : 'No open cancellation or return — the refund will not be linked.'}>
            {(ids) => (
              <Select id={ids.id} aria-describedby={ids.describedBy} value={refundTarget} onChange={(e) => setRefundTarget(e.target.value)}>
                <option value="">Not linked</option>
                {refundable.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Amount (₦)" hint="Leave blank to refund the full confirmed payment.">
            {(ids) => <Input id={ids.id} inputMode="decimal" aria-describedby={ids.describedBy} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ''))} />}
          </Field>
        </div>
      </ActionDialog>
      <ActionDialog
        open={open === 'cancel'}
        onClose={() => setOpen(null)}
        title={`Cancel ${app.reference}`}
        description={app.payments.some((p) => !['FAILED', 'REVERSED'].includes(p.status)) ? 'A payment instruction exists, so this opens a cancellation request and a reversal workflow instead of cancelling immediately.' : 'The application is cancelled immediately and any exposure reservation released.'}
        confirmLabel="Cancel application"
        tone="danger"
        irreversible
        reason={{ label: 'Reason for cancellation', minLength: 3 }}
        onConfirm={(reason) => api.post<{ status: string }>(`/api/admin/applications/${app.id}/cancel`, { reason })}
        successMessage={(r) => (r.status === 'CANCELLED' ? 'Application cancelled' : 'Cancellation requested — reversal required')}
        onDone={onChanged}
      />
    </div>
  );
}

/** The financing lifecycle as distinct, verifiable milestones. */
export function Milestones({ app }: { app: AppDetail }) {
  const reached = new Set(app.history.filter((h) => h.machine === 'APPLICATION').map((h) => h.to));
  const anyPayment = app.payments.find((p) => !['FAILED', 'REVERSED'].includes(p.status)) ?? app.payments[app.payments.length - 1];
  const confirmed = app.payments.find((p) => p.status === 'CONFIRMED');
  const steps: Array<{ label: string; state: 'done' | 'current' | 'todo' | 'failed'; detail: string; note: string }> = [
    { label: 'Eligibility', note: 'Indicative only', state: reached.has('ELIGIBLE') ? 'done' : 'todo', detail: app.amounts.eligible ? formatNaira(app.amounts.eligible, { noKobo: true }) : reached.has('ELIGIBLE') ? 'Eligible' : 'Not yet' },
    { label: 'Submitted to ARAF', note: 'Not approval', state: app.araf?.status === 'ACKNOWLEDGED' || reached.has('ARAF_SUBMITTED') ? 'done' : app.araf ? 'current' : 'todo', detail: app.araf?.reference ?? (app.araf ? humanize(app.araf.status) : 'Not yet') },
    { label: 'Approved', note: 'ARAF decision', state: reached.has('FINANCING_APPROVED') ? 'done' : app.status === 'DECLINED' ? 'failed' : 'todo', detail: reached.has('FINANCING_APPROVED') ? 'Approved' : app.status === 'DECLINED' ? 'Declined' : 'Not yet' },
    { label: 'Booked', note: 'Core banking', state: app.booking?.status === 'BOOKED' ? 'done' : app.booking?.status === 'FAILED' ? 'failed' : app.booking ? 'current' : 'todo', detail: app.booking?.reference ?? (app.booking ? humanize(app.booking.status) : 'Not yet') },
    { label: 'Payment initiated', note: 'Instruction (maker)', state: anyPayment ? (anyPayment.status === 'FAILED' ? 'failed' : 'done') : 'todo', detail: anyPayment ? `${anyPayment.reference} · ${humanize(anyPayment.status)}` : 'Not yet' },
    { label: 'Payment confirmed', note: 'Authoritative source', state: confirmed?.authoritative ? 'done' : confirmed ? 'current' : 'todo', detail: confirmed ? (confirmed.authoritative ? 'Confirmed' : 'Not authoritative') : 'Not yet' },
    { label: 'Release authorised', note: 'All conditions met', state: app.release?.status === 'AUTHORIZED' || app.release?.status === 'CONSUMED' ? 'done' : app.release?.status === 'SUSPENDED' ? 'failed' : 'todo', detail: app.release ? `${app.release.reference} · ${humanize(app.release.status)}` : 'Not yet' },
    { label: 'Delivered', note: 'Merchant / customer', state: reached.has('GOODS_DELIVERED') ? 'done' : reached.has('GOODS_DISPATCHED') ? 'current' : 'todo', detail: reached.has('GOODS_DELIVERED') ? 'Delivered' : reached.has('GOODS_DISPATCHED') ? 'Dispatched' : 'Not yet' },
  ];
  return (
    <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4 2xl:grid-cols-8" aria-label="Financing milestones">
      {steps.map((s, i) => (
        <li key={s.label} className="relative bg-surface px-3.5 py-3">
          <span className={cn('absolute inset-x-0 top-0 h-[3px]', s.state === 'done' ? 'bg-success' : s.state === 'current' ? 'bg-gold' : s.state === 'failed' ? 'bg-danger' : 'bg-transparent')} aria-hidden="true" />
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-subtle">
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold', s.state === 'done' ? 'bg-success text-white' : s.state === 'failed' ? 'bg-danger text-white' : s.state === 'current' ? 'bg-gold text-white' : 'border border-border-strong text-subtle')}>
              {s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : i + 1}
            </span>
            {s.label}
          </p>
          <p className={cn('mt-1.5 break-words text-[13px] leading-snug', s.state === 'todo' ? 'text-subtle' : 'font-medium text-fg')}>{s.detail}</p>
          <p className="text-2xs text-subtle">{s.note}</p>
          <span className="sr-only">{s.state === 'done' ? 'Completed' : s.state === 'current' ? 'In progress' : s.state === 'failed' ? 'Failed or blocked' : 'Not reached'}</span>
        </li>
      ))}
    </ol>
  );
}

export function MaybeBadge({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return ok ? <Badge tone="success">{yes}</Badge> : <Badge tone="warning">{no}</Badge>;
}

