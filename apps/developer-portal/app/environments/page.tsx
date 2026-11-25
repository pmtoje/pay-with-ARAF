import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code';
import { Callout, DocPage, H2, P, SimpleTable } from '@/components/doc';
import { BASE_URL } from '@/lib/examples';

export const metadata: Metadata = { title: 'Sandbox & production' };

export default function Environments() {
  return (
    <DocPage
      path="/environments"
      eyebrow="Get started"
      title="Sandbox & production"
      lede="Every partner starts in the sandbox: simulated integrations, synthetic customers and no real money. Production is locked until The Alternative Bank approves your go-live."
      toc={['Environments', 'Base URL', 'Keys and livemode', 'Going live']}
    >
      <H2>Environments</H2>
      <SimpleTable
        caption="Environment comparison"
        mono={[]}
        head={['', 'Sandbox', 'Production']}
        rows={[
          ['Secret key prefix', <code key="a">sk_test_</code>, <code key="b">sk_live_</code>],
          ['Checkout session IDs', <code key="a">cs_test_…</code>, <code key="b">cs_live_…</code>],
          ['livemode in responses & events', <code key="a">false</code>, <code key="b">true</code>],
          ['Customers', 'Synthetic test identities only', 'Real customers'],
          ['Credit bureau, statements, ARAF, payments', 'Simulated (responses carry simulated: true where relevant)', 'Live Bank integrations'],
          ['Money movement', 'None', 'Real vendor payments by the Bank'],
          ['Availability', 'From sandbox activation', 'Only after Bank approval (status PRODUCTION_ACTIVE)'],
        ]}
      />
      <Callout tone="warning" title="Keys are bound to one environment">
        A key only works against the environment it was issued for. Using a sandbox key against production (or vice versa) fails with <code>403 API_KEY_ENVIRONMENT_MISMATCH</code>. Production key creation fails with <code>403 PRODUCTION_LOCKED</code> until your partner account is approved for production.
      </Callout>

      <H2>Base URL</H2>
      <P>All partner API endpoints live under <code>/api/v1</code>. In this sandbox build the base URL is:</P>
      <CodeBlock lang="text" title="Sandbox base URL" code={BASE_URL} />
      <P>
        Your exact base URL is shown in <strong>Partner portal → Integration → Overview</strong>. The production base URL is issued by the Bank at go-live. Store it in configuration (for example <code>ARAF_API_BASE_URL</code>), not in code.
      </P>

      <H2>Keys and livemode</H2>
      <P>
        Every object and webhook event carries <code>livemode</code>. Reject events whose <code>livemode</code> does not match the environment your handler is configured for — a cheap guard against a misconfigured endpoint. Sandbox test events sent from the Partner portal also carry <code>&quot;test&quot;: true</code> and use the reference <code>ARAF-TEST-000000</code>.
      </P>

      <H2>Going live</H2>
      <P>
        Production activation is a Bank decision with maker-checker approval. Complete the <Link href="/go-live">production checklist</Link>, then ask your Bank relationship contact to submit your production request. Until then, production remains locked for your account regardless of the keys you hold.
      </P>
    </DocPage>
  );
}
