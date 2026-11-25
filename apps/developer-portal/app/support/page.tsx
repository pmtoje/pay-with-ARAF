import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocPage, H2, P } from '@/components/doc';

export const metadata: Metadata = { title: 'Support' };

export default function Support() {
  return (
    <DocPage path="/support" eyebrow="More" title="Support" lede="How to get help with your Pay with ARAF integration." toc={['Before you contact us', 'What to include', 'Self-service tools']}>
      <H2>Before you contact us</H2>
      <ul>
        <li>
          Check the error <code>code</code> against the <Link href="/errors">error catalogue</Link> — most integration errors explain exactly what to change.
        </li>
        <li>
          Look up the request in <strong>Partner portal → Integration → API requests</strong> and the delivery in <strong>Event log</strong>.
        </li>
        <li>
          Re-read <Link href="/releases">goods release verification</Link> before raising a fulfilment issue.
        </li>
      </ul>
      <H2>What to include</H2>
      <ul>
        <li>
          The <code>correlation_id</code> / <code>X-Correlation-Id</code> of the failing request.
        </li>
        <li>
          The <code>application_reference</code>, <code>merchant_order_reference</code> or <code>event_id</code> involved.
        </li>
        <li>The environment (sandbox or production) and the key prefix (never the full key).</li>
        <li>What you expected and what happened, with timestamps (UTC).</li>
      </ul>
      <Callout tone="danger" title="Never share secrets">
        Do not send secret keys, webhook signing secrets, passwords, authenticator codes or customer personal data (BVNs, account numbers) in support requests. Bank staff will never ask for them.
      </Callout>
      <H2>Self-service tools</H2>
      <P>
        Reproduce calls in the <Link href="/explorer">API explorer</Link>, check webhook signatures with the <Link href="/tools/webhook-verifier">signature verifier</Link>, and send test events from the Partner portal. For onboarding, configuration (approved origins, vendors, categories) and production access, contact your Bank integration contact.
      </P>
    </DocPage>
  );
}
