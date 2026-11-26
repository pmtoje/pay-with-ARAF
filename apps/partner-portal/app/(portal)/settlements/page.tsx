'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, LoadingBlock, PageHeader, Stat, StatusBadge, Tabs, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { api, useApi, type ApiState } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Refund, Settlement } from '@/lib/types';
import { ConfirmDialog, ErrorState, Mono, SelectFilter, SimulatedBadge, useToast } from '@/components/common';
import { RequirePermission } from '@/components/gate';

const GROUPS: Record<string, string[]> = {
  confirmed: ['CONFIRMED'],
  pending: ['NOT_INITIATED', 'PENDING_APPROVAL', 'INITIATED', 'PROCESSING', 'UNKNOWN', 'RECONCILIATION_REQUIRED'],
  failed: ['FAILED'],
  reversed: ['REVERSED'],
};

export default function SettlementsPage() {
  return (
    <RequirePermission perm="p.settlement.read">
      <SettlementsInner />
    </RequirePermission>
  );
}

function SettlementsInner() {
  const [tab, setTab] = useState<'payments' | 'refunds' | 'fees'>('payments');
  const fees = useApi<FeesView>('/api/partner-portal/fees');
  const payments = useApi<{ data: Settlement[] }>('/api/partner-portal/settlements');
  const refunds = useApi<Refund[]>('/api/partner-portal/refunds');
  return (
    <>
      <PageHeader
        title="Settlements"
        description="Vendor payments made by The Alternative Bank for financed orders, and vendor refunds for approved cancellations and returns."
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={payments.loading || refunds.loading}
            onClick={() => {
              payments.reload();
              refunds.reload();
            }}
          >
            Refresh
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs
          label="Settlement views"
          value={tab}
          onChange={(v) => setTab(v as 'payments' | 'refunds' | 'fees')}
          tabs={[
            { id: 'payments', label: 'Vendor payments', count: payments.data?.data.length },
            { id: 'refunds', label: 'Refunds', count: refunds.data?.length },
            { id: 'fees', label: 'ARAF fees & invoices', count: fees.data?.invoices.length },
          ]}
        />
      </div>
      {tab === 'payments' ? <Payments state={payments} /> : tab === 'refunds' ? <Refunds state={refunds} /> : <Fees state={fees} />}
    </>
  );
}

