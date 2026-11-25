'use client';

import { Fragment, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, PageHeader, Pagination, Skeleton, cn, formatDateTime, humanize } from '@araf/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { roleLabel } from '@/lib/labels';
import { Async, ErrorAlert, FilterField, Guard, JsonBlock, Mono, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface AuditRow { id: string; sequence: number; at: string; actor_type: string; actor: string | null; roles: string[]; action: string; resource_type: string; resource_id: string | null; partner_id: string | null; outcome: string; reason: string | null; before: unknown; after: unknown; ip: string | null; correlation_id: string | null; hash: string }
interface AuditPage { page: number; total: number; data: AuditRow[] }

const EMPTY = { action: '', actor_id: '', resource_type: '', resource_id: '', partner_id: '', outcome: '', from: '', to: '' };

export default function AuditPage() {
  return <Guard perm="audit.read"><Audit /></Guard>;
}

function Audit() {
  const { can } = useSession();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => { document.title = 'Audit log · Pay with ARAF admin'; }, []);
  const verify = useApi<{ valid: boolean; checked: number; brokenAt?: string }>('/api/admin/audit/verify');
  const partners = useApi<Array<{ id: string; trading_name: string }>>(can('partner.read') ? '/api/admin/partners' : null);
  const list = useApi<AuditPage>(`/api/admin/audit${qs({ ...filters, from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : '', to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : '', page })}`);
  const partnerName = (id: string | null) => (id ? partners.data?.find((p) => p.id === id)?.trading_name ?? `${id.slice(0, 8)}…` : '—');
  const set = (k: keyof typeof EMPTY, v: string) => setDraft({ ...draft, [k]: v });
  const apply = (e?: React.FormEvent) => { e?.preventDefault(); setFilters(draft); setPage(1); };

  return (
    <>
      <PageHeader
        eyebrow="Insight"
        title="Audit log"
        description="Append-only, hash-chained record of every security-relevant action. Each entry includes the hash of the previous one, so tampering breaks the chain."
        actions={<ChainBadge state={verify} />}
      />
      <Card>
        <form onSubmit={apply}>
          <Toolbar>
            <FilterField label="Action contains">{(id) => <input id={id} className={filterControl} placeholder="e.g. approval." value={draft.action} onChange={(e) => set('action', e.target.value)} />}</FilterField>
            <FilterField label="Actor ID">{(id) => <input id={id} className={cn(filterControl, 'w-44')} placeholder="User UUID" value={draft.actor_id} onChange={(e) => set('actor_id', e.target.value.trim())} />}</FilterField>
            <FilterField label="Resource type">{(id) => <input id={id} className={cn(filterControl, 'w-40')} placeholder="e.g. APPLICATION" value={draft.resource_type} onChange={(e) => set('resource_type', e.target.value.toUpperCase().trim())} />}</FilterField>
            <FilterField label="Resource ID">{(id) => <input id={id} className={cn(filterControl, 'w-44')} value={draft.resource_id} onChange={(e) => set('resource_id', e.target.value.trim())} />}</FilterField>
            {can('partner.read') && (
              <FilterField label="Partner">{(id) => <select id={id} className={filterControl} value={draft.partner_id} onChange={(e) => set('partner_id', e.target.value)}><option value="">Any</option>{partners.data?.map((p) => <option key={p.id} value={p.id}>{p.trading_name}</option>)}</select>}</FilterField>
            )}
            <FilterField label="Outcome">{(id) => <select id={id} className={filterControl} value={draft.outcome} onChange={(e) => set('outcome', e.target.value)}><option value="">Any</option><option value="SUCCESS">Success</option><option value="DENIED">Denied</option><option value="FAILURE">Failure</option></select>}</FilterField>
            <FilterField label="From">{(id) => <input id={id} type="date" className={filterControl} value={draft.from} onChange={(e) => set('from', e.target.value)} />}</FilterField>
            <FilterField label="To">{(id) => <input id={id} type="date" className={filterControl} value={draft.to} onChange={(e) => set('to', e.target.value)} />}</FilterField>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="h-9">Search</Button>
              <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); setPage(1); }}>Reset</Button>
            </div>
          </Toolbar>
        </form>
        <Async state={list} rows={10} isEmpty={(d) => d.total === 0} empty={<EmptyState title="No audit records match" description="Adjust the filters." icon={Icon.audit('h-5 w-5')} />}>
          {(d) => (
            <>
              <div className="w-full overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Audit records</caption>
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-subtle">
                      <th scope="col" className="w-8 px-3 py-2.5"><span className="sr-only">Expand</span></th>
                      <th scope="col" className="px-3 py-2.5">#</th>
                      <th scope="col" className="px-3 py-2.5">Time</th>
                      <th scope="col" className="px-3 py-2.5">Actor</th>
                      <th scope="col" className="px-3 py-2.5">Action</th>
                      <th scope="col" className="px-3 py-2.5">Resource</th>
                      <th scope="col" className="px-3 py-2.5">Partner</th>
                      <th scope="col" className="px-3 py-2.5">Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.data.map((r) => {
                      const open = expanded === r.id;
                      return (
                        <Fragment key={r.id}>
                          <tr className={cn('border-b border-border', open && 'bg-surface-2')}>
                            <td className="px-3 py-2">
                              <button type="button" aria-expanded={open} aria-controls={`a-${r.id}`} aria-label={`${open ? 'Collapse' : 'Expand'} record ${r.sequence}`} onClick={() => setExpanded(open ? null : r.id)} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                                <span className={cn('block transition-transform', open && 'rotate-90')}>{Icon.chevron('h-3.5 w-3.5')}</span>
                              </button>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-subtle">{r.sequence}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted">{formatDateTime(r.at)}</td>
                            <td className="px-3 py-2"><p className="font-medium">{r.actor ?? '—'}</p><p className="text-2xs text-subtle">{humanize(r.actor_type)}{r.roles.length ? ` · ${r.roles.map(roleLabel).join(', ')}` : ''}</p></td>
                            <td className="px-3 py-2"><Mono>{r.action}</Mono></td>
                            <td className="px-3 py-2"><p className="text-xs">{r.resource_type}</p>{r.resource_id && <p className="max-w-[12rem] truncate font-mono text-2xs text-subtle" title={r.resource_id}>{r.resource_id}</p>}</td>
                            <td className="px-3 py-2 text-muted">{partnerName(r.partner_id)}</td>
                            <td className="px-3 py-2"><Badge tone={r.outcome === 'SUCCESS' ? 'success' : r.outcome === 'DENIED' ? 'danger' : 'warning'}>{humanize(r.outcome)}</Badge></td>
                          </tr>
                          {open && (
                            <tr id={`a-${r.id}`} className="border-b border-border bg-surface-2/50">
                              <td colSpan={8} className="px-4 py-4">
                                <dl className="mb-4 grid gap-3 text-xs sm:grid-cols-4">
                                  <div><dt className="text-subtle">Reason</dt><dd className="mt-0.5 text-sm">{r.reason ?? '—'}</dd></div>
                                  <div><dt className="text-subtle">IP address</dt><dd className="mt-0.5 font-mono">{r.ip ?? '—'}</dd></div>
                                  <div><dt className="text-subtle">Correlation ID</dt><dd className="mt-0.5 break-all font-mono">{r.correlation_id ?? '—'}</dd></div>
                                  <div><dt className="text-subtle">Hash (prefix)</dt><dd className="mt-0.5 font-mono">{r.hash}</dd></div>
                                </dl>
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Before</p><JsonBlock value={r.before} maxHeight="max-h-64" /></div>
                                  <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">After</p><JsonBlock value={r.after} maxHeight="max-h-64" /></div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={d.page} pageSize={50} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      </Card>
    </>
  );
}

function ChainBadge({ state }: { state: { data?: { valid: boolean; checked: number; brokenAt?: string }; error: unknown; loading: boolean; reload: () => void } }) {
  if (state.error) return <div className="max-w-sm"><ErrorAlert error={state.error} title="Chain verification failed to run" onRetry={state.reload} /></div>;
  if (!state.data) return <Skeleton className="h-10 w-56" />;
  const v = state.data;
  return (
    <div className={cn('flex items-center gap-3 rounded-md border px-3 py-2', v.valid ? 'border-success/40 bg-success-soft' : 'border-danger/40 bg-danger-soft')} role="status">
      <span className={v.valid ? 'text-success' : 'text-danger'}>{v.valid ? Icon.policy('h-5 w-5') : Icon.operations('h-5 w-5')}</span>
      <div className="text-sm">
        <p className={cn('font-semibold', v.valid ? 'text-success' : 'text-danger')}>{v.valid ? 'Hash chain verified' : 'Hash chain broken'}</p>
        <p className="text-xs text-fg/70">{v.checked.toLocaleString('en-NG')} records checked{v.brokenAt ? ` · first break at ${v.brokenAt.slice(0, 8)}` : ''}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={state.reload} loading={state.loading} aria-label="Re-verify audit chain">{Icon.refresh()}</Button>
    </div>
  );
}
