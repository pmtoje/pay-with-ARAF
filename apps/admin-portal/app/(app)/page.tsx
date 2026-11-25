'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, DataTable, FunnelChart, LoadingBlock, PageHeader, Stat, StatusBadge, formatDateTime, formatNaira, formatPercent, humanize } from '@araf/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { hours } from '@/lib/labels';
import { Async, ErrorAlert, Section, Segmented } from '@/components/common';
import { ColumnChart, HBarList } from '@/components/charts';
import { DEFAULT_RANGE, RangeFilter, rangeLabel, rangeParams, type RangeValue } from '@/components/range';
import { navFor } from '@/components/shell';
import { Icon } from '@/components/icons';

export interface Overview {
  range: { from: string; to: string };
  environment: string;
  partners_onboarded: number;
  partners_active: number;
  total_applications: number;
  requested_value: number;
  eligible_value: number;
  approved_value: number;
  booked_value: number;
  confirmed_vendor_payments: number;
  completed_deliveries: number;
  conversion_rate: number | null;
  approval_rate: number | null;
  decline_rate: number | null;
  average_turnaround_hours: number | null;
  pending_reviews: number;
  open_exceptions: number;
  pending_by_stage: Array<{ stage: string; count: number }>;
  partner_performance: Array<{ partner: string; status: string; applications: number; requested: number; approved: number }>;
  category_performance: Array<{ category: string; value: number }>;
  integration_performance: Array<{ provider: string; calls: number; success_rate: number; p50_ms: number; p95_ms: number; simulated: boolean }>;
  daily: Array<{ date: string; applications: number; value: number }>;
}

export type FunnelStep = { key: string; label: string; count: number };

export default function OverviewPage() {
  const { can, me } = useSession();
  const router = useRouter();
  const allowed = can('report.read');
  useEffect(() => {
    document.title = 'Executive overview · Pay with ARAF admin';
    if (!allowed) {
      const first = navFor(can, me.sandbox).find((n) => n.href !== '/');
      router.replace(first?.href ?? '/approvals');
    }
  }, [allowed, can, me.sandbox, router]);
  if (!allowed) return <LoadingBlock rows={6} label="Opening your workspace" />;
  return <OverviewDashboard />;
}

