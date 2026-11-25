'use client';

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, LoadingBlock, PageHeader, Select, StatusBadge, Textarea, cn, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { api } from '@/lib/api';
import { toInt } from '@/lib/forms';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionDialog, ErrorAlert, Guard, JsonBlock, Section } from '@/components/common';
import { Icon } from '@/components/icons';

interface Rules {
  scoreRange: { min: number; max: number };
  scoreBands: Array<{ band: string; min: number; max: number; action: string }>;
  thinFileTreatment: string;
  maxRepaymentToIncomeRatio: string;
  obligationsSource: string;
  singleObligorLimitKobo: string;
  exposureBasis: string;
  approvedTenorsMonths: number[];
  markupTiers: Array<{ minTenorMonths: number; maxTenorMonths: number; markupBps: number }>;
  statementMonths: { SALARY_EARNER: number; BUSINESS_OWNER: number };
  businessOwnerManualReview: boolean;
  partialFinancingEnabled: boolean;
  minimumFinancingKobo: string;
  offerValidityMinutes: number;
  assessmentValidityDays: number;
  minimumAgeYears: number;
  maximumAgeYears: number;
  enhancedReviewRequiresChecker: boolean;
  businessOwnerContactWindowHours: { min: number; max: number };
  pdfMaxBytes: number;
}
interface Version { id: string; version: number; status: string; is_proposed: boolean; change_summary: string | null; rules: Rules; maker: string | null; checker: string | null; effective_from: string | null; created_at: string }
interface Policies { code: string; name: string; description: string; versions: Version[] }

export default function PolicyPage() {
  return <Guard perm="policy.read"><Policy /></Guard>;
}

