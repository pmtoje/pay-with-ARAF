'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BarChart, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, Stat, StatusBadge, Tabs, formatDate, formatNaira, formatPercent } from '@araf/ui';
import { qs, useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { MERCHANT_STATUS_LABEL, type Overview } from '@/lib/types';
import { ErrorState, RangeFilter, rangeLabel, rangeQuery, type RangeValue } from '@/components/common';
import { RequirePermission } from '@/components/gate';

export default function OverviewPage() {
  return (
    <RequirePermission perm="p.dashboard.read">
      <OverviewInner />
    </RequirePermission>
  );
}

function OverviewInner() {
  const { me, can } = useSession();
  const [range, setRange] = useState<RangeValue>({ range: '30d' });
  const [metric, setMetric] = useState<'applications' | 'value'>('applications');
  const { data, error, loading, reload } = useApi<Overview>(`/api/partner-portal/overview${qs(rangeQuery(range))}`);

  const n = (v: number | undefined) => (v === undefined ? '—' : v.toLocaleString('en-NG'));
  const maxStatus = Math.max(1, ...(data?.status_breakdown ?? []).map((s) => s.count));

  return (
    <>
      <PageHeader
        eyebrow={me.partner?.tradingName}
        title="Overview"
        description="Financing activity for your store. Eligibility, submission, approval, vendor payment and goods release are separate stages — only a release authorisation permits you to hand over goods."
      />
      <div className="mb-6">
        <RangeFilter value={range} onChange={setRange} />
      </div>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} title="Overview could not be loaded" />
        </Card>
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <Card key={i}>
              <LoadingBlock rows={2} />
            </Card>
          ))}
        </div>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : undefined} aria-busy={loading}>
          <p className="sr-only" aria-live="polite">
            Showing {rangeLabel(range)}: {data.total_applications} applications.
          </p>
          <section aria-labelledby="kpi-funnel" className="space-y-3">
            <h2 id="kpi-funnel" className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
              Applications · {formatDate(data.range.from)} – {formatDate(data.range.to)}
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Total applications" value={n(data.total_applications)} hint={`${formatNaira(data.total_requested_value, { compact: true })} requested`} />
              <Stat label="Requested value" value={formatNaira(data.total_requested_value, { compact: true })} hint="Sum of cart values" />
              <Stat label="Eligible (indicative)" value={n(data.eligible_applications)} hint="Not an approval" />
              <Stat label="Submitted to ARAF" value={n(data.submitted_to_araf)} hint="Awaiting Bank decision" />
              <Stat label="Approved" value={n(data.approved)} tone="gold" hint="Financing approved by the Bank" />
              <Stat label="Declined" value={n(data.declined)} hint="No credit reasons are shared" />
              <Stat label="Pending customer action" value={n(data.pending_customer_action)} />
              <Stat label="Conversion rate" value={formatPercent(data.conversion_rate)} hint="Approved ÷ total applications" />
            </div>
          </section>

          <section aria-labelledby="kpi-ops" className="mt-8 space-y-3">
            <h2 id="kpi-ops" className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
              Payments &amp; fulfilment
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Vendor payments pending" value={n(data.vendor_payments_pending)} hint="Do not release goods yet" />
              <Stat label="Vendor payments confirmed" value={n(data.vendor_payments_confirmed)} />
              <Stat label="Confirmed payment value" value={formatNaira(data.confirmed_payment_value, { compact: true })} tone="gold" />
              <Stat
                label="Ready for release"
                value={n(data.ready_for_release)}
                hint={can('p.fulfilment.manage') && data.ready_for_release > 0 ? <Link className="font-medium text-gold-strong underline-offset-4 hover:underline" href="/release">Open release queue →</Link> : 'Release authorised by the Bank'}
              />
              <Stat label="Dispatched" value={n(data.dispatched)} />
              <Stat label="Delivered" value={n(data.delivered)} hint="Includes completed" />
              <Stat label="Avg. processing time" value={data.average_processing_hours === null ? '—' : `${data.average_processing_hours} h`} hint="Checkout to completion" />
            </div>
          </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Daily activity"
                description={metric === 'applications' ? 'Applications created per day' : 'Requested value per day'}
                actions={
                  <Tabs
                    label="Chart metric"
                    value={metric}
                    onChange={(v) => setMetric(v as 'applications' | 'value')}
                    tabs={[
                      { id: 'applications', label: 'Applications' },
                      { id: 'value', label: 'Value' },
                    ]}
                  />
                }
              />
              <div className="px-5 py-5">
                {data.daily.every((d) => d.applications === 0) ? (
                  <EmptyState title="No applications in this period" description="Applications appear here as customers choose Pay with ARAF at checkout." />
                ) : (
                  <BarChart
                    label={metric === 'applications' ? 'Applications per day' : 'Requested value per day'}
                    data={data.daily.map((d) => ({ label: formatDate(d.date), value: metric === 'applications' ? d.applications : d.value }))}
                    format={(v) => (metric === 'applications' ? `${v} applications` : formatNaira(v))}
                    height={200}
                  />
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Status breakdown" description="Current merchant status of applications in range" />
              {data.status_breakdown.length === 0 ? (
                <EmptyState title="Nothing to show yet" />
              ) : (
                <ul className="space-y-3 px-5 py-5">
                  {[...data.status_breakdown]
                    .sort((a, b) => b.count - a.count)
                    .map((s) => (
                      <li key={s.status}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          {can('p.application.read') ? (
                            <Link href={`/applications?status=${s.status}`} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                              <StatusBadge status={s.status} label={MERCHANT_STATUS_LABEL[s.status] ?? undefined} />
                            </Link>
                          ) : (
                            <StatusBadge status={s.status} label={MERCHANT_STATUS_LABEL[s.status] ?? undefined} />
                          )}
                          <span className="tabular-nums text-fg">{s.count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                          <div className="h-1.5 rounded-full bg-gold" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
