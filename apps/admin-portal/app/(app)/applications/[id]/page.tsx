'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, DataTable, EmptyState, KeyValue, LoadingBlock, PageHeader, StatusBadge, Tabs, Timeline, formatDate, formatDateTime, formatNaira, humanize, statusTone } from '@araf/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ErrorAlert, Guard, JsonBlock, Mono, Section } from '@/components/common';
import { MaybeBadge, Milestones, OperationsPanel } from '@/components/application-ops';
import type { AppDetail } from '@/components/application-types';
import { Icon } from '@/components/icons';

export default function ApplicationPage() {
  return <Guard perm="application.read"><Application /></Guard>;
}

const pct = (v: unknown) => (typeof v === 'number' ? (v <= 1 ? `${Math.round(v * 100)}%` : String(v)) : v ? String(v) : '—');

function Application() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const state = useApi<AppDetail>(`/api/admin/applications/${id}`);
  const [tab, setTab] = useState('summary');
  const a = state.data;
  useEffect(() => {
    if (a) document.title = `${a.reference} · Applications · Pay with ARAF admin`;
  }, [a]);

  if (state.error && !a) return <ErrorAlert error={state.error} onRetry={state.reload} title="Application could not be loaded" />;
  if (!a) return <Card><LoadingBlock rows={10} /></Card>;

  const tabs = [
    { id: 'summary', label: 'Summary' },
    ...(a.sensitive_access ? [{ id: 'credit', label: 'Credit & affordability' }] : []),
    { id: 'statements', label: 'Statements', count: a.statement_connections.length },
    { id: 'offers', label: 'Offers', count: a.offers.length },
    { id: 'araf', label: 'ARAF' },
    { id: 'conditions', label: 'Conditions & documents' },
    { id: 'operations', label: 'Operations' },
    { id: 'payments', label: 'Payments', count: a.payments.length },
    { id: 'release', label: 'Release & fulfilment' },
    { id: 'exceptions', label: 'Exceptions', count: a.exceptions.filter((e) => e.status !== 'RESOLVED').length || undefined },
    { id: 'history', label: 'History', count: a.history.length },
  ];

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/applications" className="inline-flex items-center gap-1 hover:underline">{Icon.back('h-3.5 w-3.5')} Applications</Link>}
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono tracking-tight">{a.reference}</span><StatusBadge status={a.status} /></span>}
        description={<>{a.partner.name} · order <Mono>{a.order.reference}</Mono> · created {formatDateTime(a.created_at)}{a.expires_at ? ` · expires ${formatDateTime(a.expires_at)}` : ''}</>}
        actions={<Button variant="secondary" size="sm" onClick={state.reload} loading={state.loading}>{Icon.refresh()} Refresh</Button>}
      />

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <StatusTile label="Internal state" value={<StatusBadge status={a.status} />} hint={a.exception_return_state ? `Returns to ${humanize(a.exception_return_state)} when resolved` : `Machine version ${a.version}`} />
        <StatusTile label="Customer sees" value={<span className="text-sm font-medium">{a.customer_status.label}</span>} hint={a.customer_status.description} />
        <StatusTile label="Merchant sees" value={<StatusBadge status={a.merchant_status} />} hint="Operational status — no credit details are shared" />
      </div>
      {a.holds.length > 0 && <Alert tone="warning" className="mb-5" title="Active holds">{a.holds.map(humanize).join(', ')} — goods release is blocked while a hold is active.</Alert>}
      {state.error ? <ErrorAlert error={state.error} title="Could not refresh" className="mb-5" /> : null}

      <div className="mb-6"><Milestones app={a} /></div>

      <Tabs label="Application sections" value={tab} onChange={setTab} tabs={tabs} />
      <div className="mt-6 space-y-6">
        {tab === 'summary' && <Summary a={a} />}
        {tab === 'credit' && a.sensitive_access && <Credit a={a} />}
        {tab === 'statements' && <Statements a={a} canOpen={can('document.read.sensitive')} />}
        {tab === 'offers' && <Offers a={a} />}
        {tab === 'araf' && <Araf a={a} onChanged={state.reload} />}
        {tab === 'conditions' && <Conditions a={a} />}
        {tab === 'operations' && <OperationsPanel app={a} onChanged={state.reload} />}
        {tab === 'payments' && <Payments a={a} onChanged={state.reload} />}
        {tab === 'release' && <Release a={a} />}
        {tab === 'exceptions' && <Exceptions a={a} />}
        {tab === 'history' && <History a={a} />}
      </div>
    </>
  );
}

