'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Card, DataTable, EmptyState, PageHeader, Pagination, StatusBadge, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { APPLICATION_STATES } from '@/lib/labels';
import { Async, FilterField, Guard, Mono, MultiSelect, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface AppRow {
  id: string;
  reference: string;
  partner: string;
  partner_id: string;
  merchant_order_reference: string;
  status: string;
  customer_status: string;
  purchase_amount: number;
  financing_amount: number | null;
  araf_reference: string | null;
  income_profile: string | null;
  created_at: string;
  updated_at: string;
}
interface AppList { page: number; page_size: number; total: number; data: AppRow[] }

export default function ApplicationsPage() {
  return <Guard perm="application.read"><Applications /></Guard>;
}

function Applications() {
  const { can } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [partner, setPartner] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.title = 'Applications · Pay with ARAF admin';
    const u = new URLSearchParams(window.location.search);
    if (u.get('status')) setStatuses(u.get('status')!.split(','));
    if (u.get('search')) { setSearch(u.get('search')!); setDebounced(u.get('search')!); }
    if (u.get('partner_id')) setPartner(u.get('partner_id')!);
    setReady(true);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const partners = useApi<Array<{ id: string; trading_name: string }>>(can('partner.read') ? '/api/admin/partners' : null);
  const state = useApi<AppList>(ready ? `/api/admin/applications${qs({ search: debounced, status: statuses, partner_id: partner, page, page_size: 25, sort })}` : null);
  const exportHref = `/api/admin/reports/applications.csv${qs({ range: 'all', partner_id: partner })}`;

  return (
    <>
      <PageHeader
        eyebrow="Work queues"
        title="Applications"
        description="Every financing application across partners. Internal state is shown alongside the customer-facing status."
        actions={can('report.export') ? (
          <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" download>
            {Icon.download()} Export CSV
          </a>
        ) : undefined}
      />
      <Card>
        <Toolbar>
          <FilterField label="Search" className="min-w-[14rem] flex-1 sm:flex-none">
            {(id) => <input id={id} type="search" className={filterControl} placeholder="APP- or ARAF reference" value={search} onChange={(e) => setSearch(e.target.value)} />}
          </FilterField>
          <MultiSelect label="Status" options={APPLICATION_STATES} value={statuses} onChange={(v) => { setStatuses(v); setPage(1); }} renderOption={humanize} />
          {can('partner.read') && (
            <FilterField label="Partner">
              {(id) => (
                <select id={id} className={filterControl} value={partner} onChange={(e) => { setPartner(e.target.value); setPage(1); }}>
                  <option value="">All partners</option>
                  {partners.data?.map((p) => <option key={p.id} value={p.id}>{p.trading_name}</option>)}
                </select>
              )}
            </FilterField>
          )}
          <FilterField label="Order">
            {(id) => (
              <select id={id} className={filterControl} value={sort} onChange={(e) => { setSort(e.target.value as 'asc' | 'desc'); setPage(1); }}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            )}
          </FilterField>
          {(statuses.length > 0 || partner || search) && (
            <button type="button" className="pb-2 text-sm font-medium text-gold-strong hover:underline" onClick={() => { setStatuses([]); setPartner(''); setSearch(''); setPage(1); }}>Clear filters</button>
          )}
        </Toolbar>
        {statuses.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
            {statuses.map((s) => (
              <button key={s} type="button" onClick={() => setStatuses(statuses.filter((x) => x !== s))} className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-xs hover:border-border-strong" aria-label={`Remove status filter ${humanize(s)}`}>
                {humanize(s)} {Icon.x('h-3 w-3')}
              </button>
            ))}
          </div>
        )}
        <Async
          state={state}
          rows={8}
          isEmpty={(d) => d.total === 0}
          empty={<EmptyState title="No applications found" description={statuses.length || search || partner ? 'No applications match these filters.' : 'Applications appear here when customers start a Pay with ARAF checkout.'} icon={Icon.applications('h-5 w-5')} />}
        >
          {(d) => (
            <>
              <DataTable
                caption="Applications"
                rows={d.data}
                rowKey={(r) => r.id}
                onRowClick={(r) => router.push(`/applications/${r.id}`)}
                columns={[
                  { key: 'ref', header: 'Application', sortValue: (r) => r.reference, cell: (r) => <div><Link href={`/applications/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] font-medium hover:underline">{r.reference}</Link><p className="text-xs text-muted">Order {r.merchant_order_reference}</p></div> },
                  { key: 'partner', header: 'Partner', sortValue: (r) => r.partner, cell: (r) => r.partner },
                  { key: 'status', header: 'State', sortValue: (r) => r.status, cell: (r) => <div className="space-y-0.5"><StatusBadge status={r.status} /><p className="text-2xs text-subtle">Customer: {r.customer_status}</p></div> },
                  { key: 'purchase', header: 'Purchase', align: 'right', sortValue: (r) => r.purchase_amount, cell: (r) => formatNaira(r.purchase_amount) },
                  { key: 'financing', header: 'Financing', align: 'right', sortValue: (r) => r.financing_amount ?? -1, cell: (r) => (r.financing_amount ? formatNaira(r.financing_amount) : <span className="text-subtle">—</span>) },
                  { key: 'profile', header: 'Profile', cell: (r) => (r.income_profile ? <Badge>{humanize(r.income_profile)}</Badge> : <span className="text-subtle">—</span>) },
                  { key: 'araf', header: 'ARAF ref', cell: (r) => (r.araf_reference ? <Mono>{r.araf_reference}</Mono> : <span className="text-subtle">—</span>) },
                  { key: 'created', header: 'Created', sortValue: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span> },
                ]}
              />
              <Pagination page={d.page} pageSize={d.page_size} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      </Card>
    </>
  );
}
