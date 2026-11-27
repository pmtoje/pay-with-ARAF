'use client';

import { Button } from '@araf/ui';
import { useAction, useCheckout } from '../context';
import { ErrorNotice, ProgressPanel, StepCard, Why } from '../ui';

/** Identity verified but the preliminary credit check could not complete (technical failure). */
export function CreditCheckStep() {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  const first = view.customer?.first_name;
  return (
    <StepCard
      eyebrow="Step 2 · Confirm eligibility"
      title={first ? `Thanks, ${first} — your identity is verified` : 'Your identity is verified'}
      description="We couldn’t complete the preliminary eligibility check just now. This is a temporary technical issue on our side — it says nothing about your credit."
      footer={
        <Button size="lg" loading={busy === 'retry'} onClick={() => void run('retry', () => api.post(`${base}/credit-check`))}>
          Try the eligibility check again
        </Button>
      }
    >
      {busy === 'retry' ? (
        <ProgressPanel title="Checking eligibility" description="This usually takes a few seconds." lines={2} />
      ) : (
        <Why>If the check keeps failing, wait a minute and try again — your progress is saved.</Why>
      )}
      <ErrorNotice error={error} />
    </StepCard>
  );
}

export function CreditCheckingStep() {
  return (
    <StepCard eyebrow="Step 2 · Confirm eligibility" title="Checking eligibility" description="We are running a preliminary eligibility check.">
      <ProgressPanel title="Working on it" description="This usually takes a moment." />
    </StepCard>
  );
}