function StatusTile({ label, value, hint }: { label: string; value: ReactNode; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-subtle">{label}</p>
      <div className="mt-1.5">{value}</div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function Summary({ a }: { a: AppDetail }) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Section title="Order" description={<>Merchant order <Mono>{a.order.reference}</Mono> · <StatusBadge status={a.order.status} /></>} flush>
          <DataTable
            caption="Order items"
            rows={a.order.items}
            rowKey={(i) => i.sku}
            dense
            columns={[
              { key: 'n', header: 'Item', cell: (i) => <div><p className="font-medium">{i.name}</p><p className="text-xs text-muted"><Mono>{i.sku}</Mono> · {i.category}</p></div> },
              { key: 'q', header: 'Qty', align: 'right', cell: (i) => i.quantity },
              { key: 'u', header: 'Unit', align: 'right', cell: (i) => formatNaira(i.unit_amount) },
              { key: 'l', header: 'Line total', align: 'right', cell: (i) => <span className="font-medium">{formatNaira(i.line_amount)}</span> },
            ]}
          />
          <div className="flex justify-end border-t border-border px-4 py-3 text-sm"><span className="text-muted">Order total</span><span className="ml-6 font-semibold tabular-nums">{formatNaira(a.order.amount)}</span></div>
        </Section>
        <Section title="Amounts">
          <KeyValue
            columns={3}
            items={[
              { label: 'Purchase', value: formatNaira(a.amounts.purchase) },
              { label: 'Eligible (indicative)', value: a.amounts.eligible === undefined ? <span className="text-subtle">Restricted</span> : formatNaira(a.amounts.eligible) },
              { label: 'Financing', value: formatNaira(a.amounts.financing) },
              { label: 'Customer equity (to merchant)', value: formatNaira(a.amounts.contribution) },
              { label: 'Equity status', value: a.equity?.required ? `${humanize(a.equity.status)}${a.equity.payment_reference ? ` · ${a.equity.payment_reference}` : ''}` : 'Not required' },
              { label: 'Product profit rate', value: a.annual_profit_rate_percent !== undefined ? `${a.annual_profit_rate_percent}% p.a.` : '—' },
              { label: 'Income profile', value: a.income_profile ? humanize(a.income_profile) : '—' },
              { label: 'Environment', value: humanize(a.environment) },
            ]}
          />
        </Section>
      </div>
      <div className="space-y-6">
        <Section title="Customer" description="Masked — full identifiers are never displayed.">
          {a.customer ? (
            <KeyValue columns={1} items={[{ label: 'Name', value: a.customer.name }, { label: 'BVN', value: a.customer.bvn, mono: true }, { label: 'Phone', value: a.customer.phone, mono: true }]} />
          ) : <p className="text-sm text-muted">Identity not yet verified.</p>}
        </Section>
        <Section title="Repayment account">
          {a.account ? (
            <KeyValue columns={1} items={[{ label: 'Account', value: a.account.number, mono: true }, { label: 'Account name', value: a.account.name }, { label: 'Product', value: a.account.product }, { label: 'Source', value: humanize(a.account.source) }]} />
          ) : <p className="text-sm text-muted">No account selected yet.</p>}
        </Section>
        <Section title="Mandate & booking">
          <KeyValue
            columns={1}
            items={[
              { label: 'Repayment mandate', value: a.mandate ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status={a.mandate.status} />{a.mandate.reference && <Mono>{a.mandate.reference}</Mono>}{a.mandate.failure && <span className="text-danger">{humanize(a.mandate.failure)}</span>}</span> : 'Not started' },
              { label: 'Core banking booking', value: a.booking ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status={a.booking.status} />{a.booking.reference && <Mono>{a.booking.reference}</Mono>}{a.booking.failure && <span className="text-danger">{humanize(a.booking.failure)}</span>}</span> : 'Not booked' },
            ]}
          />
        </Section>
        {a.reviews.length > 0 && (
          <Section title="Enhanced reviews">
            <ul className="space-y-2 text-sm">
              {a.reviews.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link href={`/reviews/${r.id}`} className="font-medium text-gold-strong hover:underline">{humanize(r.queue)}</Link>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function Credit({ a }: { a: AppDetail }) {
  return (
    <>
      <Alert tone="gold" title="Sensitive credit data — access is audited">
        Your view of this tab was recorded in the audit log. Do not copy credit information outside the system or share it with the merchant.
      </Alert>
      <Section title="Credit assessments (SeedFi)" flush>
        <DataTable
          caption="Credit assessments"
          rows={a.credit ?? []}
          rowKey={(c) => c.at}
          dense
          empty={<p className="px-5 py-6 text-sm text-muted">No credit assessment yet.</p>}
          columns={[
            { key: 'at', header: 'Assessed', cell: (c) => <span className="whitespace-nowrap text-muted">{formatDateTime(c.at)}</span> },
            { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            { key: 'sc', header: 'Score', align: 'right', cell: (c) => <span className="font-semibold">{c.score ?? '—'}</span> },
            { key: 'b', header: 'Band', cell: (c) => (c.band ? <Badge tone={c.band === 'GOOD' ? 'success' : c.band === 'FAIR' ? 'warning' : 'danger'}>{c.band}</Badge> : '—') },
            { key: 'o', header: 'Outcome', cell: (c) => (c.outcome ? humanize(c.outcome) : '—') },
            { key: 'ob', header: 'Bureau obligations / mo', align: 'right', cell: (c) => formatNaira(c.bureau_obligations) },
            { key: 'd', header: 'Delinquency', cell: (c) => (Array.isArray(c.delinquency) && c.delinquency.length ? c.delinquency.map(String).join(', ') : <span className="text-subtle">None</span>) },
            { key: 'f', header: 'Failure', cell: (c) => (c.failure ? <span className="text-danger">{humanize(c.failure)}</span> : '—') },
          ]}
        />
      </Section>
      <Section title="Statement analysis (Periculum)">
        {a.analysis ? (
          <KeyValue
            columns={3}
            items={[
              { label: 'Reference', value: a.analysis.reference, mono: true },
              { label: 'Period', value: `${formatDate(a.analysis.period[0])} – ${formatDate(a.analysis.period[1])}` },
              { label: 'Account holder', value: a.analysis.holder },
              { label: 'Ownership confidence', value: pct(a.analysis.ownership) },
              { label: 'Average monthly inflow', value: formatNaira(a.analysis.average_inflow) },
              { label: 'Average monthly outflow', value: formatNaira(a.analysis.average_outflow) },
              { label: 'Recurring obligations', value: formatNaira(a.analysis.recurring_obligations) },
              { label: 'Business revenue / month', value: formatNaira(a.analysis.business_revenue) },
              { label: 'Statement quality', value: a.analysis.quality ? humanize(a.analysis.quality) : '—' },
              { label: 'Confidence', value: pct(a.analysis.confidence) },
              { label: 'Stress indicators', value: Array.isArray(a.analysis.stress) && a.analysis.stress.length ? a.analysis.stress.map(String).map(humanize).join(', ') : 'None' },
            ]}
          />
        ) : <p className="text-sm text-muted">No statement analysis yet.</p>}
      </Section>
      {(a.affordability ?? []).length === 0 ? (
        <Section title="Affordability"><p className="text-sm text-muted">No affordability assessment yet.</p></Section>
      ) : (
        (a.affordability ?? []).map((f, i) => (
          <Section key={f.at} title={<span className="flex items-center gap-2">Affordability assessment {i === 0 ? '(latest)' : ''}<StatusBadge status={f.outcome} /></span>} description={`${formatDateTime(f.at)} · policy ${f.policy_version_id.slice(0, 8)}`}>
            <KeyValue
              columns={3}
              items={[
                { label: 'Recognised monthly income', value: formatNaira(f.income) },
                { label: 'Existing obligations / mo', value: formatNaira(f.obligations) },
                { label: 'Monthly capacity', value: <span className="font-semibold">{formatNaira(f.capacity)}</span> },
                { label: 'Existing Bank exposure', value: formatNaira(f.existing_exposure) },
                { label: 'Remaining obligor limit', value: formatNaira(f.remaining_exposure) },
                { label: 'Maximum eligible', value: <span className="font-semibold text-gold-strong">{formatNaira(f.max_eligible)}</span> },
                { label: 'Reasons', value: f.reasons.length ? f.reasons.map(humanize).join(', ') : '—' },
              ]}
            />
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Tenor breakdown</h3>
                {f.tenors?.length ? (
                  <div className="rounded-md border border-border">
                    <DataTable
                      caption="Tenor breakdown"
                      rows={f.tenors}
                      rowKey={(t) => String(t.tenor_months)}
                      dense
                      columns={[
                        { key: 't', header: 'Tenor', cell: (t) => `${t.tenor_months} mo` },
                        { key: 'm', header: 'Markup', align: 'right', cell: (t) => `${(t.markup_bps / 100).toFixed(1)}%` },
                        { key: 'a', header: 'Max affordable', align: 'right', cell: (t) => formatNaira(t.max_affordable, { noKobo: true }) },
                        { key: 'e', header: 'Eligible', align: 'right', cell: (t) => <span className="font-medium">{formatNaira(t.eligible_amount, { noKobo: true })}</span> },
                        { key: 'l', header: 'Limited by', cell: (t) => <span className="text-xs text-muted">{humanize(t.limiting_factor)}</span> },
                      ]}
                    />
                  </div>
                ) : <p className="text-sm text-muted">No tenor breakdown recorded.</p>}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Month-by-month salary</h3>
                {f.months?.length ? (
                  <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {f.months.map((m) => (
                      <li key={m.month} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span className="font-mono text-xs">{m.month}</span>
                        <StatusBadge status={m.status} />
                        <span className="tabular-nums">{formatNaira(m.consolidated, { noKobo: true })}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">No month breakdown recorded.</p>}
              </div>
            </div>
          </Section>
        ))
      )}
    </>
  );
}

function Statements({ a, canOpen }: { a: AppDetail; canOpen: boolean }) {
  return (
    <>
      <Section title="Statement connections" flush>
        <DataTable
          caption="Statement connections"
          rows={a.statement_connections}
          rowKey={(c) => c.at + c.channel}
          dense
          empty={<p className="px-5 py-6 text-sm text-muted">No statement connected yet.</p>}
          columns={[
            { key: 'c', header: 'Channel', cell: (c) => humanize(c.channel) },
            { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            { key: 'p', header: 'Period', cell: (c) => (c.period[0] ? `${formatDate(c.period[0])} – ${formatDate(c.period[1])}` : '—') },
            ...(a.sensitive_access ? [{ key: 'o', header: 'Ownership', cell: (c: AppDetail['statement_connections'][number]) => pct(c.ownership) }] : []),
            { key: 'f', header: 'Validation findings', cell: (c) => (Array.isArray(c.findings) && c.findings.length ? <span className="text-xs">{c.findings.map((x) => (typeof x === 'string' ? humanize(x) : JSON.stringify(x))).join(', ')}</span> : <span className="text-subtle">None</span>) },
            { key: 'at', header: 'Connected', cell: (c) => <span className="whitespace-nowrap text-muted">{formatDateTime(c.at)}</span> },
          ]}
        />
      </Section>
      <Section title="Stored documents" description={canOpen ? 'Opening a document is recorded in the audit log.' : undefined} flush>
        {!canOpen && <div className="px-5 pt-4"><Alert tone="info">Opening customer documents requires the <Mono>document.read.sensitive</Mono> permission.</Alert></div>}
        <DataTable
          caption="Stored documents"
          rows={a.documents_stored}
          rowKey={(d) => d.id}
          dense
          empty={<p className="px-5 py-6 text-sm text-muted">No documents uploaded.</p>}
          columns={[
            { key: 'k', header: 'Kind', cell: (d) => humanize(d.kind) },
            { key: 'f', header: 'File', cell: (d) => <Mono>{d.filename}</Mono> },
            { key: 's', header: 'Size', align: 'right', cell: (d) => `${(d.size / 1024).toFixed(0)} KB` },
            { key: 'sc', header: 'Malware scan', cell: (d) => <StatusBadge status={d.scan} /> },
            { key: 'o', header: '', cell: (d) => (canOpen && d.scan !== 'INFECTED' ? <a href={`/api/admin/applications/${a.id}/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-gold-strong hover:underline">Open {Icon.external('h-3.5 w-3.5')}</a> : <span className="text-subtle">{Icon.lock('h-3.5 w-3.5')}</span>) },
          ]}
        />
      </Section>
    </>
  );
}

function Offers({ a }: { a: AppDetail }) {
  return (
    <Section title="Financing offers" description="Indicative Murabaha offers presented to the customer. An accepted offer is not approval." flush>
      <DataTable
        caption="Offers"
        rows={a.offers}
        rowKey={(o) => o.reference}
        empty={<EmptyState title="No offers yet" description="Offers are generated once the customer is eligible." />}
        columns={[
          { key: 'r', header: 'Offer', cell: (o) => <Mono>{o.reference}</Mono> },
          { key: 's', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
          { key: 't', header: 'Tenor', align: 'right', cell: (o) => `${o.tenor} mo` },
          { key: 'f', header: 'Cost (financed)', align: 'right', cell: (o) => formatNaira(o.financing) },
          { key: 'p', header: 'Profit', align: 'right', cell: (o) => formatNaira(o.profit) },
          { key: 'm', header: 'Markup', align: 'right', cell: (o) => `${(o.markup_bps / 100).toFixed(1)}%` },
          { key: 'd', header: 'Deferred sale price', align: 'right', cell: (o) => <span className="font-medium">{formatNaira(o.dsp)}</span> },
          { key: 'mo', header: 'Monthly', align: 'right', cell: (o) => formatNaira(o.monthly) },
          { key: 'x', header: 'Expires', cell: (o) => <span className="whitespace-nowrap text-muted">{formatDateTime(o.expires_at)}</span> },
        ]}
      />
    </Section>
  );
}

function Araf({ a, onChanged }: { a: AppDetail; onChanged: () => void }) {
  const { can, me } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!a.araf) return <Card><EmptyState title="Not submitted to ARAF" description="The application is submitted once the customer accepts an offer." /></Card>;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Section title="Submission">
        <KeyValue columns={1} items={[
          { label: 'Status', value: <StatusBadge status={a.araf.status} /> },
          { label: 'ARAF reference', value: a.araf.reference ?? '—', mono: true },
          { label: 'Attempts', value: a.araf.attempts },
          { label: 'Last error', value: a.araf.last_error ? <span className="text-danger">{a.araf.last_error}</span> : '—' },
        ]} />
        <p className="mt-4 text-xs text-muted">Submission is idempotent. On timeout ARAF is queried by idempotency key before any retry.</p>
      </Section>
      <Section className="lg:col-span-2" title="ARAF status events" description="Authoritative workflow events. Stale (out-of-order) events are ignored and never overwrite a newer status.">
        {a.araf.events.length === 0 ? <p className="text-sm text-muted">No events received yet.</p> : (
          <Timeline items={a.araf.events.map((e) => ({
            title: <span className="flex flex-wrap items-center gap-2">#{e.sequence} {humanize(e.stage)} <Badge tone={e.outcome === 'APPLIED' ? 'success' : e.outcome === 'IGNORED_STALE' ? 'neutral' : 'warning'}>{humanize(e.outcome)}</Badge></span>,
            meta: `${formatDateTime(e.at)}${e.actor ? ` · ${e.actor}` : ''}`,
            description: e.note ?? undefined,
            tone: e.stage === 'REJECTED' ? 'danger' : e.stage === 'APPROVED' ? 'success' : e.stage === 'INFO_REQUESTED' ? 'warning' : undefined,
          }))} />
        )}
        {me.araf_connected ? (
          <p className="mt-4 text-sm text-muted">Credit decisions are made in ARAF (Pay with ARAF → Checkout applications{a.araf.reference ? `, ${a.araf.reference}` : ''}).</p>
        ) : (
          <Link href="/araf-simulator" className="mt-4 inline-flex text-sm font-medium text-gold-strong hover:underline">Open the ARAF workflow simulator</Link>
        )}
      </Section>
      <Section
        className="lg:col-span-3"
        title="Execution reports sent to ARAF"
        description="Booking, payment, release, fulfilment and refund outcomes reported back to ARAF in order. Each report is idempotent; a delay never blocks or reverses the operation itself."
      >
        {msg && <Alert tone="success" className="mb-3">{msg}</Alert>}
        {!!error && <div className="mb-3"><ErrorAlert error={error} /></div>}
        {!a.araf.outbound_reports?.length ? (
          <p className="text-sm text-muted">Nothing reported yet. Reports start once financing is booked.</p>
        ) : (
          <DataTable
            caption="Execution reports sent to ARAF"
            rowKey={(r) => r.event_id}
            rows={a.araf.outbound_reports}
            dense
            columns={[
              { key: 'seq', header: '#', cell: (r) => r.sequence },
              { key: 'type', header: 'Report', cell: (r) => humanize(r.type) },
              { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'DELIVERED' ? 'DELIVERED' : r.status} label={r.status === 'DELIVERED' ? 'Acknowledged' : humanize(r.status)} /> },
              { key: 'attempts', header: 'Attempts', align: 'right', cell: (r) => r.attempts },
              { key: 'when', header: 'Acknowledged', cell: (r) => (r.delivered_at ? formatDateTime(r.delivered_at) : '—') },
              { key: 'err', header: 'Last error', cell: (r) => (r.last_error ? <span className="text-xs text-danger">{r.last_error}</span> : '—') },
            ]}
          />
        )}
        {can('exception.manage') && a.araf.outbound_reports?.some((r) => r.status !== 'DELIVERED') && (
          <Button
            className="mt-4"
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              setMsg(null);
              try {
                const r = await api.post<{ requeued: number }>(`/api/admin/applications/${a.id}/araf-reports/retry`);
                setMsg(`${r.requeued} report(s) queued for immediate redelivery.`);
                onChanged();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry undelivered reports now
          </Button>
        )}
      </Section>
    </div>
  );
}

const CONDITION_ORDER = ['PROMISE_TO_PURCHASE_SIGNED', 'MANDATE_ACTIVE', 'ASSET_ACQUIRED', 'POSSESSION_EVIDENCED', 'COST_AND_PROFIT_DISCLOSED', 'SALE_CONTRACT_EXECUTED'];

function Conditions({ a }: { a: AppDetail }) {
  const conds = [...a.conditions].sort((x, y) => CONDITION_ORDER.indexOf(x.code) - CONDITION_ORDER.indexOf(y.code));
  const done = conds.filter((c) => c.status === 'SATISFIED').length;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Section className="lg:col-span-3" title="Murabaha conditions" description={conds.length ? `${done} of ${conds.length} satisfied. Goods release requires all of them.` : 'Created when financing is approved.'}>
        {conds.length === 0 ? <p className="text-sm text-muted">No contractual conditions yet.</p> : (
          <ol className="space-y-2">
            {conds.map((c, i) => {
              const ok = c.status === 'SATISFIED';
              return (
                <li key={c.code} className="flex items-start gap-3 rounded-md border border-border px-3 py-2.5">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold ${ok ? 'bg-success text-white' : 'border border-border-strong text-subtle'}`} aria-hidden="true">{ok ? '✓' : i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.description}</p>
                    <p className="text-xs text-muted"><Mono>{c.code}</Mono>{c.satisfied_at ? ` · satisfied ${formatDateTime(c.satisfied_at)}` : ''}{c.evidence ? ` · evidence: ${c.evidence}` : ''}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </li>
              );
            })}
          </ol>
        )}
      </Section>
      <Section className="lg:col-span-2" title="Financing documents" flush>
        <DataTable
          caption="Financing documents"
          rows={a.financing_documents}
          rowKey={(d) => d.id}
          dense
          empty={<p className="px-5 py-6 text-sm text-muted">No documents issued yet.</p>}
          columns={[
            { key: 't', header: 'Document', cell: (d) => <div><p className="font-medium">{humanize(d.type)}</p><p className="text-2xs text-subtle">v{d.version}{d.signed_at ? ` · signed ${formatDateTime(d.signed_at)}` : ''}</p></div> },
            { key: 's', header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
            { key: 'o', header: '', cell: (d) => <a className="inline-flex items-center gap-1 text-sm font-medium text-gold-strong hover:underline" href={`/api/admin/applications/${a.id}/financing-documents/${d.id}.pdf`} target="_blank" rel="noopener noreferrer">PDF {Icon.external('h-3.5 w-3.5')}</a> },
          ]}
        />
      </Section>
    </div>
  );
}

function Payments({ a, onChanged }: { a: AppDetail; onChanged: () => void }) {
  const { can } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const reconcile = async (id: string) => {
    setBusy(id);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ status: string }>(`/api/admin/payments/${id}/reconcile`);
      setMsg(`Reconciled with the payment system — status ${humanize(r.status)}.`);
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  if (!a.payments.length)
    return (
      <>
        <BackupCardPanel applicationId={a.id} />
        <Card><EmptyState title="No vendor payment instructions" description={a.payment_blockers?.length ? `Payment is blocked by: ${a.payment_blockers.map(humanize).join(', ')}.` : 'Instructions are created by a Settlement Officer after booking.'} /></Card>
      </>
    );
  return (
    <>
      <BackupCardPanel applicationId={a.id} />
      <div aria-live="polite">{msg && <Alert tone="success">{msg}</Alert>}{error ? <ErrorAlert error={error} title="Reconciliation failed" /> : null}</div>
      {a.payments.map((p) => (
        <Section
          key={p.id}
          title={<span className="flex flex-wrap items-center gap-2"><Mono>{p.reference}</Mono><StatusBadge status={p.status} />{p.simulated && <Badge tone="warning">Simulated</Badge>}</span>}
          description={p.beneficiary}
          actions={can('payment.reconcile') ? <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => reconcile(p.id)}>{Icon.reconcile()} Reconcile</Button> : undefined}
        >
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <KeyValue columns={1} items={[
                { label: 'Amount', value: <span className="text-lg font-semibold tabular-nums">{formatNaira(p.amount)}</span> },
                { label: 'Confirmed by authoritative source', value: <MaybeBadge ok={p.authoritative} yes="Yes — authoritative" no="No" /> },
                { label: 'Provider reference', value: p.provider_reference ?? '—', mono: true },
                { label: 'Reconciliation', value: p.reconciliation ? <StatusBadge status={p.reconciliation} /> : '—' },
              ]} />
              {p.status === 'CONFIRMED' && !p.authoritative && <Alert tone="warning" className="mt-4">Confirmed status without authoritative confirmation does not authorise release.</Alert>}
            </div>
            <div className="lg:col-span-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Payment events</h3>
              <Timeline items={p.events.map((e) => ({ title: <span className="flex items-center gap-2"><StatusBadge status={e.status} /><span className="text-xs text-muted">via {humanize(e.source)}</span></span>, meta: formatDateTime(e.at), description: e.detail ?? undefined, tone: statusTone(e.status) }))} />
            </div>
          </div>
        </Section>
      ))}
      {a.refunds.length > 0 && (
        <Section title="Refunds" flush>
          <DataTable caption="Refunds" rows={a.refunds} rowKey={(r) => r.reference} dense columns={[
            { key: 'r', header: 'Reference', cell: (r) => <Mono>{r.reference}</Mono> },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            { key: 'e', header: 'Expected', align: 'right', cell: (r) => formatNaira(r.expected) },
            { key: 'x', header: 'Received', align: 'right', cell: (r) => formatNaira(r.received) },
          ]} />
        </Section>
      )}
    </>
  );
}

interface BackupCard {
  card: { status: string; last4: string | null; card_type: string | null; bank: string | null; expires: string | null } | null;
  charges: Array<{ id: string; reference: string; amount: number; reason: string; status: string; gateway_response: string | null; created_at: string }>;
}

/**
 * Backup repayment card (any bank, via Paystack). Charged only when the AltBank account is not funded:
 * a Settlement Officer proposes the charge and a Finance Officer approves it in the Approvals inbox.
 */
function BackupCardPanel({ applicationId }: { applicationId: string }) {
  const { can } = useSession();
  const state = useApi<BackupCard>(`/api/admin/applications/${applicationId}/backup-card`);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const d = state.data;
  if (!d) return null;
  const propose = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.post<{ approval: string }>(`/api/admin/applications/${applicationId}/backup-card/charges`, { amount_naira: Number(amount.replace(/[^\d.]/g, '')), reason });
      setMsg(`Charge proposed — approval ${r.approval} is waiting for a second officer.`);
      setAmount('');
      setReason('');
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Backup repayment card" description="Charged only when the Alternative Bank account is not funded on a due date. Every charge needs a second officer’s approval.">
      {!d.card ? (
        <p className="text-sm text-muted">No backup card has been added yet.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2 space-y-4">
            <KeyValue columns={1} items={[
              { label: 'Card', value: `${(d.card.card_type ?? 'card').toUpperCase()} •••• ${d.card.last4 ?? ''}` },
              { label: 'Bank', value: d.card.bank ?? '—' },
              { label: 'Expires', value: d.card.expires ?? '—' },
              { label: 'Status', value: <StatusBadge status={d.card.status} /> },
            ]} />
            {can('payment.initiate') && d.card.status === 'ACTIVE' && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <p className="text-sm font-medium text-fg">Propose a charge for a missed instalment</p>
                <label className="block text-xs text-muted">Amount (₦)
                  <input className="mt-1 h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </label>
                <label className="block text-xs text-muted">Reason
                  <input className="mt-1 h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Instalment 2: AltBank account not funded" />
                </label>
                <div aria-live="polite">{msg && <Alert tone="success">{msg}</Alert>}{error ? <ErrorAlert error={error} title="Charge not proposed" /> : null}</div>
                <Button size="sm" loading={busy} disabled={!amount || reason.trim().length < 5} onClick={() => void propose()}>
                  {amount ? `Propose charging ${formatNaira(Math.round(Number(amount.replace(/[^\d.]/g, '')) * 100))} (needs approval)` : 'Propose a charge (needs approval)'}
                </Button>
              </div>
            )}
          </div>
          <div className="lg:col-span-3">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Charges</h3>
            {d.charges.length === 0 ? (
              <p className="text-sm text-muted">No charges.</p>
            ) : (
              <DataTable caption="Backup card charges" rows={d.charges} rowKey={(c) => c.id} dense columns={[
                { key: 'a', header: 'Amount', align: 'right', cell: (c) => formatNaira(c.amount) },
                { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
                { key: 'r', header: 'Reason', cell: (c) => c.reason },
                { key: 'g', header: 'Response', cell: (c) => c.gateway_response ?? '—' },
                { key: 'd', header: 'Requested', cell: (c) => formatDateTime(c.created_at) },
              ]} />
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function Release({ a }: { a: AppDetail }) {
  const g = a.release_gate;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Release gate (live evaluation)" description="Computed now from current records.">
        <div className="flex items-center gap-3">
          {g.authorized ? <Badge tone="success">All conditions met</Badge> : <Badge tone="warning">Not authorised</Badge>}
        </div>
        {(g.blockers.length > 0 || g.pending_conditions.length > 0) && (
          <ul className="mt-4 space-y-1.5 text-sm">
            {g.blockers.map((b) => <li key={b} className="flex items-center gap-2"><span className="text-danger">{Icon.x()}</span>{humanize(b)}</li>)}
            {g.pending_conditions.map((c) => <li key={c} className="flex items-center gap-2"><span className="text-warning">{Icon.dot()}</span>Pending: {humanize(c)}</li>)}
          </ul>
        )}
      </Section>
      <Section title="Release authorisation">
        {a.release ? (
          <KeyValue columns={1} items={[
            { label: 'Reference', value: a.release.reference, mono: true },
            { label: 'Status', value: <span className="flex items-center gap-2"><StatusBadge status={a.release.status} />{a.release.simulated && <Badge tone="warning">Simulated</Badge>}</span> },
            { label: 'Authorised at', value: formatDateTime(a.release.authorized_at) },
            { label: 'Suspension reason', value: a.release.suspended_reason ?? '—' },
          ]} />
        ) : <p className="text-sm text-muted">No release authorisation issued. The vendor must not release goods.</p>}
      </Section>
      <Section className="lg:col-span-2" title="Fulfilment">
        {a.fulfilment.length === 0 ? <p className="text-sm text-muted">No dispatch or delivery recorded.</p> : (
          <Timeline items={a.fulfilment.map((f) => ({ title: humanize(f.status), meta: `${formatDateTime(f.at)} · ${humanize(f.actor)}`, description: [f.carrier, f.tracking, f.note].filter(Boolean).join(' · ') || undefined, tone: statusTone(f.status) }))} />
        )}
      </Section>
      {(a.cancellations.length > 0 || a.returns.length > 0) && (
        <Section className="lg:col-span-2" title="Cancellations & returns">
          <ul className="space-y-2 text-sm">
            {a.cancellations.map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2"><Badge>Cancellation</Badge><StatusBadge status={c.status} /><span>{c.reason}</span><span className="text-xs text-muted">by {humanize(c.by)} at {humanize(c.stage)}{c.requires_reversal ? ' · reversal required' : ''}</span></li>)}
            {a.returns.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><Badge>{humanize(r.type)}</Badge><StatusBadge status={r.status} /><span>{r.reason}</span></li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Exceptions({ a }: { a: AppDetail }) {
  return (
    <Section title="Operational exceptions" flush actions={<Link href="/operations" className="text-sm font-medium text-gold-strong hover:underline">Exception queues</Link>}>
      <DataTable
        caption="Exceptions"
        rows={a.exceptions}
        rowKey={(e) => e.id}
        empty={<EmptyState title="No exceptions" description="Nothing has gone wrong with this application." />}
        columns={[
          { key: 'r', header: 'Reference', cell: (e) => <Mono>{e.reference}</Mono> },
          { key: 'c', header: 'Code', cell: (e) => humanize(e.code) },
          { key: 'sv', header: 'Severity', cell: (e) => <Badge tone={e.severity === 'HIGH' || e.severity === 'CRITICAL' ? 'danger' : 'warning'}>{humanize(e.severity)}</Badge> },
          { key: 't', header: 'Team', cell: (e) => humanize(e.team) },
          { key: 'd', header: 'Detail', cell: (e) => <span className="text-sm text-muted">{e.detail}</span> },
          { key: 's', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
          { key: 'at', header: 'Raised', cell: (e) => <span className="whitespace-nowrap text-muted">{formatDateTime(e.at)}</span> },
        ]}
      />
    </Section>
  );
}

function History({ a }: { a: AppDetail }) {
  const [machine, setMachine] = useState('ALL');
  const machines = ['ALL', ...new Set(a.history.map((h) => h.machine))];
  const rows = [...a.history].reverse().filter((h) => machine === 'ALL' || h.machine === machine);
  return (
    <Section title="State history" description="Every state transition across the application, payment, release and refund machines (newest first)." actions={
      <div className="flex flex-wrap gap-1">{machines.map((m) => <button key={m} type="button" aria-pressed={machine === m} onClick={() => setMachine(m)} className={`rounded-sm border px-2 py-0.5 text-xs ${machine === m ? 'border-gold bg-gold-soft text-gold-strong' : 'border-border text-muted hover:text-fg'}`}>{humanize(m)}</button>)}</div>
    }>
      {rows.length === 0 ? <p className="text-sm text-muted">No transitions recorded.</p> : (
        <Timeline items={rows.map((h) => ({
          title: <span className="flex flex-wrap items-center gap-1.5"><Badge>{humanize(h.machine)}</Badge>{h.from && <><StatusBadge status={h.from} /><span className="text-subtle">→</span></>}<StatusBadge status={h.to} /></span>,
          meta: `${formatDateTime(h.at)} · ${humanize(h.actor)}`,
          description: h.reason ?? undefined,
          tone: statusTone(h.to),
        }))} />
      )}
      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-muted hover:text-fg">Raw history (JSON)</summary>
        <div className="mt-2"><JsonBlock value={a.history} /></div>
      </details>
    </Section>
  );
}
