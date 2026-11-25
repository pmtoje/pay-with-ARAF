'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Field, KeyValue, LoadingBlock, PageHeader, StatusBadge, Textarea, Timeline, cn, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ARAF_ACTIONS, ARAF_STAGES } from '@/lib/labels';
import { ErrorAlert, Guard, Mono, Segmented, useToast } from '@/components/common';
import { Icon } from '@/components/icons';

interface SimCase {
  id: string;
  araf_reference: string;
  application_reference: string;
  application_id: string | null;
  application_status: string | null;
  stage: string;
  financing_amount: number | null;
  created_at: string;
  actions: Array<{ stage: string; action: string; actor: string; note: string | null; at: string }>;
}

const STAGE_HELP: Record<string, string> = {
  RECEIVED: 'Submitted by Pay with ARAF',
  BUSINESS_EVALUATION: 'Business evaluation',
  CREDIT_REVIEW: 'Credit review',
  APPROVAL: 'Awaiting approval',
  INFO_REQUESTED: 'Waiting on customer',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export default function ArafSimulatorPage() {
  return <Guard perm="application.read"><Simulator /></Guard>;
}

function Simulator() {
  const [view, setView] = useState<'board' | 'table'>('board');
  const [selected, setSelected] = useState<string | null>(null);
  const state = useApi<SimCase[]>('/api/admin/araf-simulator/cases', { pollMs: 30_000 });
  useEffect(() => { document.title = 'ARAF simulator · Pay with ARAF admin'; }, []);
  const cases = state.data ?? [];
  const current = cases.find((c) => c.id === selected) ?? null;

  return (
    <>
      <div className="mb-5 flex items-start gap-3 rounded-lg border-2 border-dashed border-warning/60 bg-warning-soft px-4 py-3" role="note">
        <span className="mt-0.5 text-warning">{Icon.sandbox('h-5 w-5')}</span>
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-warning">Sandbox simulator — stands in for the existing ARAF workflow</p>
          <p className="mt-0.5 text-sm text-fg/80">The real approval hierarchy will be inherited from ARAF. Stages below are a proposed sandbox route only; actions emit signed status events to Pay with ARAF exactly as ARAF would.</p>
        </div>
      </div>
      <PageHeader
        eyebrow="ARAF workflow"
        title="ARAF workflow simulator"
        description="Received → business evaluation → credit review → approval. The officer who recommends approval cannot approve the same case."
        actions={<><Segmented label="View" value={view} onChange={setView} options={[{ id: 'board', label: 'Board' }, { id: 'table', label: 'Table' }]} /><Button variant="secondary" size="sm" onClick={state.reload}>{Icon.refresh()} Refresh</Button></>}
      />
      {state.error ? <ErrorAlert error={state.error} onRetry={state.reload} className="mb-4" /> : null}
      {!state.data ? <Card><LoadingBlock rows={6} /></Card> : cases.length === 0 ? (
        <Card><EmptyState title="No ARAF cases yet" description="Cases appear when an accepted offer is submitted to ARAF." icon={Icon.araf('h-5 w-5')} /></Card>
      ) : view === 'board' ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="grid min-w-[1100px] grid-cols-7 gap-3">
            {ARAF_STAGES.map((stage) => {
              const col = cases.filter((c) => c.stage === stage);
              return (
                <section key={stage} aria-label={`${humanize(stage)} (${col.length})`} className="flex min-h-[18rem] flex-col rounded-lg border border-border bg-surface-2/60">
                  <header className="flex items-center justify-between border-b border-border px-3 py-2.5">
                    <div className="min-w-0">
                      <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-fg">{humanize(stage)}</h2>
                      <p className="truncate text-2xs text-subtle">{STAGE_HELP[stage]}</p>
                    </div>
                    <span className="rounded-sm bg-surface px-1.5 text-xs font-semibold tabular-nums text-muted">{col.length}</span>
                  </header>
                  <ul className="flex-1 space-y-2 p-2">
                    {col.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setSelected(c.id)} className="w-full rounded-md border border-border bg-surface p-2.5 text-left transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                          <p className="font-mono text-xs font-semibold">{c.araf_reference}</p>
                          <p className="mt-0.5 truncate font-mono text-2xs text-muted">{c.application_reference}</p>
                          <p className="mt-1.5 text-sm font-medium tabular-nums">{formatNaira(c.financing_amount, { noKobo: true })}</p>
                          <p className="mt-1 text-2xs text-subtle">{c.actions.length} action{c.actions.length === 1 ? '' : 's'} · {formatDateTime(c.created_at)}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Card>
          <DataTable
            caption="ARAF cases"
            rows={cases}
            rowKey={(c) => c.id}
            onRowClick={(c) => setSelected(c.id)}
            columns={[
              { key: 'r', header: 'ARAF ref', cell: (c) => <Mono>{c.araf_reference}</Mono>, sortValue: (c) => c.araf_reference },
              { key: 'a', header: 'Application', cell: (c) => <Mono>{c.application_reference}</Mono> },
              { key: 's', header: 'Stage', cell: (c) => <StatusBadge status={c.stage} />, sortValue: (c) => ARAF_STAGES.indexOf(c.stage as never) },
              { key: 'as', header: 'Application state', cell: (c) => (c.application_status ? <span className="text-xs text-muted">{humanize(c.application_status)}</span> : '—') },
              { key: 'f', header: 'Financing', align: 'right', cell: (c) => formatNaira(c.financing_amount), sortValue: (c) => c.financing_amount ?? 0 },
              { key: 'n', header: 'Actions', align: 'right', cell: (c) => c.actions.length },
              { key: 'c', header: 'Received', cell: (c) => <span className="whitespace-nowrap text-muted">{formatDateTime(c.created_at)}</span>, sortValue: (c) => c.created_at },
            ]}
          />
        </Card>
      )}
      <CaseDialog c={current} onClose={() => setSelected(null)} onChanged={state.reload} />
    </>
  );
}

function CaseDialog({ c, onClose, onChanged }: { c: SimCase | null; onClose: () => void; onChanged: () => void }) {
  const { me, can } = useSession();
  const toast = useToast();
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { setAction(null); setNote(''); setError(null); setTouched(false); }, [c?.id]);
  if (!c) return null;
  const recommender = [...c.actions].reverse().find((a) => a.action === 'RECOMMEND_APPROVAL')?.actor;
  const available = Object.entries(ARAF_ACTIONS).filter(([, d]) => d.from.includes(c.stage));
  const permitted = (perm: string) => perm.split('|').some((p) => can(p));
  const noteError = note.trim().length < 3 ? 'A note of at least 3 characters is required.' : null;

  const submit = async () => {
    setTouched(true);
    if (!action || noteError) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ outcome: string }>(`/api/admin/araf-simulator/cases/${c.id}/actions`, { action, note: note.trim() });
      toast(`${ARAF_ACTIONS[action].label} — ${r.outcome === 'APPLIED' ? 'event applied to the application' : humanize(r.outcome).toLowerCase()}`);
      setAction(null);
      setNote('');
      setTouched(false);
      onChanged();
    } catch (e) {
      setError(e);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? () => undefined : onClose} size="lg" title={<span className="flex flex-wrap items-center gap-2"><Mono>{c.araf_reference}</Mono><StatusBadge status={c.stage} /></span>} description="Sandbox ARAF case" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        <KeyValue items={[
          { label: 'Application', value: c.application_id ? <Link href={`/applications/${c.application_id}`} className="font-mono text-gold-strong hover:underline">{c.application_reference}</Link> : <Mono>{c.application_reference}</Mono> },
          { label: 'Application state', value: c.application_status ? humanize(c.application_status) : '—' },
          { label: 'Financing amount', value: formatNaira(c.financing_amount) },
          { label: 'Received', value: formatDateTime(c.created_at) },
        ]} />
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Actions</h3>
          {available.length === 0 ? <p className="text-sm text-muted">{c.stage === 'INFO_REQUESTED' ? 'Waiting for the customer to provide information. The case returns to its previous stage when they respond.' : 'This case is closed — no further actions.'}</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {available.map(([id, d]) => {
                const allowed = permitted(d.permission);
                const selfApprove = id === 'APPROVE' && recommender === me.user.full_name;
                const disabled = !allowed || selfApprove;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={action === id}
                    onClick={() => setAction(id)}
                    className={cn('rounded-md border px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60', action === id ? 'border-gold bg-gold-soft/60' : 'border-border hover:border-border-strong')}
                  >
                    <span className={cn('block text-sm font-medium', d.tone === 'danger' && 'text-danger')}>{d.label}</span>
                    <span className="block text-xs text-muted">
                      {!allowed ? <>Requires <Mono>{d.permission.split('|')[0]}</Mono></> : selfApprove ? 'You recommended this case — another officer must approve (maker–checker).' : d.help}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {action && (
          <div className="space-y-3 rounded-md border border-border p-4">
            <Field label={`Note for “${ARAF_ACTIONS[action].label}”`} required error={touched ? noteError : null} hint="Recorded in the case history and the audit log.">
              {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {action === 'APPROVE' && <Alert tone="info">Approval emits APPROVED: the application becomes “Financing approved”. It is not yet booked, paid or released.</Alert>}
            <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Action not recorded" /> : null}</div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAction(null)} disabled={busy}>Cancel</Button>
              <Button variant={ARAF_ACTIONS[action].tone === 'danger' ? 'danger' : ARAF_ACTIONS[action].tone === 'gold' ? 'gold' : 'primary'} loading={busy} onClick={submit}>{ARAF_ACTIONS[action].label}</Button>
            </div>
          </div>
        )}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Action history</h3>
          {c.actions.length === 0 ? <p className="text-sm text-muted">No actions yet.</p> : (
            <Timeline items={[...c.actions].reverse().map((a) => ({
              title: <span className="flex flex-wrap items-center gap-2">{humanize(a.action)} <Badge>{humanize(a.stage)}</Badge></span>,
              meta: `${a.actor} · ${formatDateTime(a.at)}`,
              description: a.note ?? undefined,
              tone: a.action === 'REJECT' ? 'danger' : a.action === 'APPROVE' ? 'success' : a.action === 'REQUEST_INFO' ? 'warning' : undefined,
            }))} />
          )}
        </div>
      </div>
    </Dialog>
  );
}
