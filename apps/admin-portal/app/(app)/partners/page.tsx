'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Card, DataTable, EmptyState, PageHeader, StatusBadge, formatDate, humanize } from '@araf/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { PARTNER_STATUSES } from '@/lib/labels';
import { Async, FilterField, Guard, Mono, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface PartnerRow { id: string; partner_code: string; trading_name: string; registered_name: string; partner_type: string; business_category: string; status: string; risk_classification: string; applications: number; created_at: string }

export default function PartnersPage() {
  return <Guard perm="partner.read"><Partners /></Guard>;
}

function Partners() {
  const { can } = useSession();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    document.title = 'Partners · Pay with ARAF admin';
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const state = useApi<PartnerRow[]>(`/api/admin/partners${qs({ q: debounced, status })}`);
  return (
    <>
      <PageHeader
        eyebrow="Portfolio"
        title="Partners"
        description="Merchants and marketplaces offering Pay with ARAF. Onboarding, configuration and settlement accounts follow maker–checker approval."
        actions={can('partner.create') ? <Link href="/partners/new" className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-ink-contrast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{Icon.plus()} Onboard partner</Link> : undefined}
      />
      <Card>
        <Toolbar>
          <FilterField label="Search" className="min-w-[14rem] flex-1 sm:flex-none">
            {(id) => <input id={id} type="search" className={filterControl} placeholder="Trading name or partner code" value={q} onChange={(e) => setQ(e.target.value)} />}
          </FilterField>
          <FilterField label="Status">
            {(id) => (
              <select id={id} className={filterControl} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {PARTNER_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </select>
            )}
          </FilterField>
          {state.data && <p className="ml-auto pb-2 text-sm text-muted" aria-live="polite">{state.data.length} partner{state.data.length === 1 ? '' : 's'}</p>}
        </Toolbar>
        <Async state={state} rows={5} empty={<EmptyState title="No partners match" description={q || status ? 'Try a different search or status.' : 'Onboard the first partner to get started.'} icon={Icon.partners('h-5 w-5')} />}>
          {(rows) => (
            <DataTable
              caption="Partners"
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/partners/${r.id}`)}
              columns={[
                { key: 'name', header: 'Partner', sortValue: (r) => r.trading_name, cell: (r) => <div><Link href={`/partners/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.trading_name}</Link><p className="text-xs text-muted">{r.registered_name}</p></div> },
                { key: 'code', header: 'Code', cell: (r) => <Mono>{r.partner_code}</Mono>, sortValue: (r) => r.partner_code },
                { key: 'type', header: 'Type', cell: (r) => humanize(r.partner_type) },
                { key: 'cat', header: 'Category', cell: (r) => <span className="text-muted">{r.business_category}</span> },
                { key: 'risk', header: 'Risk', cell: (r) => <Badge tone={r.risk_classification === 'HIGH' ? 'danger' : r.risk_classification === 'MEDIUM' ? 'warning' : r.risk_classification === 'LOW' ? 'success' : 'neutral'}>{humanize(r.risk_classification)}</Badge> },
                { key: 'apps', header: 'Applications', align: 'right', cell: (r) => r.applications.toLocaleString('en-NG'), sortValue: (r) => r.applications },
                { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
                { key: 'created', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDate(r.created_at)}</span>, sortValue: (r) => r.created_at },
              ]}
            />
          )}
        </Async>
      </Card>
    </>
  );
}