function OverviewDashboard() {
  const { can } = useSession();
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [metric, setMetric] = useState<'applications' | 'value'>('applications');
  const q = qs(rangeParams(range));
  const overview = useApi<Overview>(`/api/admin/overview${q}`);
  const funnel = useApi<FunnelStep[]>(`/api/admin/reports/funnel${q}`);
  const d = overview.data;

  return (
    <>
      <PageHeader
        eyebrow="Executive overview"
        title="Gateway performance"
        description={d ? <>Every figure is computed from platform records for {rangeLabel(range).toLowerCase()} ({formatDateTime(d.range.from)} – {formatDateTime(d.range.to)}). Nothing is estimated.</> : 'Every figure is computed from platform records. Nothing is estimated.'}
        actions={
          <Button variant="secondary" size="sm" onClick={() => { overview.reload(); funnel.reload(); }} loading={overview.loading && !!d}>
            {Icon.refresh()} Refresh
          </Button>
        }
      />
      <RangeFilter value={range} onChange={setRange} className="mb-6" />

      {overview.error ? <ErrorAlert error={overview.error} onRetry={overview.reload} className="mb-6" /> : null}

      {!d ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-[104px] animate-pulse rounded-lg border border-border bg-surface" />)}</div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-subtle">Financing pipeline (value)</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
              <Stat label="Applications" value={d.total_applications.toLocaleString('en-NG')} hint="Created in period" />
              <Stat label="Requested" value={formatNaira(d.requested_value, { compact: true, noKobo: true })} hint="Cart value at checkout" />
              <Stat label="Eligible" value={formatNaira(d.eligible_value, { compact: true, noKobo: true })} hint="Indicative — not approval" />
              <Stat label="Approved" value={formatNaira(d.approved_value, { compact: true, noKobo: true })} hint="ARAF approved financing" tone="gold" />
              <Stat label="Booked" value={formatNaira(d.booked_value, { compact: true, noKobo: true })} hint="Booked in core banking" />
              <Stat label="Vendor paid" value={formatNaira(d.confirmed_vendor_payments, { compact: true, noKobo: true })} hint="Confirmed by payment system" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
            <Stat label="Conversion" value={formatPercent(d.conversion_rate)} hint="Approved ÷ applications" />
            <Stat label="Approval rate" value={formatPercent(d.approval_rate)} hint="Of decided applications" />
            <Stat label="Decline rate" value={formatPercent(d.decline_rate)} hint="Of decided applications" />
            <Stat label="Avg. turnaround" value={hours(d.average_turnaround_hours)} hint="Created → completed" />
            <Stat label="Deliveries" value={d.completed_deliveries.toLocaleString('en-NG')} hint="Delivered or completed" />
            <Stat label="Partners" value={`${d.partners_active} / ${d.partners_onboarded}`} hint="Active / onboarded" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <QueueTile href="/reviews" label="Pending credit reviews" value={d.pending_reviews} hint="Current — all periods" show={can('application.read.sensitive')} />
            <QueueTile href="/operations" label="Open operational exceptions" value={d.open_exceptions} hint="Current — all periods" show={can('application.read')} danger />
          </div>

          <div className="grid gap-6 xl:grid-cols-5">
            <Section
              className="xl:col-span-3"
              title="Daily applications"
              description="Applications created per day (UTC)."
              actions={<Segmented label="Metric" value={metric} onChange={setMetric} options={[{ id: 'applications', label: 'Count' }, { id: 'value', label: 'Value' }]} />}
            >
              <ColumnChart
                label={metric === 'applications' ? 'Applications per day' : 'Requested value per day'}
                data={d.daily.map((x) => ({ label: x.date.slice(5), value: metric === 'applications' ? x.applications : x.value }))}
                format={(v) => (metric === 'applications' ? v.toLocaleString('en-NG') : formatNaira(v, { compact: true, noKobo: true }))}
              />
            </Section>
            <Section className="xl:col-span-2" title="Financing funnel" description="Applications that reached each stage.">
              <Async state={funnel} rows={8}>
                {(steps) => (steps.every((s) => s.count === 0) ? <p className="py-10 text-center text-sm text-muted">No applications in this period.</p> : <FunnelChart steps={steps} />)}
              </Async>
            </Section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="In-flight applications by stage" description="Non-terminal applications created in the period.">
              <HBarList
                label="Pending applications by stage"
                items={[...d.pending_by_stage].sort((a, b) => b.count - a.count).map((s) => ({ key: s.stage, label: humanize(s.stage), value: s.count, href: `/applications?status=${s.stage}` }))}
                empty="No in-flight applications in this period."
              />
            </Section>
            <Section title="Category performance" description="Cart value by product category.">
              <HBarList
                label="Requested value by category"
                items={[...d.category_performance].sort((a, b) => b.value - a.value).map((c) => ({ key: c.category, label: humanize(c.category), value: c.value }))}
                format={(v) => formatNaira(v, { compact: true, noKobo: true })}
                empty="No cart items in this period."
              />
            </Section>
          </div>

          <Section title="Partner performance" flush>
            <DataTable
              caption="Partner performance"
              rows={d.partner_performance}
              rowKey={(r) => r.partner}
              dense
              empty={<p className="px-5 py-8 text-center text-sm text-muted">No partners yet.</p>}
              columns={[
                { key: 'p', header: 'Partner', cell: (r) => <span className="font-medium">{r.partner}</span>, sortValue: (r) => r.partner },
                { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { key: 'a', header: 'Applications', align: 'right', cell: (r) => r.applications.toLocaleString('en-NG'), sortValue: (r) => r.applications },
                { key: 'r', header: 'Requested', align: 'right', cell: (r) => formatNaira(r.requested), sortValue: (r) => r.requested },
                { key: 'ap', header: 'Approved', align: 'right', cell: (r) => r.approved.toLocaleString('en-NG'), sortValue: (r) => r.approved },
                { key: 'c', header: 'Conversion', align: 'right', cell: (r) => (r.applications ? formatPercent(r.approved / r.applications) : '—'), sortValue: (r) => (r.applications ? r.approved / r.applications : -1) },
              ]}
            />
          </Section>

          <Section title="Integration performance" description="Provider calls recorded in the period. Sandbox calls are simulated." flush>
            <DataTable
              caption="Integration performance"
              rows={d.integration_performance}
              rowKey={(r) => r.provider}
              dense
              empty={<p className="px-5 py-8 text-center text-sm text-muted">No provider calls in this period.</p>}
              columns={[
                { key: 'p', header: 'Provider', cell: (r) => <span className="font-medium">{humanize(r.provider)}</span>, sortValue: (r) => r.provider },
                { key: 'c', header: 'Calls', align: 'right', cell: (r) => r.calls.toLocaleString('en-NG'), sortValue: (r) => r.calls },
                { key: 'sr', header: 'Success', align: 'right', cell: (r) => <span className={r.success_rate < 0.95 ? 'text-danger' : ''}>{formatPercent(r.success_rate)}</span>, sortValue: (r) => r.success_rate },
                { key: 'p50', header: 'p50', align: 'right', cell: (r) => <span className="whitespace-nowrap">{r.p50_ms} ms</span> },
                { key: 'p95', header: 'p95', align: 'right', cell: (r) => <span className="whitespace-nowrap">{r.p95_ms} ms</span> },
                { key: 'm', header: 'Mode', cell: (r) => (r.simulated ? <Badge tone="warning">Simulated</Badge> : <Badge tone="info">Live</Badge>) },
              ]}
            />
          </Section>
        </div>
      )}
    </>
  );
}

function QueueTile({ href, label, value, hint, danger, show }: { href: string; label: string; value: number; hint: string; show: boolean; danger?: boolean }) {
  const Comp = show ? Link : 'div';
  return (
    <Comp href={href} className="group flex items-center justify-between rounded-lg border border-border bg-surface px-5 py-4 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</p>
        <p className="mt-1 text-xs text-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className={`text-2xl font-semibold tabular-nums ${value > 0 && danger ? 'text-danger' : value > 0 ? 'text-gold-strong' : 'text-fg'}`}>{value}</span>
        {show && <span className="text-subtle transition-transform group-hover:translate-x-0.5">{Icon.chevron()}</span>}
      </div>
    </Comp>
  );
}
