'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, Checkbox, CopyButton, EmptyState, Field, PageHeader, Select, Tabs, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionDialog, Async, FilterField, Mono, Section, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface Scenario { scenario: string; title: string; description: string; bvn: string; date_of_birth: string; name: string; suggested_path: string; forced: string[] }
interface Message { id: string; channel: string; destination: string; body: string; at: string }
interface AppRow { id: string; reference: string; partner: string; status: string; financing_amount: number | null }

const FORCED = [
  { id: 'MANDATE_FAILURE', label: 'Mandate failure', help: 'Remita mandate authorisation fails.' },
  { id: 'BOOKING_FAILURE', label: 'Booking failure', help: 'Core banking rejects the booking → CAD exception.' },
  { id: 'PAYMENT_FAILURE', label: 'Payment failure', help: 'Vendor payment is rejected by the payment system.' },
  { id: 'PAYMENT_UNKNOWN', label: 'Payment outcome unknown', help: 'Payment times out → reconciliation required.' },
  { id: 'ANALYSIS_FAILURE', label: 'Statement analysis failure', help: 'Periculum analysis job fails.' },
  { id: 'ARAF_REPORTING_FAILURE', label: 'ARAF reporting outage', help: 'ARAF stops acknowledging execution reports → retries, then an operations exception.' },
];

export default function SandboxPage() {
  const { me } = useSession();
  const [tab, setTab] = useState('scenarios');
  useEffect(() => { document.title = 'Sandbox tools · Pay with ARAF admin'; }, []);
  if (!me.sandbox) return <Card><EmptyState title="Sandbox tools are not available" description="This deployment is not a sandbox." /></Card>;
  return (
    <>
      <PageHeader eyebrow="Sandbox" title="Sandbox tools" description="Synthetic identities, the sandbox message inbox and controls that force provider outcomes. None of this exists in production." />
      <Alert tone="warning" className="mb-5">Sandbox only — every provider here is simulated and no real money moves. Forced outcomes and reversals are recorded in the audit log.</Alert>
      <Tabs label="Sandbox tools" value={tab} onChange={setTab} tabs={[{ id: 'scenarios', label: 'Scenario catalogue' }, { id: 'inbox', label: 'Message inbox' }, { id: 'controls', label: 'Application controls' }]} />
      <div className="mt-6">
        {tab === 'scenarios' && <Scenarios />}
        {tab === 'inbox' && <Inbox />}
        {tab === 'controls' && <Controls />}
      </div>
    </>
  );
}

function Scenarios() {
  const state = useApi<Scenario[]>('/api/admin/sandbox/scenarios');
  return (
    <Async state={state} rows={8} empty={<EmptyState title="No scenarios" />}>
      {(rows) => (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((s) => (
            <Card key={s.scenario} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="text-sm font-semibold">{s.title}</h2><Mono className="text-subtle">{s.scenario}</Mono></div>
                {s.forced.length > 0 && <Badge tone="warning">Forced: {s.forced.map(humanize).join(', ')}</Badge>}
              </div>
              <p className="mt-2 flex-1 text-sm text-muted">{s.description}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 rounded-md bg-surface-2 p-3 text-xs">
                <div><dt className="text-subtle">Name</dt><dd className="mt-0.5 font-medium">{s.name}</dd></div>
                <div><dt className="text-subtle">BVN (synthetic)</dt><dd className="mt-0.5 flex items-center gap-1 font-mono">{s.bvn}</dd></div>
                <div><dt className="text-subtle">Date of birth</dt><dd className="mt-0.5 font-mono">{s.date_of_birth}</dd></div>
              </dl>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted"><span className="font-medium text-fg">Path:</span> {s.suggested_path}</p>
                <CopyButton value={s.bvn} label="Copy BVN" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Async>
  );
}

function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s]+|\b\d{6}\b)/g);
  return parts.map((p, i) => {
    if (/^https?:\/\//.test(p)) {
      let href = p;
      try { const u = new URL(p); if (u.pathname.startsWith('/invite/') && window.location.port === u.port) href = u.pathname; } catch { /* keep */ }
      return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="break-all font-medium text-gold-strong underline-offset-2 hover:underline">{p}</a>;
    }
    if (/^\d{6}$/.test(p)) return <strong key={i} className="rounded-sm bg-gold-soft px-1 font-mono text-gold-strong">{p}</strong>;
    return <span key={i}>{p}</span>;
  });
}

