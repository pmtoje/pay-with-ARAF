'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, DataTable, EmptyState, Field, Input, LoadingBlock, PageHeader, Pagination, StatusBadge, formatDateTime, formatNaira } from '@araf/ui';
import { qs, useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { MERCHANT_STATUSES, MERCHANT_STATUS_LABEL, type ApplicationRow, type Paged } from '@/lib/types';
import { ErrorState, Mono, RangeFilter, SelectFilter, rangeQuery, type RangeValue } from '@/components/common';
import { RequirePermission } from '@/components/gate';
import { IconDownload } from '@/components/icons';

const PAGE_SIZE = 20;

export default function ApplicationsPage() {
  return (
    <RequirePermission perm="p.application.read">
      <ApplicationsInner />
    </RequirePermission>
  );
}

function ApplicationsInner() {
  const router = useRouter();
  const { can } = useSession();
  const [range, setRange] = useState<RangeValue>({ range: 'all' });
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<'desc' | 'asc'>('desc');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('status');
    if (s && (MERCHANT_STATUSES as readonly string[]).includes(s)) setStatus(s);
  }, []);

  const query = { ...rangeQuery(range), status: status || undefined, search: search || undefined, sort, page, page_size: PAGE_SIZE };
  const { data, error, loading, reload } = useApi<Paged<ApplicationRow>>(`/api/partner-portal/applications${qs(query)}`);
  const exportHref = `/api/partner-portal/applications.csv${qs(rangeQuery(range))}`;

  return (
    <>
      <PageHeader
        title="Applications"
        description="Every Pay with ARAF checkout started on your store. Statuses are operational only — credit details are never shared with merchants."
        actions={
          can('p.report.export') ? (
            <a href={exportHref} download className="inline-flex h-10 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <IconDownload /> Export CSV
            </a>
          ) : undefined
        }
      />
      <Card className="mb-4 space-y-4 px-4 py-4 sm:px-5">
        <RangeFilter
          allowAll
          value={range}
          onChange={(v) => {
            setRange(v);
            setPage(1);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_12rem]">
          <form
            role="search"
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchDraft.trim());
              setPage(1);
            }}
          >
            <Field label="Search" className="flex-1">
              {({ id }) => <Input id={id} type="search" placeholder="Application reference or order reference" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} className="h-10" />}
            </Field>
            <Button type="submit" variant="secondary" className="h-10">
              Search
            </Button>
          </form>
          <SelectFilter
            label="Status"
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={[{ value: '', label: 'All statuses' }, ...MERCHANT_STATUSES.map((s) => ({ value: s, label: MERCHANT_STATUS_LABEL[s] }))]}
          />
          <SelectFilter
            label="Sort"
            value={sort}
            onChange={(v) => {
              setSort(v as 'asc' | 'desc');
              setPage(1);
            }}
            options={[
              { value: 'desc', label: 'Newest first' },
              { value: 'asc', label: 'Oldest first' },
            ]}
          />
        </div>
        {(search || status) && (
          <p className="text-sm text-muted">
            Filtered{search && <> by “{search}”</>}
            {status && <> · {MERCHANT_STATUS_LABEL[status]}</>}.{' '}
            <button
              type="button"
              className="font-medium text-fg underline underline-offset-4"
              onClick={() => {
                setSearch('');
                setSearchDraft('');
                setStatus('');
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </p>
        )}
      </Card>
      <Card aria-busy={loading}>
        {error ? (
          <ErrorState error={error} onRetry={reload} title="Applications could not be loaded" />
        ) : !data ? (
          <LoadingBlock rows={8} label="Loading applications" />
        ) : (
          <>
            <p className="sr-only" aria-live="polite">
              {data.total} applications found.
            </p>
            <div className={loading ? 'opacity-60' : undefined}>
              <DataTable
                caption="Applications"
                rows={data.data}
                rowKey={(r) => r.reference}
                onRowClick={(r) => router.push(`/applications/${encodeURIComponent(r.reference)}`)}
                empty={<EmptyState title={search || status ? 'No applications match these filters' : 'No applications in this period'} description={search || status ? 'Try a different reference, status or date range.' : 'Applications appear here when customers choose Pay with ARAF at checkout.'} />}
                columns={[
                  { key: 'ref', header: 'Application', cell: (r) => <Mono className="whitespace-nowrap font-medium">{r.reference}</Mono>, sortValue: (r) => r.reference },
                  { key: 'order', header: 'Order ref', cell: (r) => <Mono className="whitespace-nowrap">{r.merchant_order_reference ?? "—"}</Mono>, sortValue: (r) => r.merchant_order_reference ?? '' },
                  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={MERCHANT_STATUS_LABEL[r.status]} />, sortValue: (r) => r.status },
                  { key: 'amount', header: 'Purchase amount', align: 'right', cell: (r) => formatNaira(r.purchase_amount), sortValue: (r) => r.purchase_amount ?? 0 },
                  { key: 'created', header: 'Created', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span>, sortValue: (r) => r.created_at },
                  { key: 'updated', header: 'Last update', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.updated_at)}</span>, sortValue: (r) => r.updated_at },
                ]}
              />
            </div>
            {data.total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