function Payments({ state }: { state: ApiState<{ data: Settlement[] }> }) {
  const [group, setGroup] = useState('');
  const rows = (state.data?.data ?? []).filter((r) => !group || GROUPS[group].includes(r.status));
  const all = state.data?.data ?? [];
  const confirmed = all.filter((r) => r.status === 'CONFIRMED');
  const pending = all.filter((r) => GROUPS.pending.includes(r.status));
  return (
    <>
      {state.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Confirmed payments" value={confirmed.length} />
          <Stat label="Confirmed value" value={formatNaira(confirmed.reduce((s, r) => s + (r.amount ?? 0), 0), { compact: true })} tone="gold" />
          <Stat label="Pending" value={pending.length} hint="Not yet confirmed — do not release" />
          <Stat label="Failed / reversed" value={all.filter((r) => r.status === 'FAILED' || r.status === 'REVERSED').length} />
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
          <SelectFilter
            label="Payment status"
            className="w-56"
            value={group}
            onChange={setGroup}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'confirmed', label: 'Confirmed' },
              { value: 'pending', label: 'Pending' },
              { value: 'failed', label: 'Failed' },
              { value: 'reversed', label: 'Reversed' },
            ]}
          />
          <p className="text-xs text-muted">Latest 200 instructions · amounts in Naira</p>
        </div>
        {state.error ? (
          <ErrorState error={state.error} onRetry={state.reload} title="Settlements could not be loaded" />
        ) : !state.data ? (
          <LoadingBlock rows={6} label="Loading settlements" />
        ) : (
          <DataTable
            caption="Vendor payments"
            rows={rows}
            rowKey={(r) => r.payment_reference}
            empty={<EmptyState title={group ? 'No payments with this status' : 'No vendor payments yet'} description="Vendor payments are created after financing is approved and booked." />}
            columns={[
              { key: 'ref', header: 'Payment ref', cell: (r) => <span className="flex items-center gap-2"><Mono className="font-medium">{r.payment_reference}</Mono><SimulatedBadge simulated={r.simulated} /></span>, sortValue: (r) => r.payment_reference },
              { key: 'app', header: 'Application', cell: (r) => (r.application_reference ? <Link className="font-mono text-[13px] underline-offset-4 hover:underline" href={`/applications/${encodeURIComponent(r.application_reference)}`}>{r.application_reference}</Link> : '—') },
              { key: 'order', header: 'Order', cell: (r) => <Mono>{r.merchant_order_reference ?? '—'}</Mono> },
              { key: 'vendor', header: 'Vendor', cell: (r) => <span className="whitespace-nowrap">{r.vendor_name ?? r.vendor_reference ?? '—'}</span> },
              { key: 'amount', header: 'Amount', align: 'right', cell: (r) => formatNaira(r.amount), sortValue: (r) => r.amount ?? 0 },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
              { key: 'recon', header: 'Reconciliation', cell: (r) => <StatusBadge status={r.reconciliation_status} /> },
              { key: 'benef', header: 'Beneficiary', cell: (r) => <span className="whitespace-nowrap text-muted">{[r.beneficiary_bank, r.beneficiary_account].filter(Boolean).join(' · ') || '—'}</span> },
              { key: 'provider', header: 'Provider ref', cell: (r) => <Mono className="text-muted">{r.provider_reference ?? '—'}</Mono> },
              { key: 'initiated', header: 'Initiated', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.initiated_at)}</span>, sortValue: (r) => r.initiated_at ?? '' },
              { key: 'confirmed', header: 'Confirmed', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.confirmed_at)}</span>, sortValue: (r) => r.confirmed_at ?? '' },
            ]}
          />
        )}
      </Card>
    </>
  );
}