function Policy() {
  const { can } = useSession();
  const state = useApi<Policies>('/api/admin/policies');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  useEffect(() => { document.title = 'Credit policy · Pay with ARAF admin'; }, []);
  const d = state.data;
  const active = d?.versions.find((v) => v.status === 'ACTIVE');
  const selected = d?.versions.find((v) => v.id === selectedId) ?? active ?? d?.versions[0];

  return (
    <>
      <PageHeader
        eyebrow="Credit"
        title="Credit policy"
        description={d ? d.description : 'Versioned, maker–checker approved credit rules used by the deterministic eligibility engine.'}
        actions={can('policy.propose') && active ? <Button onClick={() => setProposeOpen(true)}>{Icon.plus()} Propose new version</Button> : undefined}
      />
      {state.error && !d ? <ErrorAlert error={state.error} onRetry={state.reload} /> : !d ? <Card><LoadingBlock rows={8} /></Card> : (
        <div className="grid gap-6 xl:grid-cols-4">
          <div className="xl:col-span-1">
            <Section title="Versions" flush>
              <ul className="divide-y divide-border">
                {d.versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" onClick={() => setSelectedId(v.id)} aria-current={selected?.id === v.id ? 'true' : undefined} className={cn('w-full px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', selected?.id === v.id && 'bg-surface-2')}>
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">v{v.version}<StatusBadge status={v.status} />{v.is_proposed && <Badge tone="gold">Proposed</Badge>}</span>
                      <span className="mt-1 line-clamp-2 block text-xs text-muted">{v.change_summary ?? '—'}</span>
                      <span className="mt-1 block text-2xs text-subtle">{v.maker ?? '—'}{v.checker ? ` → ${v.checker}` : ''} · {formatDateTime(v.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          <div className="space-y-6 xl:col-span-3">
            {selected && <RulesView v={selected} />}
            <Simulator versions={d.versions} defaultId={selected?.id} />
          </div>
        </div>
      )}
      {active && <ProposeDialog open={proposeOpen} onClose={() => setProposeOpen(false)} base={active} onDone={state.reload} />}
    </>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right font-medium text-fg">{v}</dd></div>;
}

const bandTone = (b: string) => (b === 'GOOD' ? 'success' : b === 'FAIR' ? 'warning' : 'danger');
const yes = (b: boolean) => (b ? 'Yes' : 'No');

function RulesView({ v }: { v: Version }) {
  const r = v.rules;
  const [raw, setRaw] = useState(false);
  return (
    <Section
      title={<span className="flex flex-wrap items-center gap-2">Version {v.version} rules <StatusBadge status={v.status} /></span>}
      description={v.effective_from ? `Effective from ${formatDateTime(v.effective_from)}` : 'Not yet effective'}
      actions={<Button size="sm" variant="ghost" onClick={() => setRaw(!raw)}>{raw ? 'Readable view' : 'View JSON'}</Button>}
    >
      {v.is_proposed && (
        <Alert tone="gold" className="mb-5" title="PROPOSED — subject to Credit Risk, Shariah and Legal approval">
          These values encode proposed interpretations (e.g. from the SeedFi SWR). They are not an approved Bank policy and must be formally signed off before production.
        </Alert>
      )}
      {raw ? <JsonBlock value={r} maxHeight="max-h-[32rem]" /> : (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Score bands ({r.scoreRange.min}–{r.scoreRange.max})</h3>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="flex h-2" aria-hidden="true">
                {r.scoreBands.map((b) => <span key={b.band} className={b.band === 'GOOD' ? 'bg-success' : b.band === 'FAIR' ? 'bg-warning' : 'bg-danger'} style={{ flex: b.max - b.min + 1 }} />)}
              </div>
              <DataTable caption="Score bands" rows={r.scoreBands} rowKey={(b) => b.band} dense columns={[
                { key: 'b', header: 'Band', cell: (b) => <Badge tone={bandTone(b.band)}>{b.band}</Badge> },
                { key: 'r', header: 'Score', cell: (b) => <span className="tabular-nums">{b.min}–{b.max}</span> },
                { key: 'a', header: 'Action', cell: (b) => humanize(b.action) },
              ]} />
            </div>
            <dl className="mt-3"><Row k="Thin file (no score)" v={humanize(r.thinFileTreatment)} /></dl>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Affordability & exposure</h3>
            <dl>
              <Row k="Max repayment-to-income" v={`${(Number(r.maxRepaymentToIncomeRatio) * 100).toFixed(1)}%`} />
              <Row k="Obligations source" v={humanize(r.obligationsSource)} />
              <Row k="Single obligor limit" v={formatNaira(Number(r.singleObligorLimitKobo), { noKobo: true })} />
              <Row k="Exposure basis" v={humanize(r.exposureBasis)} />
              <Row k="Minimum financing" v={formatNaira(Number(r.minimumFinancingKobo), { noKobo: true })} />
              <Row k="Partial financing" v={r.partialFinancingEnabled ? 'Enabled' : <span className="text-warning">Disabled</span>} />
            </dl>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Tenors & markup (total over tenor)</h3>
            <div className="mb-3 flex flex-wrap gap-1.5">{r.approvedTenorsMonths.map((t) => <Badge key={t} tone="gold">{t} months</Badge>)}</div>
            <div className="rounded-md border border-border">
              <DataTable caption="Markup tiers" rows={r.markupTiers} rowKey={(t) => `${t.minTenorMonths}`} dense columns={[
                { key: 't', header: 'Tenor range', cell: (t) => `${t.minTenorMonths}–${t.maxTenorMonths} months` },
                { key: 'm', header: 'Total markup', align: 'right', cell: (t) => `${(t.markupBps / 100).toFixed(1)}%` },
              ]} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Statements, reviews & validity</h3>
            <dl>
              <Row k="Statement months — salary earner" v={`${r.statementMonths.SALARY_EARNER} months`} />
              <Row k="Statement months — business owner" v={`${r.statementMonths.BUSINESS_OWNER} months`} />
              <Row k="Business owners → manual review" v={yes(r.businessOwnerManualReview)} />
              <Row k="Enhanced review needs checker" v={yes(r.enhancedReviewRequiresChecker)} />
              <Row k="Business-owner contact window" v={`${r.businessOwnerContactWindowHours.min}–${r.businessOwnerContactWindowHours.max} h`} />
              <Row k="Offer validity" v={`${(r.offerValidityMinutes / 60).toFixed(0)} hours`} />
              <Row k="Assessment validity" v={`${r.assessmentValidityDays} days`} />
              <Row k="Customer age" v={`${r.minimumAgeYears}–${r.maximumAgeYears} years`} />
              <Row k="PDF statement size limit" v={`${(r.pdfMaxBytes / 1024 / 1024).toFixed(0)} MB`} />
            </dl>
          </div>
        </div>
      )}
    </Section>
  );
}

function ProposeDialog({ open, onClose, base, onDone }: { open: boolean; onClose: () => void; base: Version; onDone: () => void }) {
  const [json, setJson] = useState('');
  const [summary, setSummary] = useState('');
  useEffect(() => { if (open) { setJson(JSON.stringify(base.rules, null, 2)); setSummary(''); } }, [open, base]);
  const parsed = useMemo(() => { try { return { ok: true as const, value: JSON.parse(json) as unknown }; } catch (e) { return { ok: false as const, error: (e as Error).message }; } }, [json]);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Propose a new credit policy version"
      description={`Prefilled with active version v${base.version}. The new version is validated, then sent to a Credit Approver (policy.approve) in the Approvals inbox.`}
      confirmLabel="Submit for approval"
      validate={() => (!parsed.ok ? `Rules are not valid JSON: ${parsed.error}` : summary.trim().length < 5 ? 'Change summary must be at least 5 characters.' : null)}
      onConfirm={() => api.post<{ version: number }>('/api/admin/policies', { rules: parsed.ok ? parsed.value : null, change_summary: summary.trim() })}
      successMessage={(r) => `Policy v${r.version} proposed — awaiting approval`}
      onDone={onDone}
    >
      <div className="space-y-4">
        <Alert tone="gold">Even once approved here, the version remains flagged PROPOSED until formal Credit Risk, Shariah and Legal sign-off.</Alert>
        <Field label="Change summary" required hint="What changes and why — shown to the approver.">
          {(ids) => <Input id={ids.id} aria-describedby={ids.describedBy} value={summary} maxLength={1000} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
        <Field label="Rules (JSON)" required error={parsed.ok ? null : `Invalid JSON: ${parsed.error}`} hint="Money values are integer kobo strings. Score bands must be contiguous and every tenor needs a markup tier.">
          {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} spellCheck={false} value={json} onChange={(e) => setJson(e.target.value)} className="min-h-[22rem] font-mono text-xs leading-relaxed" />}
        </Field>
      </div>
    </ActionDialog>
  );
}

interface SimResult {
  credit: { kind: string; band?: string; action?: string; score?: number; reason?: string } | null;
  capacity: number;
  max_eligible: number;
  tenors: Array<{ tenor_months: number; markup_percent: number; max_affordable: number; eligible: number; limiting_factor: string; financing_for_cart: number; monthly_repayment: number; deferred_sale_price: number; display: string }>;
}

function Simulator({ versions, defaultId }: { versions: Version[]; defaultId?: string }) {
  const [versionId, setVersionId] = useState(defaultId ?? '');
  const [score, setScore] = useState('650');
  const [noScore, setNoScore] = useState(false);
  const [income, setIncome] = useState('480000');
  const [obligations, setObligations] = useState('50000');
  const [exposure, setExposure] = useState('0');
  const [cart, setCart] = useState('850000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  useEffect(() => { if (defaultId && !versionId) setVersionId(defaultId); }, [defaultId, versionId]);
  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const v = versions.find((x) => x.id === versionId);
      setResult(await api.post<SimResult>('/api/admin/policies/simulate', {
        rules: v?.rules,
        score: noScore ? null : toInt(score) ?? null,
        monthly_income_naira: toInt(income) ?? 0,
        monthly_obligations_naira: toInt(obligations) ?? 0,
        existing_exposure_naira: toInt(exposure) ?? 0,
        cart_naira: toInt(cart) ?? 0,
      }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const c = result?.credit;
  return (
    <Section title="Policy simulator" description="What-if evaluation with the deterministic engine. No records are created.">
      <form onSubmit={run} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" noValidate>
        <Field label="Policy version">
          {(ids) => <Select id={ids.id} value={versionId} onChange={(e) => setVersionId(e.target.value)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.version} · {humanize(v.status)}</option>)}</Select>}
        </Field>
        <div className="space-y-2">
          <Field label="Credit score">{(ids) => <Input id={ids.id} inputMode="numeric" value={score} disabled={noScore} onChange={(e) => setScore(e.target.value)} />}</Field>
          <Checkbox checked={noScore} onChange={(e) => setNoScore(e.target.checked)} label="No score (thin file)" />
        </div>
        <Field label="Monthly income (₦)">{(ids) => <Input id={ids.id} inputMode="numeric" value={income} onChange={(e) => setIncome(e.target.value)} />}</Field>
        <Field label="Monthly obligations (₦)">{(ids) => <Input id={ids.id} inputMode="numeric" value={obligations} onChange={(e) => setObligations(e.target.value)} />}</Field>
        <Field label="Existing Bank exposure (₦)">{(ids) => <Input id={ids.id} inputMode="numeric" value={exposure} onChange={(e) => setExposure(e.target.value)} />}</Field>
        <Field label="Cart value (₦)">{(ids) => <Input id={ids.id} inputMode="numeric" value={cart} onChange={(e) => setCart(e.target.value)} />}</Field>
        <div className="flex items-end sm:col-span-2 lg:col-span-3"><Button type="submit" loading={busy}>Run simulation</Button></div>
      </form>
      <div aria-live="polite" className="mt-5 space-y-5">
        {error ? <ErrorAlert error={error} title="Simulation failed" /> : null}
        {result && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-subtle">Credit classification</p>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {!c ? 'Not evaluated' : c.kind === 'BAND' ? <><Badge tone={bandTone(c.band ?? '')}>{c.band}</Badge>{humanize(c.action ?? '')}</> : c.kind === 'NO_SCORE' ? <>No score → {humanize(c.action ?? '')}</> : <span className="text-danger">Invalid: {humanize(c.reason ?? '')}</span>}
                </p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-subtle">Monthly capacity</p>
                <p className="mt-2 text-xl font-semibold tabular-nums">{formatNaira(result.capacity)}</p>
              </div>
              <div className="rounded-md border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-subtle">Maximum eligible</p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-gold-strong">{formatNaira(result.max_eligible)}</p>
              </div>
            </div>
            <div className="rounded-md border border-border">
              <DataTable caption="Per-tenor breakdown" rows={result.tenors} rowKey={(t) => String(t.tenor_months)} dense columns={[
                { key: 't', header: 'Tenor', cell: (t) => `${t.tenor_months} mo` },
                { key: 'm', header: 'Markup', align: 'right', cell: (t) => `${t.markup_percent}%` },
                { key: 'a', header: 'Max affordable', align: 'right', cell: (t) => formatNaira(t.max_affordable, { noKobo: true }) },
                { key: 'e', header: 'Eligible', align: 'right', cell: (t) => formatNaira(t.eligible, { noKobo: true }) },
                { key: 'l', header: 'Limited by', cell: (t) => <span className="text-xs text-muted">{humanize(t.limiting_factor)}</span> },
                { key: 'f', header: 'Financed (cart)', align: 'right', cell: (t) => formatNaira(t.financing_for_cart, { noKobo: true }) },
                { key: 'r', header: 'Monthly', align: 'right', cell: (t) => <span className="font-medium">{formatNaira(t.monthly_repayment)}</span> },
                { key: 'd', header: 'Deferred sale price', align: 'right', cell: (t) => formatNaira(t.deferred_sale_price) },
              ]} />
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
