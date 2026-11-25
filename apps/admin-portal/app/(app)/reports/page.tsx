'use client';

import { useEffect, useState } from 'react';
import { Alert, Card, DataTable, EmptyState, FunnelChart, PageHeader, Stat, Tabs, formatNaira, formatPercent, humanize } from '@araf/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Async, FilterField, Guard, Section, filterControl } from '@/components/common';
import { ColumnChart, HBarList } from '@/components/charts';
import { DEFAULT_RANGE, RangeFilter, rangeLabel, rangeParams, type RangeValue } from '@/components/range';
import { Icon } from '@/components/icons';

interface CreditReport {
  score_distribution: Array<{ range: string; count: number }>;
  bands: Array<{ key: string; count: number }>;
  affordability_outcomes: Array<{ key: string; count: number }>;
  decline_reasons: Array<{ key: string; count: number }>;
  manual_review_outcomes: Array<{ key: string; count: number }>;
  exposure_reserved: number;
}
interface Portfolio { available: boolean; reason: string; metrics: string[] }

export default function ReportsPage() {
  return <Guard perm="report.read"><Reports /></Guard>;
}

function Reports() {
  const { can } = useSession();
  const [tab, setTab] = useState('funnel');
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [partner, setPartner] = useState('');
  useEffect(() => { document.title = 'Reports · Pay with ARAF admin'; }, []);
  const partners = useApi<Array<{ id: string; trading_name: string }>>(can('partner.read') ? '/api/admin/partners' : null);
  const rp = rangeParams(range);
  const funnel = useApi<Array<{ key: string; label: string; count: number }>>(tab === 'funnel' ? `/api/admin/reports/funnel${qs({ ...rp, partner_id: partner })}` : null);
  const credit = useApi<CreditReport>(tab === 'credit' ? `/api/admin/reports/credit${qs(rp)}` : null);
  const portfolio = useApi<Portfolio>(tab === 'portfolio' ? '/api/admin/reports/portfolio' : null);
  const sensitive = can('application.read.sensitive');

  const tabs = [
    { id: 'funnel', label: 'Funnel' },
    ...(sensitive ? [{ id: 'credit', label: 'Credit' }] : []),
    { id: 'portfolio', label: 'Portfolio' },
    ...(can('report.export') ? [{ id: 'export', label: 'Export' }] : []),
  ];

  return (
    <>
      <PageHeader eyebrow="Insight" title="Reports" description="Management reporting computed from platform records. Metrics that require systems not yet integrated are shown as unavailable rather than estimated." />
      <Tabs label="Reports" value={tab} onChange={setTab} tabs={tabs} />
      <div className="mt-6 space-y-6">
        {tab !== 'portfolio' && (
          <div className="flex flex-wrap items-end gap-3">
            <RangeFilter value={range} onChange={setRange} />
            {(tab === 'funnel' || tab === 'export') && can('partner.read') && (
              <FilterField label="Partner">
                {(id) => <select id={id} className={filterControl} value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">All partners</option>{partners.data?.map((p) => <option key={p.id} value={p.id}>{p.trading_name}</option>)}</select>}
              </FilterField>
            )}
          </div>
        )}

        {tab === 'funnel' && (
          <Section title={`Financing funnel — ${rangeLabel(range)}`} description="Applications created in the period that reached each stage (from recorded state history). Percentages are step-to-step conversion.">
            <Async state={funnel} rows={10}>
              {(steps) => steps.every((s) => s.count === 0) ? <EmptyState title="No applications in this period" description="Choose a wider date range." /> : (
                <div className="grid gap-8 lg:grid-cols-5">
                  <div className="lg:col-span-3"><FunnelChart steps={steps} /></div>
                  <div className="lg:col-span-2">
                    <div className="rounded-md border border-border">
                      <DataTable caption="Funnel" rows={steps} rowKey={(s) => s.key} dense columns={[
                        { key: 'l', header: 'Stage', cell: (s) => s.label },
                        { key: 'c', header: 'Count', align: 'right', cell: (s) => s.count },
                        { key: 'p', header: 'Of initiated', align: 'right', cell: (s) => (steps[0].count ? formatPercent(s.count / steps[0].count, 0) : '—') },
                      ]} />
                    </div>
                  </div>
                </div>
              )}
            </Async>
          </Section>
        )}

        {tab === 'credit' && sensitive && (
          <Async state={credit} rows={10}>
            {(c) => (
              <>
                <Alert tone="gold">Aggregated credit data. Individual scores are not shown here.</Alert>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Assessments" value={c.score_distribution.reduce((s, b) => s + b.count, 0)} hint="Completed in period" />
                  <Stat label="Affordability assessments" value={c.affordability_outcomes.reduce((s, b) => s + b.count, 0)} />
                  <Stat label="Declines" value={c.decline_reasons.reduce((s, b) => s + b.count, 0)} />
                  <Stat label="Exposure reserved" value={formatNaira(c.exposure_reserved, { compact: true })} hint="Active + consumed (all time)" tone="gold" />
                </div>
                <Section title="Score distribution" description="SeedScore buckets for completed assessments.">
                  <ColumnChart label="Score distribution" data={c.score_distribution.map((b) => ({ label: b.range, value: b.count }))} height={180} />
                </Section>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Section title="Score bands"><HBarList label="Score bands" items={c.bands.map((b) => ({ key: b.key, label: humanize(b.key), value: b.count }))} /></Section>
                  <Section title="Affordability outcomes"><HBarList label="Affordability outcomes" items={c.affordability_outcomes.map((b) => ({ key: b.key, label: humanize(b.key), value: b.count }))} /></Section>
                  <Section title="Decline reasons"><HBarList label="Decline reasons" tone="danger" items={[...c.decline_reasons].sort((a, b) => b.count - a.count).map((b) => ({ key: b.key, label: humanize(b.key), value: b.count }))} /></Section>
                  <Section title="Manual review outcomes" description="Effective (checker-approved) review decisions."><HBarList label="Manual review outcomes" items={c.manual_review_outcomes.map((b) => ({ key: b.key, label: humanize(b.key), value: b.count }))} /></Section>
                </div>
              </>
            )}
          </Async>
        )}

        {tab === 'portfolio' && (
          <Async state={portfolio} rows={4}>
            {(p) => p.available ? <Alert tone="info">Portfolio data is available.</Alert> : (
              <Card className="p-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">{Icon.lock('h-5 w-5')}</span>
                  <div>
                    <h2 className="text-base font-semibold">Portfolio metrics are not available</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted">{p.reason}</p>
                    <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-subtle">Unavailable until core banking is integrated</h3>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                      {p.metrics.map((m) => <li key={m} className="flex items-center gap-2 rounded-md border border-dashed border-border-strong px-3 py-2 text-sm text-muted">{Icon.lock('h-3.5 w-3.5')} {m}</li>)}
                    </ul>
                  </div>
                </div>
              </Card>
            )}
          </Async>
        )}

        {tab === 'export' && (
          <Section title="Applications export (CSV)" description="One row per application with partner, order, internal state, merchant status and amounts. Exports are recorded in the audit log.">
            <a href={`/api/admin/reports/applications.csv${qs({ ...rp, partner_id: partner })}`} download className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-ink-contrast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              {Icon.download()} Download CSV — {rangeLabel(range)}
            </a>
            <p className="mt-3 text-xs text-muted">No BVNs, account numbers or credit details are included. Maximum 10,000 rows.</p>
          </Section>
        )}
      </div>
    </>
  );
}
