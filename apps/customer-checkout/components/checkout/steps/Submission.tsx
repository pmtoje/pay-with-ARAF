'use client';

import { formatNaira } from '@araf/ui';
import { useCheckout } from '../context';
import { ProgressPanel, Row, StepCard } from '../ui';

export function SubmissionStep() {
  const { view } = useCheckout();
  const o = view.offer;
  return (
    <StepCard eyebrow="Step 5 · Submit" title="Submitting your application" description="You’ve accepted the indicative offer. We’re now submitting your application to The Alternative Bank for review — it is not yet approved.">
      <ProgressPanel title="Submitting — not yet approved" description="This usually takes a few seconds. Please keep this page open." lines={2} />
      {o && (
        <dl className="divide-y divide-border rounded-md border border-border px-4">
          <Row label="Offer" value={<span className="font-mono text-xs">{o.reference}</span>} />
          <Row label="Monthly repayment" value={`${formatNaira(o.monthly_repayment)} × ${o.tenor_months}`} />
          <Row label="Deferred sale price" value={formatNaira(o.deferred_sale_price)} strong />
        </dl>
      )}
    </StepCard>
  );
}
