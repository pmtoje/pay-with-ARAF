'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Select, Textarea } from '@araf/ui';
import { useAction, useCheckout } from '../context';
import { CheckIcon, ErrorNotice, StepCard, Why } from '../ui';

type Status = 'EMPLOYED' | 'SELF_EMPLOYED' | 'CONTRACT' | 'OTHER';

const EMPLOYMENT: Array<{ value: Status; label: string }> = [
  { value: 'EMPLOYED', label: 'Employed (salaried)' },
  { value: 'CONTRACT', label: 'On contract' },
  { value: 'SELF_EMPLOYED', label: 'Self-employed / business owner' },
  { value: 'OTHER', label: 'Other' },
];

const ACCOMMODATION = [
  { value: 'OWNED', label: 'I own my home' },
  { value: 'RENTED', label: 'Rented' },
  { value: 'FAMILY', label: 'Living with family' },
  { value: 'EMPLOYER_PROVIDED', label: 'Provided by employer' },
  { value: 'OTHER', label: 'Other' },
];

const digits = (v: string) => v.replace(/[^\d]/g, '');
const toInt = (v: string) => (v === '' ? undefined : Number(digits(v)));
const withCommas = (v: string) => (v ? Number(digits(v)).toLocaleString('en-NG') : '');

export function EnhancedReviewStep() {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  const [f, setF] = useState({
    employment_status: '' as Status | '',
    employer_name: '',
    employment_duration_months: '',
    job_role: '',
    monthly_income_naira: '',
    business_name: '',
    nature_of_business: '',
    business_duration_months: '',
    residential_address: '',
    accommodation_type: '',
    dependants: '',
    existing_obligations_naira: '',
  });
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const employed = f.employment_status === 'EMPLOYED' || f.employment_status === 'CONTRACT';
  const business = f.employment_status === 'SELF_EMPLOYED';

  const errors: Partial<Record<keyof typeof f, string>> = {};
  if (!f.employment_status) errors.employment_status = 'Select your employment status.';
  if (employed && !f.employer_name.trim()) errors.employer_name = 'Enter your employer’s name.';
  if (business && !f.business_name.trim()) errors.business_name = 'Enter your business name.';
  if (!f.monthly_income_naira) errors.monthly_income_naira = 'Enter your average monthly income.';
  if (f.residential_address.trim().length < 5) errors.residential_address = 'Enter your residential address.';
  if (!f.accommodation_type) errors.accommodation_type = 'Select your accommodation type.';
  if (f.dependants === '' || Number(f.dependants) > 30) errors.dependants = 'Enter the number of dependants (0 if none).';
  if (f.existing_obligations_naira === '') errors.existing_obligations_naira = 'Enter your monthly obligations (0 if none).';
  const err = (k: keyof typeof f) => (touched ? errors[k] ?? null : null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const body: Record<string, unknown> = {
      employment_status: f.employment_status,
      monthly_income_naira: toInt(f.monthly_income_naira),
      residential_address: f.residential_address.trim(),
      accommodation_type: f.accommodation_type,
      dependants: toInt(f.dependants),
      existing_obligations_naira: toInt(f.existing_obligations_naira),
    };
    if (employed) {
      body.employer_name = f.employer_name.trim();
      if (f.job_role.trim()) body.job_role = f.job_role.trim();
      if (f.employment_duration_months) body.employment_duration_months = toInt(f.employment_duration_months);
    }
    if (business) {
      body.business_name = f.business_name.trim();
      if (f.nature_of_business.trim()) body.nature_of_business = f.nature_of_business.trim();
      if (f.business_duration_months) body.business_duration_months = toInt(f.business_duration_months);
    }
    void run('submit', () => api.post(`${base}/enhanced-info`, body));
  };

  const clarification = view.enhanced_review?.status === 'CLARIFICATION_REQUESTED' ? view.enhanced_review.clarification_note : null;
  const num = (k: keyof typeof f, money?: boolean) => ({
    inputMode: 'numeric' as const,
    value: money ? withCommas(f[k]) : f[k],
    onChange: (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: digits(e.target.value).slice(0, money ? 10 : 3) })),
  });

  return (
    <StepCard
      eyebrow="Step 2 · Confirm eligibility"
      title="Tell us a little more about you"
      description="Your credit history alone isn’t enough for us to decide, so a credit officer will review a few extra details. This takes about two minutes."
    >
      {clarification && (
        <Alert tone="warning" title="Our credit officer asked for clarification">
          {clarification}
        </Alert>
      )}
      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-fg">Work and income</legend>
          <Field label="Employment status" required error={err('employment_status')}>
            {({ id, describedBy, invalid }) => (
              <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} value={f.employment_status} onChange={set('employment_status')}>
                <option value="">Select…</option>
                {EMPLOYMENT.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {employed && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employer name" required error={err('employer_name')} className="sm:col-span-2">
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="organization" maxLength={120} value={f.employer_name} onChange={set('employer_name')} />}
              </Field>
              <Field label="Job role">
                {({ id }) => <Input id={id} autoComplete="organization-title" maxLength={120} value={f.job_role} onChange={set('job_role')} />}
              </Field>
              <Field label="Time with employer (months)">
                {({ id }) => <Input id={id} {...num('employment_duration_months')} />}
              </Field>
            </div>
          )}
          {business && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" required error={err('business_name')} className="sm:col-span-2">
                {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} maxLength={120} value={f.business_name} onChange={set('business_name')} />}
              </Field>
              <Field label="Nature of business">
                {({ id }) => <Input id={id} maxLength={200} value={f.nature_of_business} onChange={set('nature_of_business')} />}
              </Field>
              <Field label="Years in business (months)">
                {({ id }) => <Input id={id} {...num('business_duration_months')} />}
              </Field>
            </div>
          )}
          <Field label="Average monthly income (₦)" required error={err('monthly_income_naira')} hint="Your typical take-home income each month.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...num('monthly_income_naira', true)} />}
          </Field>
          <Field label="Existing monthly repayments (₦)" required error={err('existing_obligations_naira')} hint="Other financing, rent instalments or similar commitments. Enter 0 if none.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...num('existing_obligations_naira', true)} />}
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-fg">Home</legend>
          <Field label="Residential address" required error={err('residential_address')}>
            {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} autoComplete="street-address" maxLength={300} rows={2} className="min-h-[72px]" value={f.residential_address} onChange={set('residential_address')} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Accommodation" required error={err('accommodation_type')}>
              {({ id, describedBy, invalid }) => (
                <Select id={id} aria-describedby={describedBy} aria-invalid={invalid} value={f.accommodation_type} onChange={set('accommodation_type')}>
                  <option value="">Select…</option>
                  {ACCOMMODATION.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Number of dependants" required error={err('dependants')}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} {...num('dependants')} />}
            </Field>
          </div>
        </fieldset>

        <Why>These details help a credit officer understand your ability to repay comfortably. They are kept confidential and never shared with the merchant.</Why>
        <ErrorNotice error={error} />
        <Button type="submit" size="lg" block loading={busy === 'submit'}>
          Send my details to the Bank for review
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
