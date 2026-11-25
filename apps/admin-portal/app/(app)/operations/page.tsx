'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, Field, KeyValue, PageHeader, Stat, StatusBadge, Textarea, Timeline, cn, formatDateTime, humanize } from '@araf/ui';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { EXCEPTION_CATEGORIES, EXCEPTION_TEAMS, hours } from '@/lib/labels';
import { Async, ErrorAlert, FilterField, Guard, Mono, MultiSelect, Section, Toolbar, filterControl, useToast } from '@/components/common';
import { HBarList } from '@/components/charts';
import { Icon } from '@/components/icons';

interface Exc {
  id: string; reference: string; code: string; category: string; severity: string; team: string; status: string; retry_eligible: boolean; escalated: boolean; detail: string; customer_message: string | null;
  history: Array<{ at: string; by: string; action: string; note: string }> | null;
  application: { id: string; reference: string; status: string; exceptionReturnState: string | null } | null;
  created_at: string; resolved_at: string | null;
}
interface OpsReport {
  pending_applications: number;
  aging_by_stage: Array<{ stage: string; count: number; avg_hours: number; over_24h: number }>;
  sla_breaches: number;
  exceptions: Array<{ category: string; team: string; status: string; count: number }>;
  open_reconciliation_findings: number;
}

const ACTIONS = [
  { id: 'ASSIGN_TO_ME', label: 'Assign to me', help: 'Marks the exception in progress under your name.' },
  { id: 'RESUME', label: 'Resume application', help: 'Resolves the exception and returns the application to the state it left.' },
  { id: 'RESOLVE', label: 'Resolve', help: 'Marks the exception resolved without changing the application.' },
  { id: 'ESCALATE', label: 'Escalate', help: 'Escalates to the responsible team lead.' },
  { id: 'CLOSE_APPLICATION', label: 'Close application', help: 'Cancels the application and releases its exposure reservation. Irreversible.' },
];

const sevTone = (s: string) => (s === 'CRITICAL' || s === 'HIGH' ? 'danger' : s === 'MEDIUM' ? 'warning' : 'neutral');

export default function OperationsPage() {
  return <Guard perm="application.read"><Operations /></Guard>;
}

