'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input } from '@araf/ui';
import { useAction, useCheckout } from '../context';
import { CheckIcon, ErrorNotice, StepCard, Why } from '../ui';

type Earns = 'SALARY' | 'BUSINESS';

const digits = (v: string) => v.replace(/[^\d]/g, '');
const toInt = (v: string) => (v === '' ? undefined : Number(digits(v)));

/** Remembered so the "How do you earn?" step can start with the same answer. */
export const EARNS_KEY = 'araf-earns';

/**
 * Fair credit or no credit history: a credit officer reviews the application. We ask only what the Bank does not
 * already have — income, existing repayments and the address come from SeedFi, the statement analysis, the merchant
 * and the BVN record.
 */
export function EnhancedReviewStep() {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  const [earns, setEarns] = useState<Earns | ''>('');
  const [name, setName] = useState('');
  const [nature, setNature] = useState('');
  const [months, setMonths] = useState('');
  const [touched, setTouched] = useState(false);
  const business = earns === 'BUSINESS';

  const errors: Record<string, string> = {};
  if (!earns) errors.earns = 'Choose how you earn.';
  if (earns && !name.trim()) errors.name = business ? 'Enter your business name.' : 'Enter your employer’s name.';
  const err = (k: string) => (touched ? errors[k] ?? null : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    try {
      sessionStorage.setItem(EARNS_KEY, earns);
    } catch {
      /* storage unavailable: the income step simply starts unselected */
    }
    const body: Record<string, unknown> = business
      ? { employment_status: 'SELF_EMPLOYED', business_name: name.trim(), ...(nature.trim() ? { nature_of_business: nature.trim() } : {}), ...(months ? { business_duration_months: toInt(months) } : {}) }
      : { employment_status: 'EMPLOYED', employer_name: name.trim(), ...(months ? { employment_duration_months: toInt(months) } : {}) };
    void run('submit', () => api.post(`${base}/enhanced-info`, body));
  };

  const clarification = view.enhanced_review?.status === 'CLARIFICATION_REQUESTED' ? view.enhanced_review.clarification_note : null;

  return (
    <StepCard
      eyebrow="Step 2 · Confirm eligibility"
      title="Tell us where you earn your income"
      description="A credit officer will look at your application. Two quick answers help them — everything else we already have."
    >
      {clarification && (
        <Alert tone="warning" title="Our credit officer asked for clarification">
          {clarification}
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-fg">How do you earn?</legend>
          <div role="radiogroup" aria-label="How do you earn?" aria-invalid={!!err('earns')} className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['SALARY', 'I earn a salary'],
                ['BUSINESS', 'I run my own business'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className={`flex h-12 cursor-pointer items-center justify-center rounded-md border text-sm font-medium ${earns === v ? 'border-gold bg-gold-soft/40 text-fg' : 'border-border-strong text-muted'}`}>
                <input type="radio" name="earns" value={v} checked={earns === v} onChange={() => setEarns(v)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
          {err('earns') && <p className="text-sm text-danger">{err('earns')}</p>}
          {earns && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={business ? 'Business name' : 'Employer name'} required error={err('name')} className="sm:col-span-2">
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="organization" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              {business && (
                <Field label="What does the business do?" hint="Optional">
                  {({ id }) => <Input id={id} maxLength={200} value={nature} onChange={(e) => setNature(e.target.value)} />}
                </Field>
              )}
              <Field label={business ? 'Months in business' : 'Months with this employer'} hint="Optional">
                {({ id }) => <Input id={id} inputMode="numeric" value={months} onChange={(e) => setMonths(digits(e.target.value).slice(0, 3))} />}
              </Field>
            </div>
          )}
        </fieldset>

        <Why>Your income and existing repayments come from your credit report and bank statement, so we don’t ask for them. These answers are kept confidential and never shared with the merchant.</Why>
        <ErrorNotice error={error} />
        <Button type="submit" size="lg" block loading={busy === 'submit'}>
          Send to the Bank for review
        </Button>
      </form>
    </StepCard>
  );
}

export function EnhancedPendingStep() {
  const { view, summary } = useCheckout();
  const clarification = view.enhanced_review?.status === 'CLARIFICATION_REQUESTED' ? view.enhanced_review.clarification_note : null;
  return (
    <StepCard eyebrow="Step 2 · Confirm eligibility" title="Your information is under review" description="A credit officer is reviewing your details. We will notify you as soon as there is an update.">
      {clarification && (
        <Alert tone="warning" title="Note from our credit officer">
          {clarification}
        </Alert>
      )}
      <ul className="space-y-3 text-sm text-muted">
        <li className="flex gap-3">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>Your progress is saved. You can close this page — open the same checkout link from {summary.partner.name} later and confirm it’s you with a one-time code to continue.</span>
        </li>
        <li className="flex gap-3">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>If you stay on this page, it updates automatically when the review is complete.</span>
        </li>
      </ul>
      <p className="sr-only" aria-live="polite">
        {view.status.label}
      </p>
    </StepCard>
  );
}
