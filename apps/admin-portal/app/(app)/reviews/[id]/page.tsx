'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, KeyValue, LoadingBlock, PageHeader, StatusBadge, Textarea, Timeline, cn, formatDate, formatDateTime, formatNaira, humanize, statusTone } from '@araf/ui';
import { api } from '@/lib/api';
import { fieldErrors, toInt } from '@/lib/forms';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { REVIEW_QUEUES } from '@/lib/labels';
import { ErrorAlert, Guard, Section, useToast } from '@/components/common';
import { Icon } from '@/components/icons';

interface ReviewDetail {
  id: string;
  queue: string;
  status: string;
  note: string | null;
  application: { id: string; reference: string; status: string; purchase_amount: number; income_profile: string | null };
  form: Record<string, unknown> | null;
  credit: { score: number | null; band: string | null; bureau_obligations: number | null; delinquency: unknown; provider_reference: string | null } | null;
  analysis: { period: [string, string]; average_inflow: number; average_outflow: number; business_revenue: number | null; recurring_obligations: number; stress: unknown; quality: string | null; consistency: unknown } | null;
  affordability: { outcome: string; reasons: string[]; months: Array<{ month: string; status: string; consolidated: number }> | null } | null;
  decisions: Array<{ decision: string; reason: string; reviewer: string; status: string; at: string }>;
  requires_checker: boolean;
}

const DECISIONS = [
  { id: 'CLEAR', label: 'Clear', help: 'The customer may continue to the next step.', tone: 'success' },
  { id: 'DECLINE', label: 'Decline', help: 'The application is declined and the exposure reservation released.', tone: 'danger' },
  { id: 'REQUEST_CLARIFICATION', label: 'Request clarification', help: 'The customer is asked for more information. Applies immediately.', tone: 'warning' },
  { id: 'ESCALATE', label: 'Escalate', help: 'Escalate to a senior reviewer. Applies immediately.', tone: 'info' },
] as const;

export default function ReviewPage() {
  return <Guard perm="application.read.sensitive"><Review /></Guard>;
}

function formValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-NG');
  if (Array.isArray(v)) return v.map(formValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function Review() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<ReviewDetail>(`/api/admin/reviews/${id}`);
  const r = state.data;
  useEffect(() => { if (r) document.title = `Review ${r.application.reference} · Pay with ARAF admin`; }, [r]);
  if (state.error && !r) return <ErrorAlert error={state.error} onRetry={state.reload} title="Review could not be loaded" />;
  if (!r) return <Card><LoadingBlock rows={10} /></Card>;
  const queue = REVIEW_QUEUES.find((q) => q.id === r.queue);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/reviews" className="inline-flex items-center gap-1 hover:underline">{Icon.back('h-3.5 w-3.5')} Credit reviews</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{queue?.label ?? humanize(r.queue)} review<StatusBadge status={r.status} /></span>}
        description={<>Application <Link className="font-mono text-gold-strong hover:underline" href={`/applications/${r.application.id}`}>{r.application.reference}</Link> · {humanize(r.application.status)} · purchase {formatNaira(r.application.purchase_amount)}{r.application.income_profile ? ` · ${humanize(r.application.income_profile)}` : ''}</>}
      />
      <Alert tone="gold" className="mb-6" title="Sensitive credit data — access is audited">This review was opened under your name. Credit details must not be shared with the merchant.</Alert>
      {r.note && <Alert tone="warning" className="mb-6" title="Clarification requested">{r.note}</Alert>}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <Section title="Customer form answers" description="Submitted by the customer in the enhanced assessment form.">
            {r.form && Object.keys(r.form).length ? (
              <KeyValue items={Object.entries(r.form).map(([k, v]) => ({ label: humanize(k.replace(/_naira$/, '')) + (k.endsWith('_naira') ? ' (₦)' : ''), value: k.endsWith('_naira') && typeof v === 'number' ? formatNaira(v * 100, { noKobo: true }) : typeof v === 'string' && /^[A-Z_]+$/.test(v) ? humanize(v) : formValue(v) }))} />
            ) : <p className="text-sm text-muted">The customer has not submitted the form yet.</p>}
          </Section>
          <Section title="Credit summary (SeedFi)">
            {r.credit ? (
              <KeyValue columns={3} items={[
                { label: 'Score', value: <span className="text-lg font-semibold">{r.credit.score ?? 'No score'}</span> },
                { label: 'Band', value: r.credit.band ? <Badge tone={r.credit.band === 'GOOD' ? 'success' : r.credit.band === 'FAIR' ? 'warning' : 'danger'}>{r.credit.band}</Badge> : 'Thin file' },
                { label: 'Bureau obligations / mo', value: formatNaira(r.credit.bureau_obligations) },
                { label: 'Delinquency indicators', value: Array.isArray(r.credit.delinquency) && r.credit.delinquency.length ? r.credit.delinquency.map(String).map(humanize).join(', ') : 'None' },
                { label: 'Provider reference', value: r.credit.provider_reference ?? '—', mono: true },
              ]} />
            ) : <p className="text-sm text-muted">No completed credit assessment.</p>}
          </Section>
          <Section title="Statement analysis">
            {r.analysis ? (
              <KeyValue columns={3} items={[
                { label: 'Period', value: `${formatDate(r.analysis.period[0])} – ${formatDate(r.analysis.period[1])}` },
                { label: 'Average inflow / mo', value: formatNaira(r.analysis.average_inflow) },
                { label: 'Average outflow / mo', value: formatNaira(r.analysis.average_outflow) },
                { label: 'Business revenue / mo', value: formatNaira(r.analysis.business_revenue) },
                { label: 'Recurring obligations', value: formatNaira(r.analysis.recurring_obligations) },
                { label: 'Statement quality', value: r.analysis.quality ? humanize(r.analysis.quality) : '—' },
                { label: 'Cash-flow consistency', value: formValue(r.analysis.consistency) },
                { label: 'Stress indicators', value: Array.isArray(r.analysis.stress) && r.analysis.stress.length ? r.analysis.stress.map(String).map(humanize).join(', ') : 'None' },
              ]} />
            ) : <p className="text-sm text-muted">No statement analysis available yet.</p>}
          </Section>
          <Section title="Affordability">
            {r.affordability ? (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm">Outcome <StatusBadge status={r.affordability.outcome} />{r.affordability.reasons.map((x) => <Badge key={x}>{humanize(x)}</Badge>)}</p>
                {r.affordability.months?.length ? (
                  <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {r.affordability.months.map((m) => (
                      <li key={m.month} className={cn('rounded-md border px-3 py-2', m.status === 'VERIFIED' ? 'border-border' : 'border-warning/40 bg-warning-soft')}>
                        <p className="font-mono text-xs text-muted">{m.month}</p>
                        <p className="text-sm font-medium tabular-nums">{formatNaira(m.consolidated, { noKobo: true })}</p>
                        <p className="text-2xs text-subtle">{humanize(m.status)}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : <p className="text-sm text-muted">No affordability assessment yet.</p>}
          </Section>
        </div>
        <div className="space-y-6 xl:col-span-2">
          <DecisionForm r={r} onDone={state.reload} />
          <Section title="Prior decisions">
            {r.decisions.length === 0 ? <p className="text-sm text-muted">No decisions recorded.</p> : (
              <Timeline items={r.decisions.map((d) => ({ title: <span className="flex flex-wrap items-center gap-2">{humanize(d.decision)}<StatusBadge status={d.status} /></span>, meta: `${d.reviewer} · ${formatDateTime(d.at)}`, description: d.reason, tone: statusTone(d.status) }))} />
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function DecisionForm({ r, onDone }: { r: ReviewDetail; onDone: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [decision, setDecision] = useState<string>('CLEAR');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [income, setIncome] = useState('');
  const [obligations, setObligations] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<{ status: string; approval_reference?: string } | null>(null);
  const affordabilityReview = r.application.status === 'AFFORDABILITY_REVIEW_REQUIRED';
  const open = ['PENDING', 'ESCALATED'].includes(r.status);
  const errs = fieldErrors(error);

  if (!can('review.perform')) {
    return <Section title="Decision"><p className="flex items-start gap-2 text-sm text-muted">{Icon.lock()} Recording a review decision requires <code className="font-mono text-xs">review.perform</code> (Credit Analyst). Credit Risk Reviewers approve decisions in the Approvals inbox.</p></Section>;
  }
  if (!open) {
    return (
      <Section title="Decision">
        {r.status === 'DECISION_PENDING_APPROVAL'
          ? <Alert tone="info" title="Decision awaiting checker approval" action={<Link href="/approvals" className="text-sm font-medium text-gold-strong hover:underline">Approvals inbox</Link>}>A Credit Risk Reviewer must approve the proposed decision before it takes effect.</Alert>
          : <p className="text-sm text-muted">This review is {humanize(r.status).toLowerCase()} — no decision can be recorded now.</p>}
      </Section>
    );
  }

  const local: Record<string, string> = {};
  if (reason.trim().length < 5) local.reason = 'Give a reason of at least 5 characters.';
  const incomeN = toInt(income);
  if (decision === 'CLEAR' && affordabilityReview && (!incomeN || incomeN <= 0)) local.assessed_monthly_income_naira = 'Assessed monthly income is required to clear an affordability review.';
  const obligationsN = toInt(obligations);
  if (obligations && (obligationsN === undefined || obligationsN < 0)) local.assessed_monthly_obligations_naira = 'Enter a whole naira amount (0 or more).';
  const show = (k: string) => errs[k] ?? (touched ? local[k] : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { decision, reason: reason.trim() };
      if (evidence.trim()) body.evidence = evidence.trim();
      if (decision === 'CLEAR' && affordabilityReview) {
        body.assessed_monthly_income_naira = incomeN;
        if (obligationsN !== undefined) body.assessed_monthly_obligations_naira = obligationsN;
      }
      const res = await api.post<{ status: string; approval_reference?: string }>(`/api/admin/reviews/${r.id}/decision`, body);
      setResult(res);
      toast(res.status === 'PENDING_APPROVAL' ? `Decision proposed — ${res.approval_reference} awaits a checker` : 'Decision applied');
      setReason('');
      setEvidence('');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Record decision" description="Maker action. CLEAR and DECLINE require approval by a Credit Risk Reviewer (review.approve) in the Approvals inbox; you cannot approve your own decision.">
      {result && <Alert tone="success" className="mb-4" title={result.status === 'PENDING_APPROVAL' ? `Sent for approval — ${result.approval_reference}` : 'Decision applied'}>{result.status === 'PENDING_APPROVAL' ? 'The decision takes effect once a Credit Risk Reviewer approves it.' : 'The application has been updated.'}</Alert>}
      <form onSubmit={submit} noValidate className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Decision <span className="text-danger" aria-hidden="true">*</span></legend>
          <div className="grid gap-2">
            {DECISIONS.map((d) => (
              <label key={d.id} className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5', decision === d.id ? 'border-gold bg-gold-soft/50' : 'border-border hover:border-border-strong')}>
                <input type="radio" name="decision" value={d.id} checked={decision === d.id} onChange={() => setDecision(d.id)} className="mt-1 h-4 w-4 accent-[rgb(var(--color-gold))]" />
                <span>
                  <span className="block text-sm font-medium">{d.label}</span>
                  <span className="block text-xs text-muted">{d.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {decision === 'CLEAR' && affordabilityReview && (
          <div className="space-y-4 rounded-md border border-border bg-surface-2/50 p-4">
            <p className="text-xs text-muted">Affordability review: supply your assessed figures. The Bank’s deterministic engine still computes eligibility from them.</p>
            <Field label="Assessed monthly income (₦)" required error={show('assessed_monthly_income_naira')} hint={incomeN ? formatNaira(incomeN * 100, { noKobo: true }) : undefined}>
              {(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={income} onChange={(e) => setIncome(e.target.value)} />}
            </Field>
            <Field label="Assessed monthly obligations (₦)" error={show('assessed_monthly_obligations_naira')} hint="Optional — defaults to 0.">
              {(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} value={obligations} onChange={(e) => setObligations(e.target.value)} />}
            </Field>
          </div>
        )}
        <Field label="Reason" required error={show('reason')} hint="Recorded with the decision and shown to the checker.">
          {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Field label="Evidence" hint="Optional — references to documents, calls or checks performed.">
          {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} value={evidence} maxLength={2000} onChange={(e) => setEvidence(e.target.value)} className="min-h-[72px]" />}
        </Field>
        <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Decision not recorded" /> : null}</div>
        <Button type="submit" block loading={busy} variant={decision === 'DECLINE' ? 'danger' : 'primary'}>
          {decision === 'CLEAR' || decision === 'DECLINE' ? `Propose ${DECISIONS.find((d) => d.id === decision)!.label.toLowerCase()} for approval` : DECISIONS.find((d) => d.id === decision)!.label}
        </Button>
      </form>
    </Section>
  );
}