function Operations() {
  const { can } = useSession();
  const [statuses, setStatuses] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [team, setTeam] = useState('');
  const [selected, setSelected] = useState<Exc | null>(null);
  useEffect(() => { document.title = 'Operations · Pay with ARAF admin'; }, []);
  const list = useApi<Exc[]>(`/api/admin/exceptions${qs({ status: statuses, category, team })}`, { pollMs: 60_000 });
  const report = useApi<OpsReport>(can('report.read') ? '/api/admin/reports/operations' : null);
  const r = report.data;
  const openByTeam = r ? Object.entries(r.exceptions.filter((e) => e.status !== 'RESOLVED').reduce<Record<string, number>>((m, e) => ({ ...m, [e.team]: (m[e.team] ?? 0) + e.count }), {})).map(([k, v]) => ({ key: k, label: humanize(k), value: v })) : [];

  return (
    <>
      <PageHeader eyebrow="Work queues" title="Operations" description="Operational exception queues across onboarding, ARAF submission, booking, payment, delivery and refunds." actions={<Button variant="secondary" size="sm" onClick={() => { list.reload(); report.reload(); }}>{Icon.refresh()} Refresh</Button>} />

      {can('report.read') && (
        <div className="mb-6 space-y-6">
          {report.error ? <ErrorAlert error={report.error} onRetry={report.reload} /> : null}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="In-flight applications" value={r?.pending_applications ?? '—'} />
            <Stat label="Review SLA breaches" value={<span className={r?.sla_breaches ? 'text-danger' : ''}>{r?.sla_breaches ?? '—'}</span>} />
            <Stat label="Open exceptions" value={r ? r.exceptions.filter((e) => e.status !== 'RESOLVED').reduce((s, e) => s + e.count, 0) : '—'} />
            <Stat label="Open reconciliation findings" value={r?.open_reconciliation_findings ?? '—'} />
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <Section className="lg:col-span-3" title="Aging by stage" description="Non-terminal applications, age since creation." flush>
              <DataTable
                caption="Aging by stage"
                rows={[...(r?.aging_by_stage ?? [])].sort((a, b) => b.avg_hours - a.avg_hours)}
                rowKey={(x) => x.stage}
                dense
                empty={<p className="px-5 py-6 text-sm text-muted">{r ? 'No in-flight applications.' : 'Loading…'}</p>}
                columns={[
                  { key: 's', header: 'Stage', cell: (x) => <Link className="hover:underline" href={`/applications?status=${x.stage}`}>{humanize(x.stage)}</Link> },
                  { key: 'c', header: 'Count', align: 'right', cell: (x) => x.count, sortValue: (x) => x.count },
                  { key: 'a', header: 'Avg. age', align: 'right', cell: (x) => hours(x.avg_hours), sortValue: (x) => x.avg_hours },
                  { key: 'o', header: '> 24 h', align: 'right', cell: (x) => <span className={x.over_24h ? 'font-semibold text-warning' : ''}>{x.over_24h}</span>, sortValue: (x) => x.over_24h },
                ]}
              />
            </Section>
            <Section className="lg:col-span-2" title="Open exceptions by team">
              <HBarList label="Open exceptions by team" items={openByTeam} tone="danger" empty="No open exceptions." />
            </Section>
          </div>
        </div>
      )}

      <Card>
        <div className="border-b border-border px-5 py-3.5"><h2 className="text-sm font-semibold">Exception queue</h2><p className="text-xs text-muted">Defaults to open, in-progress and escalated exceptions (latest 200).</p></div>
        <Toolbar>
          <MultiSelect label="Status" options={['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED']} value={statuses} onChange={setStatuses} renderOption={humanize} />
          <FilterField label="Category">
            {(id) => <select id={id} className={filterControl} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{EXCEPTION_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}
          </FilterField>
          <FilterField label="Team">
            {(id) => <select id={id} className={filterControl} value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{EXCEPTION_TEAMS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>}
          </FilterField>
        </Toolbar>
        <Async state={list} rows={6} empty={<EmptyState title="No exceptions in this queue" description="Everything is flowing. Exceptions appear here when an integration fails or a manual step is needed." icon={Icon.check('h-5 w-5')} />}>
          {(rows) => (
            <DataTable
              caption="Operational exceptions"
              rows={rows}
              rowKey={(e) => e.id}
              onRowClick={setSelected}
              columns={[
                { key: 'r', header: 'Exception', sortValue: (e) => e.reference, cell: (e) => <div><Mono className="font-medium">{e.reference}</Mono><p className="text-xs text-muted">{humanize(e.code)}</p></div> },
                { key: 'a', header: 'Application', cell: (e) => (e.application ? <Link href={`/applications/${e.application.id}`} onClick={(ev) => ev.stopPropagation()} className="font-mono text-xs text-gold-strong hover:underline">{e.application.reference}</Link> : '—') },
                { key: 'c', header: 'Category', cell: (e) => humanize(e.category), sortValue: (e) => e.category },
                { key: 'sv', header: 'Severity', cell: (e) => <Badge tone={sevTone(e.severity)}>{humanize(e.severity)}</Badge>, sortValue: (e) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].indexOf(e.severity) },
                { key: 't', header: 'Team', cell: (e) => humanize(e.team), sortValue: (e) => e.team },
                { key: 'd', header: 'Detail', cell: (e) => <span className="line-clamp-2 min-w-[14rem] text-sm text-muted">{e.detail}</span> },
                { key: 's', header: 'Status', cell: (e) => <span className="flex flex-col gap-0.5"><StatusBadge status={e.status} />{e.retry_eligible && <span className="text-2xs text-subtle">Retry eligible</span>}</span> },
                { key: 'at', header: 'Raised', sortValue: (e) => e.created_at, cell: (e) => <span className="whitespace-nowrap text-muted">{formatDateTime(e.created_at)}</span> },
              ]}
            />
          )}
        </Async>
      </Card>
      <ExceptionDialog exc={selected} onClose={() => setSelected(null)} onChanged={() => { list.reload(); report.reload(); }} />
    </>
  );
}

function ExceptionDialog({ exc, onClose, onChanged }: { exc: Exc | null; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => { setAction(''); setNote(''); setError(null); setTouched(false); setConfirmClose(false); }, [exc?.id]);
  if (!exc) return null;
  const resolved = exc.status === 'RESOLVED';
  const inException = exc.application?.status === 'EXCEPTION';
  const available = ACTIONS.filter((a) => (a.id === 'RESUME' ? inException && !!exc.application?.exceptionReturnState : a.id === 'CLOSE_APPLICATION' ? inException : true));
  const noteError = note.trim().length < 3 ? 'A note of at least 3 characters is required.' : null;
  const submit = async () => {
    setTouched(true);
    if (!action || noteError) return;
    if (action === 'CLOSE_APPLICATION' && !confirmClose) { setConfirmClose(true); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/exceptions/${exc.id}/actions`, { action, note: note.trim() });
      toast(`${ACTIONS.find((a) => a.id === action)?.label} — ${exc.reference}`);
      onChanged();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? () => undefined : onClose} size="lg" title={<span className="flex flex-wrap items-center gap-2"><Mono>{exc.reference}</Mono><StatusBadge status={exc.status} /><Badge tone={sevTone(exc.severity)}>{humanize(exc.severity)}</Badge></span>} description={humanize(exc.code)}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>{!resolved && can('exception.manage') && <Button variant={action === 'CLOSE_APPLICATION' ? 'danger' : 'primary'} loading={busy} disabled={!action} onClick={submit}>{confirmClose ? 'Confirm — close application' : action ? ACTIONS.find((a) => a.id === action)?.label : 'Choose an action'}</Button>}</>}>
      <div className="space-y-5">
        <p className="text-sm">{exc.detail}</p>
        <KeyValue items={[
          { label: 'Category', value: humanize(exc.category) },
          { label: 'Responsible team', value: humanize(exc.team) },
          { label: 'Application', value: exc.application ? <Link href={`/applications/${exc.application.id}`} className="font-mono text-gold-strong hover:underline">{exc.application.reference}</Link> : '—' },
          { label: 'Application state', value: exc.application ? <span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={exc.application.status} />{exc.application.exceptionReturnState && <span className="text-xs text-muted">returns to {humanize(exc.application.exceptionReturnState)}</span>}</span> : '—' },
          { label: 'Retry eligible', value: exc.retry_eligible ? 'Yes' : 'No' },
          { label: 'Customer sees', value: exc.customer_message ?? '—' },
          { label: 'Raised', value: formatDateTime(exc.created_at) },
          { label: 'Resolved', value: formatDateTime(exc.resolved_at) },
        ]} />
        {!resolved && (can('exception.manage') ? (
          <div className="space-y-3 rounded-md border border-border p-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Action</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {available.map((a) => (
                  <label key={a.id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2', action === a.id ? 'border-gold bg-gold-soft/50' : 'border-border hover:border-border-strong')}>
                    <input type="radio" name="exc-action" className="mt-1 h-4 w-4 accent-[rgb(var(--color-gold))]" checked={action === a.id} onChange={() => { setAction(a.id); setConfirmClose(false); }} />
                    <span><span className={cn('block text-sm font-medium', a.id === 'CLOSE_APPLICATION' && 'text-danger')}>{a.label}</span><span className="block text-xs text-muted">{a.help}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label="Note" required error={touched ? noteError : null}>
              {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            {confirmClose && <Alert tone="warning" title="Close the application?">This cancels {exc.application?.reference} and releases its exposure. It cannot be undone.</Alert>}
            <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Action not recorded" /> : null}</div>
          </div>
        ) : <p className="flex items-center gap-2 text-sm text-muted">{Icon.lock()} Working exceptions requires <Mono>exception.manage</Mono>.</p>)}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">History</h3>
          {exc.history?.length ? <Timeline items={[...exc.history].reverse().map((h) => ({ title: humanize(h.action), meta: `${h.by} · ${formatDateTime(h.at)}`, description: h.note }))} /> : <p className="text-sm text-muted">No actions yet.</p>}
        </div>
      </div>
    </Dialog>
  );
}
