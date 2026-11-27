'use client';

import { useState } from 'react';
import { Button } from '@araf/ui';
import { useAction, useCheckout } from '../context';
import { ChoiceCard, ErrorNotice, StepCard, Why } from '../ui';
import { EARNS_KEY } from './Enhanced';

export function IncomeProfileStep({ onDone }: { onDone?: () => void }) {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  // Start from the answer given earlier on the credit-review form (if any), so the customer is not asked twice.
  const [choice, setChoice] = useState<string>(() => {
    if (view.income_profile) return view.income_profile;
    try {
      const earns = sessionStorage.getItem(EARNS_KEY);
      return earns === 'BUSINESS' ? 'BUSINESS_OWNER' : earns === 'SALARY' ? 'SALARY_EARNER' : '';
    } catch {
      return '';
    }
  });
  return (
    <StepCard
      eyebrow="Step 3 · Connect finances"
      title="How do you mainly earn?"
      description={
        view.account ? (
          <>
            Repayment account confirmed: <span className="font-medium text-fg">{view.account.product}</span> <span className="font-mono">{view.account.account_number}</span>. Next, we need to understand your income so we only offer what you can comfortably repay.
          </>
        ) : (
          'We need to understand your income so we only offer what you can comfortably repay.'
        )
      }
    >
      <fieldset className="space-y-3">
        <legend className="sr-only">Income type</legend>
        <ChoiceCard
          name="income"
          value="SALARY_EARNER"
          checked={choice === 'SALARY_EARNER'}
          onChange={setChoice}
          title="I earn a salary"
          description="We’ll need your last 6 months of bank statements showing salary credits. Most salary earners get an indicative offer in minutes."
        />
        <ChoiceCard
          name="income"
          value="BUSINESS_OWNER"
          checked={choice === 'BUSINESS_OWNER'}
          onChange={setChoice}
          title="I own a business or am self-employed"
          description="We’ll need 12 months of statements. A member of our team reviews business income manually and aims to contact you within 24–48 hours (a target, not a guarantee)."
        />
      </fieldset>
      <Why>Statements let us confirm your income and existing commitments. We look at transaction patterns only — never your passwords.</Why>
      <ErrorNotice error={error} />
      <Button
        size="lg"
        block
        disabled={!choice}
        loading={busy === 'save'}
        onClick={() =>
          void run('save', async () => {
            const v = await api.post(`${base}/income-profile`, { income_profile: choice });
            onDone?.();
            return v;
          })
        }
      >
        {choice === 'BUSINESS_OWNER' ? 'Continue as a business owner — share 12 months of statements' : choice === 'SALARY_EARNER' ? 'Continue as a salary earner — share 6 months of statements' : 'Choose how you earn'}
      </Button>
    </StepCard>
  );
}
