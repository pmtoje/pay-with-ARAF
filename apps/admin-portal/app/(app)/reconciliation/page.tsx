'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, Stat, StatusBadge, Tabs, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { ActionDialog, Async, Guard, Mono } from '@/components/common';
import { Icon } from '@/components/icons';

interface Run { id: string; startedAt: string; completedAt: string | null; triggeredBy: string; checked: number; discrepancies: number }
interface Finding { id: string; runId: string; applicationId: string | null; instructionId: string | null; type: string; severity: string; detail: string; status: string; resolution: string | null; resolvedAt: string | null; createdAt: string }
interface Payment { id: string; reference: string; application_id: string; status: string; amount: number; beneficiary: string; provider_reference: string | null; reconciliation: string | null; simulated: boolean; confirmed_at: string | null; created_at: string }
interface Recon { runs: Run[]; findings: Finding[]; payments: Payment[] }

export default function ReconciliationPage() {
  return <Guard perm="payment.reconcile"><Reconciliation /></Guard>;
}

function Reconciliation() {
  const state = useApi<Recon>('/api/admin/reconciliation');
  const [runOpen, setRunOpen] = useState(false);
  const [resolve, setResolve] = useState<Finding | null>(null);
  const [tab, setTab] = useState('open');
  useEffect(() => { document.title = 'Reconciliation · Pay with ARAF admin'; }, []);
  const d = state.data;
  const open = d?.findings.filter((f) => f.status === 'OPEN') ?? [];
  const last = d?.runs[0];

  return (
    <>
      <PageHeader
        eyebrow="Settlement"
        title="Reconciliation"
        description="Compares vendor payments, bookings, release authorisations and refunds against authoritative sources. Discrepancies become findings that must be resolved with a reason."
        actions={<Button variant="gold" onClick={() => setRunOpen(true)}>{Icon.reconcile()} Run reconciliation</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open findings" value={<span className={open.length ? 'text-danger' : ''}>{d ? open.length : '—'}</span>} />
        <Stat label="Critical open" value={d ? open.filter((f) => f.severity === 'CRITICAL').length : '—'} />
        <Stat label="Last run" value={<span className="text-base">{last ? formatDateTime(last.startedAt) : '—'}</span>} hint={last ? `${last.checked} checked · ${last.discrepancies} discrepancies` : 'Never run'} />
        <Stat label="Payment instructions" value={d?.payments.length ?? '—'} hint="Most recent 100" />
      </div>
      <Card>
        <div className="px-4 pt-2">
          <Tabs label="Reconciliation views" value={tab} onChange={setTab} tabs={[{ id: 'open', label: 'Open findings', count: d ? open.length : undefined }, { id: 'all', label: 'All findings', count: d?.findings.length }, { id: 'runs', label: 'Runs', count: d?.runs.length }, { id: 'payments', label: 'Payment instructions', count: d?.payments.length }]} />
        </div>
        <Async state={state} rows={6}>
          {(data) => (
            <>
              {(tab === 'open' || tab === 'all') && (
                <DataTable
                  caption="Reconciliation findings"
                  rows={tab === 'open' ? open : data.findings}
                  rowKey={(f) => f.id}
                  empty={<EmptyState title={tab === 'open' ? 'No open findings' : 'No findings recorded'} description="Run reconciliation to check payments, bookings and releases." icon={Icon.check('h-5 w-5')} />}
                  columns={[
                    { key: 't', header: 'Finding', sortValue: (f) => f.type, cell: (f) => <span className="font-medium">{humanize(f.type)}</span> },
                    { key: 'sv', header: 'Severity', sortValue: (f) => f.severity, cell: (f) => <Badge tone={f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'danger' : 'warning'}>{humanize(f.severity)}</Badge> },
                    { key: 'd', header: 'Detail', cell: (f) => <span className="text-sm text-muted">{f.detail}</span> },
                    { key: 'a', header: 'Application', cell: (f) => (f.applicationId ? <Link className="text-sm font-medium text-gold-strong hover:underline" href={`/applications/${f.applicationId}`}>Open</Link> : '—') },
                    { key: 's', header: 'Status', cell: (f) => <span className="flex flex-col gap-0.5"><StatusBadge status={f.status} />{f.resolution && <span className="text-2xs text-subtle">{f.resolution}</span>}</span> },
                    { key: 'c', header: 'Found', sortValue: (f) => f.createdAt, cell: (f) => <span className="whitespace-nowrap text-muted">{formatDateTime(f.createdAt)}</span> },
                    { key: 'x', header: '', cell: (f) => (f.status === 'OPEN' ? <Button size="sm" variant="secondary" onClick={() => setResolve(f)}>Resolve</Button> : null) },
                  ]}
                />
              )}
              {tab === 'runs' && (
                <DataTable caption="Reconciliation runs" rows={data.runs} rowKey={(r) => r.id} empty={<EmptyState title="No runs yet" />} columns={[
                  { key: 's', header: 'Started', cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.startedAt)}</span> },
                  { key: 'c', header: 'Completed', cell: (r) => (r.completedAt ? <span className="whitespace-nowrap text-muted">{formatDateTime(r.completedAt)}</span> : <Badge tone="info">Running</Badge>) },
                  { key: 'b', header: 'Triggered by', cell: (r) => r.triggeredBy },
                  { key: 'k', header: 'Records checked', align: 'right', cell: (r) => r.checked },
                  { key: 'd', header: 'Discrepancies', align: 'right', cell: (r) => <span className={r.discrepancies ? 'font-semibold text-danger' : ''}>{r.discrepancies}</span> },
                ]} />
              )}
              {tab === 'payments' && (
                <DataTable caption="Payment instructions" rows={data.payments} rowKey={(p) => p.id} empty={<EmptyState title="No payment instructions" />} columns={[
                  { key: 'r', header: 'Reference', cell: (p) => <Mono>{p.reference}</Mono>, sortValue: (p) => p.reference },
                  { key: 'a', header: 'Application', cell: (p) => <Link className="text-sm font-medium text-gold-strong hover:underline" href={`/applications/${p.application_id}`}>Open</Link> },
                  { key: 'am', header: 'Amount', align: 'right', cell: (p) => formatNaira(p.amount), sortValue: (p) => p.amount },
                  { key: 'b', header: 'Beneficiary', cell: (p) => <Mono>{p.beneficiary}</Mono> },
                  { key: 's', header: 'Status', cell: (p) => <span className="flex items-center gap-1.5"><StatusBadge status={p.status} />{p.simulated && <Badge tone="warning">Sim</Badge>}</span>, sortValue: (p) => p.status },
                  { key: 'rc', header: 'Reconciliation', cell: (p) => (p.reconciliation ? <StatusBadge status={p.reconciliation} /> : '—') },
                  { key: 'cf', header: 'Confirmed', cell: (p) => <span className="whitespace-nowrap text-muted">{formatDateTime(p.confirmed_at)}</span> },
                  { key: 'c', header: 'Created', cell: (p) => <span className="whitespace-nowrap text-muted">{formatDateTime(p.created_at)}</span>, sortValue: (p) => p.created_at },
                ]} />
              )}
            </>
          )}
        </Async>
      </Card>
      <ActionDialog open={runOpen} onClose={() => setRunOpen(false)} title="Run reconciliation" description="Queries the payment system for every in-flight and confirmed instruction, then checks for duplicates, amount and beneficiary mismatches, missing confirmations and booking/release inconsistencies." confirmLabel="Run now" tone="gold" onConfirm={() => api.post<{ checked: number; discrepancies: number }>('/api/admin/reconciliation/run')} successMessage={(r) => `Reconciliation complete — ${r.checked} checked, ${r.discrepancies} discrepanc${r.discrepancies === 1 ? 'y' : 'ies'}`} onDone={state.reload} />
      <ActionDialog open={!!resolve} onClose={() => setResolve(null)} title={`Resolve finding — ${resolve ? humanize(resolve.type) : ''}`} description={resolve?.detail} confirmLabel="Resolve finding" reason={{ label: 'Resolution', minLength: 3, hint: 'Explain how the discrepancy was investigated and settled.' }} onConfirm={(reason) => api.post(`/api/admin/reconciliation/findings/${resolve!.id}/resolve`, { reason })} successMessage="Finding resolved" onDone={state.reload} />
    </>
  );
}