function Inbox() {
  const [dest, setDest] = useState('');
  const [applied, setApplied] = useState('');
  const state = useApi<Message[]>(`/api/sandbox/inbox${qs({ destination: applied })}`, { pollMs: 15_000 });
  return (
    <Card>
      <form onSubmit={(e) => { e.preventDefault(); setApplied(dest.trim()); }}>
        <Toolbar>
          <FilterField label="Destination (exact)" className="min-w-[18rem]">{(id) => <input id={id} className={filterControl} placeholder="email@example.com or +234…" value={dest} onChange={(e) => setDest(e.target.value)} />}</FilterField>
          <Button type="submit" size="sm" className="h-9">Filter</Button>
          {applied && <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => { setDest(''); setApplied(''); }}>Clear</Button>}
          <p className="ml-auto pb-2 text-xs text-muted">Latest 100 · refreshes every 15 s</p>
        </Toolbar>
      </form>
      <Async state={state} rows={6} empty={<EmptyState title="Inbox is empty" description={applied ? `No messages to ${applied}.` : 'OTPs, invitations and notifications sent in the sandbox appear here.'} icon={Icon.bell('h-5 w-5')} />}>
        {(rows) => (
          <ul className="divide-y divide-border">
            {rows.map((m) => (
              <li key={m.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={m.channel === 'SMS' ? 'info' : 'gold'}>{m.channel}</Badge>
                  <button type="button" className="font-mono text-fg hover:underline" onClick={() => { setDest(m.destination); setApplied(m.destination); }} title="Filter by this destination">{m.destination}</button>
                  <span className="ml-auto text-subtle">{formatDateTime(m.at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{linkify(m.body)}</p>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Card>
  );
}

function Controls() {
  const { can } = useSession();
  const apps = useApi<{ data: AppRow[] }>(can('application.read') ? `/api/admin/applications${qs({ page_size: 100 })}` : null);
  const [appId, setAppId] = useState('');
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [forceOpen, setForceOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [lastForced, setLastForced] = useState<Record<string, string[]>>({});
  const app = apps.data?.data.find((a) => a.id === appId);
  if (!can('application.read')) return <Card><EmptyState title="Application controls need application.read" /></Card>;
  return (
    <div className="space-y-6">
      <Section title="Choose an application" description="Most recent 100 sandbox applications.">
        <Async state={apps} rows={2}>
          {(d) => d.data.length === 0 ? <p className="text-sm text-muted">No applications yet — start one from the AltMall demo storefront.</p> : (
            <Field label="Application">
              {(ids) => (
                <Select id={ids.id} value={appId} onChange={(e) => setAppId(e.target.value)}>
                  <option value="">Select an application…</option>
                  {d.data.map((a) => <option key={a.id} value={a.id}>{a.reference} · {a.partner} · {humanize(a.status)}{a.financing_amount ? ` · ${formatNaira(a.financing_amount, { noKobo: true })}` : ''}</option>)}
                </Select>
              )}
            </Field>
          )}
        </Async>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Forced provider outcomes" description="Applies to the selected application’s subsequent provider calls. Replaces any previously forced set.">
          <div className="space-y-3">
            {FORCED.map((f) => <Checkbox key={f.id} label={f.label} description={f.help} checked={outcomes.includes(f.id)} onChange={(e) => setOutcomes(e.target.checked ? [...outcomes, f.id] : outcomes.filter((x) => x !== f.id))} />)}
          </div>
          {appId && lastForced[appId] && <p className="mt-4 text-xs text-muted">Last set for this application: {lastForced[appId].length ? lastForced[appId].map(humanize).join(', ') : 'none (cleared)'}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button disabled={!appId || !can('exception.manage')} onClick={() => setForceOpen(true)}>{outcomes.length ? 'Apply forced outcomes' : 'Clear forced outcomes'}</Button>
            {!can('exception.manage') && <span className="flex items-center gap-1.5 text-xs text-muted">{Icon.lock('h-3.5 w-3.5')} Requires <Mono>exception.manage</Mono></span>}
          </div>
        </Section>
        <Section title="Simulate payment reversal" description="The payment system reports the confirmed vendor payment as reversed. Reconciliation then runs and the application is placed in exception.">
          <p className="text-sm text-muted">Requires a confirmed vendor payment on the selected application.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="danger" disabled={!appId || !can('payment.reconcile')} onClick={() => setReverseOpen(true)}>Simulate reversal</Button>
            {!can('payment.reconcile') && <span className="flex items-center gap-1.5 text-xs text-muted">{Icon.lock('h-3.5 w-3.5')} Requires <Mono>payment.reconcile</Mono></span>}
          </div>
        </Section>
      </div>
      <ActionDialog open={forceOpen} onClose={() => setForceOpen(false)} title={`Force outcomes — ${app?.reference ?? ''}`} description={outcomes.length ? `Subsequent calls will produce: ${outcomes.map(humanize).join(', ')}.` : 'Clears all forced outcomes for this application.'} confirmLabel="Apply" onConfirm={() => api.post<{ outcomes: string[] }>(`/api/admin/sandbox/applications/${appId}/forced-outcomes`, { outcomes })} successMessage="Forced outcomes updated" onDone={(r) => setLastForced({ ...lastForced, [appId]: r.outcomes })} />
      <ActionDialog open={reverseOpen} onClose={() => setReverseOpen(false)} title={`Simulate payment reversal — ${app?.reference ?? ''}`} confirmLabel="Simulate reversal" tone="danger" irreversible onConfirm={() => api.post<string>(`/api/admin/sandbox/applications/${appId}/reverse-payment`)} successMessage={(r) => `Reversal simulated — payment now ${humanize(String(r ?? 'reconciled'))}`} onDone={() => apps.reload()} />
    </div>
  );
}
