'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, EmptyState, PageHeader, Stat, StatusBadge, Tabs, formatDateTime, formatPercent, humanize } from '@araf/ui';
import { api, qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionDialog, Async, FilterField, Guard, Mono, Section, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface Integrations {
  environment: string;
  live_operations_enabled: boolean;
  capability_matrix: Array<{ provider: string; interface: string; sandbox: string; live: string; capabilities: string[] }>;
  recent_calls: Array<{ provider: string; operation: string; outcome: string; error: string | null; latency_ms: number; simulated: boolean; at: string }>;
  production_gates: Array<{ gate: string; status: string }>;
}
interface Health {
  providers: Array<{ provider: string; calls: number; success_rate: number; p50_ms: number; p95_ms: number; simulated: boolean }>;
  webhooks: { total: number; succeeded: number; retrying: number; dead_lettered: number; success_rate: number | null };
}
interface Delivery { id: string; event_id: string; type: string; partner_id: string; endpoint: string; status: string; attempts: number; last_status_code: number | null; last_error: string | null; next_attempt_at: string | null; created_at: string }

export default function IntegrationsPage() {
  return <Guard perm="integration.read"><IntegrationsView /></Guard>;
}

function IntegrationsView() {
  const { can } = useSession();
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState('7d');
  const [partner, setPartner] = useState('');
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState<Delivery | null>(null);
  useEffect(() => {
    document.title = 'Integrations · Pay with ARAF admin';
    const p = new URLSearchParams(window.location.search).get('partner');
    if (p) { setPartner(p); setTab('webhooks'); }
  }, []);
  const info = useApi<Integrations>('/api/admin/integrations');
  const health = useApi<Health>(`/api/admin/integrations/health${qs({ range })}`);
  const partners = useApi<Array<{ id: string; trading_name: string }>>(can('partner.read') ? '/api/admin/partners' : null);
  const deliveries = useApi<Delivery[]>(tab === 'webhooks' ? `/api/admin/webhooks/deliveries${qs({ partner_id: partner, status })}` : null);
  const d = info.data;
  const partnerName = (id: string) => partners.data?.find((p) => p.id === id)?.trading_name ?? `${id.slice(0, 8)}…`;

  return (
    <>
      <PageHeader eyebrow="Platform" title="Integrations" description="Provider adapters, their sandbox and live status, health and webhook delivery to partners." />
      {d && (
        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Environment</p>
            <p className="mt-2 flex items-center gap-2 text-xl font-semibold">{d.environment}<Badge tone={d.environment === 'PRODUCTION' ? 'danger' : 'warning'}>{d.environment === 'PRODUCTION' ? 'Production' : 'Simulated providers'}</Badge></p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Live operations</p>
            <p className="mt-2 flex items-center gap-2 text-xl font-semibold">{d.live_operations_enabled ? 'Enabled' : 'Disabled'}{!d.live_operations_enabled && <span className="text-subtle">{Icon.lock('h-5 w-5')}</span>}</p>
            <p className="mt-1 text-xs text-muted">{d.live_operations_enabled ? 'Real money movement is possible.' : 'No real money moves. Production approvals are locked.'}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Production gates</p>
            <p className="mt-2 text-xl font-semibold">{d.production_gates.filter((g) => g.status !== 'OUTSTANDING').length} / {d.production_gates.length} <span className="text-sm font-normal text-muted">closed</span></p>
          </div>
        </div>
      )}
      <Tabs label="Integration sections" value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Providers' }, { id: 'health', label: 'Health & calls' }, { id: 'webhooks', label: 'Webhook deliveries' }, { id: 'gates', label: 'Production gates' }]} />
      <div className="mt-6 space-y-6">
        {tab === 'overview' && (
          <Async state={info} rows={8}>
            {(x) => (
              <Section title="Provider capability matrix" description="Each provider sits behind an interface with a sandbox simulator. Live adapters require confirmed specifications." flush>
                <DataTable caption="Provider capability matrix" rows={x.capability_matrix} rowKey={(r) => r.provider} columns={[
                  { key: 'p', header: 'Provider', cell: (r) => <div><p className="font-medium">{r.provider}</p><Mono className="text-subtle">{r.interface}</Mono></div> },
                  { key: 'c', header: 'Capabilities', cell: (r) => <span className="flex max-w-xs flex-wrap gap-1">{r.capabilities.map((c) => <Badge key={c}>{c}</Badge>)}</span> },
                  { key: 's', header: 'Sandbox', cell: (r) => <span className="flex items-start gap-1.5 text-sm"><span className="mt-0.5 text-success">{Icon.check('h-3.5 w-3.5')}</span>{r.sandbox}</span> },
                  { key: 'l', header: 'Live', cell: (r) => <span className="flex items-start gap-1.5 text-sm text-muted"><span className="mt-0.5 text-warning">{Icon.lock('h-3.5 w-3.5')}</span>{r.live}</span> },
                ]} />
              </Section>
            )}
          </Async>
        )}
        {tab === 'health' && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <FilterField label="Period">{(id) => <select id={id} className={filterControl} value={range} onChange={(e) => setRange(e.target.value)}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="all">All time</option></select>}</FilterField>
              <Button variant="ghost" size="sm" onClick={() => { health.reload(); info.reload(); }}>{Icon.refresh()} Refresh</Button>
            </div>
            <Async state={health} rows={6}>
              {(h) => (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Webhook deliveries" value={h.webhooks.total} />
                    <Stat label="Delivered" value={formatPercent(h.webhooks.success_rate)} hint={`${h.webhooks.succeeded} succeeded`} />
                    <Stat label="Retrying" value={h.webhooks.retrying} />
                    <Stat label="Dead-lettered" value={<span className={h.webhooks.dead_lettered ? 'text-danger' : ''}>{h.webhooks.dead_lettered}</span>} />
                  </div>
                  <Section title="Provider health" flush>
                    <DataTable caption="Provider health" rows={h.providers} rowKey={(p) => p.provider} dense empty={<p className="px-5 py-6 text-sm text-muted">No provider calls in this period.</p>} columns={[
                      { key: 'p', header: 'Provider', cell: (p) => <span className="font-medium">{humanize(p.provider)}</span>, sortValue: (p) => p.provider },
                      { key: 'c', header: 'Calls', align: 'right', cell: (p) => p.calls, sortValue: (p) => p.calls },
                      { key: 's', header: 'Success', align: 'right', cell: (p) => <span className={p.success_rate < 0.95 ? 'font-semibold text-danger' : ''}>{formatPercent(p.success_rate)}</span>, sortValue: (p) => p.success_rate },
                      { key: '50', header: 'p50', align: 'right', cell: (p) => `${p.p50_ms} ms` },
                      { key: '95', header: 'p95', align: 'right', cell: (p) => `${p.p95_ms} ms`, sortValue: (p) => p.p95_ms },
                      { key: 'm', header: 'Mode', cell: (p) => (p.simulated ? <Badge tone="warning">Simulated</Badge> : <Badge tone="info">Live</Badge>) },
                    ]} />
                  </Section>
                </>
              )}
            </Async>
            <Section title="Recent provider calls" description="Latest 100 calls (all periods)." flush>
              <Async state={info} rows={6}>
                {(x) => (
                  <DataTable caption="Recent provider calls" rows={x.recent_calls} rowKey={(c) => `${c.at}-${c.provider}-${c.operation}`} dense empty={<p className="px-5 py-6 text-sm text-muted">No calls yet.</p>} columns={[
                    { key: 'at', header: 'Time', cell: (c) => <span className="whitespace-nowrap text-muted">{formatDateTime(c.at)}</span> },
                    { key: 'p', header: 'Provider', cell: (c) => humanize(c.provider) },
                    { key: 'o', header: 'Operation', cell: (c) => <Mono>{c.operation}</Mono> },
                    { key: 'r', header: 'Outcome', cell: (c) => <span className="flex flex-col"><StatusBadge status={c.outcome} />{c.error && <span className="text-2xs text-danger">{c.error}</span>}</span> },
                    { key: 'l', header: 'Latency', align: 'right', cell: (c) => `${c.latency_ms} ms` },
                    { key: 's', header: 'Mode', cell: (c) => (c.simulated ? <Badge tone="warning">Sim</Badge> : <Badge tone="info">Live</Badge>) },
                  ]} />
                )}
              </Async>
            </Section>
          </>
        )}
        {tab === 'webhooks' && (
          <Card>
            <Toolbar>
              {can('partner.read') && <FilterField label="Partner">{(id) => <select id={id} className={filterControl} value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">All partners</option>{partners.data?.map((p) => <option key={p.id} value={p.id}>{p.trading_name}</option>)}</select>}</FilterField>}
              <FilterField label="Status">{(id) => <select id={id} className={filterControl} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any</option>{['PENDING', 'SUCCEEDED', 'RETRYING', 'DEAD_LETTERED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>}</FilterField>
              <Button className="ml-auto" variant="ghost" size="sm" onClick={deliveries.reload}>{Icon.refresh()} Refresh</Button>
            </Toolbar>
            <Async state={deliveries} rows={6} empty={<EmptyState title="No webhook deliveries" description="Deliveries appear when partner events are emitted." icon={Icon.integrations('h-5 w-5')} />}>
              {(rows) => (
                <DataTable caption="Webhook deliveries" rows={rows} rowKey={(r) => r.id} columns={[
                  { key: 't', header: 'Event', cell: (r) => <div><Mono className="font-medium">{r.type}</Mono><p className="font-mono text-2xs text-subtle">{r.event_id}</p></div> },
                  { key: 'p', header: 'Partner', cell: (r) => partnerName(r.partner_id) },
                  { key: 'e', header: 'Endpoint', cell: (r) => <span className="block max-w-[16rem] truncate font-mono text-xs" title={r.endpoint}>{r.endpoint}</span> },
                  { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                  { key: 'a', header: 'Attempts', align: 'right', cell: (r) => r.attempts },
                  { key: 'c', header: 'Last response', cell: (r) => (r.last_status_code ? <Mono>{r.last_status_code}</Mono> : r.last_error ? <span className="text-xs text-danger">{r.last_error}</span> : '—') },
                  { key: 'n', header: 'Next attempt', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.next_attempt_at)}</span> },
                  { key: 'x', header: <span className="sr-only">Actions</span>, cell: (r) => (can('webhook.manage.bank') && r.status !== 'SUCCEEDED' ? <Button size="sm" variant="secondary" onClick={() => setRetry(r)}>Retry</Button> : null) },
                ]} />
              )}
            </Async>
          </Card>
        )}
        {tab === 'gates' && (
          <Async state={info} rows={8}>
            {(x) => (
              <Section title="Production readiness gates" description="Every gate must be closed with evidence before live operations can be enabled.">
                <Alert tone="warning" className="mb-4">Live operations stay disabled while any gate is outstanding.</Alert>
                <ol className="grid gap-2 sm:grid-cols-2">
                  {x.production_gates.map((g, i) => (
                    <li key={g.gate} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
                      <span className="flex items-center gap-3 text-sm"><span className="w-5 text-right font-mono text-xs text-subtle">{i + 1}</span>{g.gate}</span>
                      {g.status === 'OUTSTANDING' ? <Badge tone="warning">Outstanding</Badge> : <StatusBadge status={g.status} />}
                    </li>
                  ))}
                </ol>
              </Section>
            )}
          </Async>
        )}
      </div>
      <ActionDialog open={!!retry} onClose={() => setRetry(null)} title="Retry webhook delivery" description={retry ? `Re-queues ${retry.type} (${retry.event_id}) to the partner’s endpoints on their behalf.` : undefined} confirmLabel="Queue retry" onConfirm={() => api.post<{ queued: number }>(`/api/admin/webhooks/events/${retry!.partner_id}/${retry!.event_id}/retry`)} successMessage={(r) => `${r.queued} deliver${r.queued === 1 ? 'y' : 'ies'} queued`} onDone={deliveries.reload} />
    </>
  );
}