function Refunds({ state }: { state: ApiState<Refund[]> }) {
  const { me, can } = useSession();
  const [target, setTarget] = useState<Refund | null>(null);
  const { toast, toastNode } = useToast();
  return (
    <Card>
      {toastNode}
      <div className="border-b border-border px-5 py-4 text-sm text-muted">
        When the Bank approves a cancellation after payment, or a return, the vendor must refund the Bank. Refund status is reconciled against the payment system.
      </div>
      {state.error ? (
        <ErrorState error={state.error} onRetry={state.reload} title="Refunds could not be loaded" />
      ) : !state.data ? (
        <LoadingBlock rows={4} label="Loading refunds" />
      ) : (
        <DataTable
          caption="Vendor refunds"
          rows={state.data}
          rowKey={(r) => r.reference}
          empty={<EmptyState title="No refunds" description="Refunds appear here after the Bank approves a cancellation or return." />}
          columns={[
            { key: 'ref', header: 'Refund ref', cell: (r) => <span className="flex items-center gap-2"><Mono className="font-medium">{r.reference}</Mono><SimulatedBadge simulated={r.simulated} /></span> },
            { key: 'app', header: 'Application', cell: (r) => (r.application_reference ? <Link className="font-mono text-[13px] underline-offset-4 hover:underline" href={`/applications/${encodeURIComponent(r.application_reference)}`}>{r.application_reference}</Link> : '—') },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={humanize(r.status)} /> },
            { key: 'expected', header: 'Expected', align: 'right', cell: (r) => formatNaira(r.expected_amount) },
            { key: 'received', header: 'Received', align: 'right', cell: (r) => formatNaira(r.received_amount) },
            { key: 'created', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span> },
            {
              key: 'act',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (r) =>
                me.sandbox && can('p.refund.request') && r.status === 'VENDOR_REFUND_PENDING' ? (
                  <Button size="sm" variant="secondary" onClick={() => setTarget(r)}>
                    Simulate vendor refund sent
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Simulate vendor refund"
        description={
          <>
            <Badge tone="warning">Sandbox only</Badge> Records that the vendor returned {formatNaira(target?.expected_amount)} to the Bank on the simulated payment rail, then runs refund reconciliation.
          </>
        }
        confirmLabel="Simulate refund sent"
        onConfirm={async () => {
          await api.post(`/api/partner-portal/refunds/${encodeURIComponent(target!.reference)}/simulate-vendor-refund`);
          setTarget(null);
          toast('Simulated vendor refund recorded.');
          state.reload();
        }}
      />
    </Card>
  );
}

interface FeesView {
  rate_percent: number;
  basis: string;
  uninvoiced: { count: number; total: number; items: Array<{ application_reference: string | null; kind: string; purchase_amount: number; rate_percent: number; fee: number; reason: string | null; accrued_at: string }> };
  invoices: Array<{ id: string; reference: string; period: string; fee_count: number; total: number; status: string; issued_at: string; paid_at: string | null; payment_reference: string | null }>;
}

/** ARAF's fee to you: a percentage of each financed purchase, invoiced monthly (never deducted from vendor payments). */
function Fees({ state }: { state: ApiState<FeesView> }) {
  const f = state.data;
  if (!f) return <Card><LoadingBlock rows={4} label="Loading fees" /></Card>;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="ARAF fee" value={`${f.rate_percent}%`} hint="Of the purchase amount, equity included" />
        <Stat label="Accrued, not yet invoiced" value={formatNaira(f.uninvoiced.total)} hint={`${f.uninvoiced.count} transaction${f.uninvoiced.count === 1 ? '' : 's'}`} />
        <Stat label="Invoices awaiting payment" value={formatNaira(f.invoices.filter((i) => i.status === 'ISSUED').reduce((s, i) => s + i.total, 0))} hint={`${f.invoices.filter((i) => i.status === 'ISSUED').length} open`} />
      </div>
      <Card>
        <div className="px-5 pt-4 text-sm text-muted">{f.basis}</div>
        <DataTable caption="Fees not yet invoiced" rows={f.uninvoiced.items} rowKey={(r) => `${r.application_reference}-${r.kind}`} dense empty={<p className="px-5 py-4 text-sm text-muted">Nothing accrued since your last invoice.</p>} columns={[
          { key: 'a', header: 'Application', cell: (r) => <span className="font-mono text-xs">{r.application_reference}</span> },
          { key: 'k', header: 'Type', cell: (r) => (r.kind === 'FEE' ? 'Fee' : <Badge tone="success">Credit — {humanize(r.reason ?? '')}</Badge>) },
          { key: 'p', header: 'Purchase amount', align: 'right', cell: (r) => formatNaira(r.purchase_amount) },
          { key: 'f', header: `Fee`, align: 'right', cell: (r) => <span className="font-medium">{formatNaira(r.fee)}</span> },
          { key: 't', header: 'Accrued', cell: (r) => formatDateTime(r.accrued_at) },
        ]} />
      </Card>
      <Card>
        <DataTable caption="Invoices" rows={f.invoices} rowKey={(i) => i.id} dense empty={<p className="px-5 py-4 text-sm text-muted">No invoices yet.</p>} columns={[
          { key: 'r', header: 'Invoice', cell: (i) => <span className="font-mono text-xs">{i.reference}</span> },
          { key: 'm', header: 'Month', cell: (i) => i.period },
          { key: 'n', header: 'Transactions', align: 'right', cell: (i) => i.fee_count },
          { key: 't', header: 'Amount due', align: 'right', cell: (i) => <span className="font-medium">{formatNaira(i.total)}</span> },
          { key: 's', header: 'Status', cell: (i) => <Badge tone={i.status === 'PAID' ? 'success' : 'warning'}>{i.status === 'PAID' ? 'Paid' : 'Awaiting payment'}</Badge> },
        ]} />
      </Card>
    </div>
  );
}
