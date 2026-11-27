'use client';

import { useCheckout } from '../context';
import { CheckIcon, ProgressPanel, StepCard, Why } from '../ui';

const STAGES = [
  { id: 'received', label: 'Statement received', states: ['STATEMENT_RECEIVED', 'STATEMENT_VALIDATION_PENDING', 'STATEMENT_ANALYSIS_PENDING', 'STATEMENT_ANALYSIS_COMPLETED'] },
  { id: 'validated', label: 'Checked for completeness and ownership', states: ['STATEMENT_ANALYSIS_PENDING', 'STATEMENT_ANALYSIS_COMPLETED'] },
  { id: 'analysed', label: 'Income and commitments analysed', states: ['STATEMENT_ANALYSIS_COMPLETED'] },
];

export function AnalysisStep() {
  const { view } = useCheckout();
  return (
    <StepCard eyebrow="Step 3 · Connect finances" title="Analysing your statement" description="This usually takes a moment. Please keep this page open — it will move on automatically.">
      <ProgressPanel title={view.status.label} description="Calculating what you can comfortably repay." lines={2} />
      <ol className="space-y-2.5">
        {STAGES.map((s) => {
          const done = s.states.includes(view.state);
          return (
            <li key={s.id} className="flex items-center gap-3 text-sm">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? 'bg-success-soft text-success' : 'bg-surface-2 text-subtle'}`} aria-hidden="true">
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <span className={done ? 'text-fg' : 'text-muted'}>
                {s.label}
                <span className="sr-only">{done ? ' — done' : ' — pending'}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <Why>Your statement is analysed securely. We never show the merchant your income, statements or credit details.</Why>
    </StepCard>
  );
}

export function AffordabilityReviewStep() {
  const { summary } = useCheckout();
  return (
    <StepCard eyebrow="Step 3 · Connect finances" title="We’re checking your application" description="This can take a little longer for some applications. It is not a decline.">
      <ul className="space-y-3 text-sm text-muted">
        <li className="flex gap-3">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" />
          <span>We’ll let you know as soon as there’s an update.</span>
        </li>
        <li className="flex gap-3">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" />
          <span>Your progress is saved. You can close this page and return later with the checkout link from {summary.partner.name}.</span>
        </li>
      </ul>
    </StepCard>
  );
}
