import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock, CodeTabs } from '@/components/code';
import { Callout, DocPage, Endpoint, H2, P, ParamTable, SimpleTable } from '@/components/doc';
import { RELEASE_RESPONSE, json } from '@/lib/examples';
import { fetchTabs } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Goods release verification' };

export default function Releases() {
  return (
    <DocPage
      path="/releases"
      eyebrow="Orders & money"
      title="Goods release verification"
      lede="Under Murabaha the Bank buys the goods from the vendor and sells them to the customer. You may hand over goods only when the Bank has authorised release — and you must confirm that authorisation through the API."
      toc={['The rule', 'Retrieve a release', 'Release statuses', 'Release checklist']}
    >
      <H2>The rule</H2>
      <Callout tone="danger" title="GET /api/v1/releases/{reference} is the only acceptable proof">
        Release goods only when this endpoint returns <code>release_authorized: true</code> and <code>status: &quot;AUTHORIZED&quot;</code>, for the expected order and items. A webhook, a redirect, a customer’s screenshot, an email or a payment notice is never sufficient on its own.
      </Callout>
      <P>
        A release is authorised only after the vendor payment is <strong>confirmed by the authoritative payment system</strong> and every contractual condition (possession evidenced, cost and profit disclosed, sale contract executed) is satisfied. You learn the release reference from the <code>goods.release_authorized</code> webhook (<code>data.release_reference</code>) or from <code>release.reference</code> on the application.
      </P>

      <H2>Retrieve a release</H2>
      <Endpoint method="GET" path="/api/v1/releases/{release_reference}" scope="orders:read" />
      <CodeTabs tabs={fetchTabs('GET', '/releases/REL-000009')} />
      <CodeBlock lang="json" title="200 OK" code={json(RELEASE_RESPONSE)} />
      <ParamTable
        caption="Release fields"
        params={[
          { name: 'release_authorized', type: 'boolean', required: true, description: <>true only while <code>status</code> is <code>AUTHORIZED</code>.</> },
          { name: 'status', type: 'string', required: true, description: 'AUTHORIZED, SUSPENDED, CONSUMED or REVOKED (below).' },
          { name: 'merchant_order_reference', type: 'string', required: true, description: 'Must match the order you are about to fulfil.' },
          { name: 'authorized_items', type: 'array', required: true, description: 'The SKUs, names and quantities you may hand over. Release nothing else.' },
          { name: 'authorized_amount', type: 'integer (kobo)', required: true, description: 'Purchase amount covered by the authorisation.' },
          { name: 'payment_reference / payment_status / vendor_payment_amount', type: 'string / string / integer', required: true, description: 'The confirmed vendor payment backing this release.' },
          { name: 'suspended_at / suspension_reason', type: 'ISO 8601 / string', description: 'Set when the Bank suspended the release.' },
          { name: 'simulated', type: 'boolean', required: true, description: 'true in the sandbox (payment rails are simulated).' },
        ]}
      />

      <H2>Release statuses</H2>
      <SimpleTable
        caption="Release statuses"
        head={['Status', 'release_authorized', 'Meaning']}
        rows={[
          ['AUTHORIZED', 'true', 'You may hand over the authorised items.'],
          ['SUSPENDED', 'false', 'Do not release. Suspended by the Bank, after a cancellation request, or after a vendor payment reversal. You receive goods.release_suspended.'],
          ['CONSUMED', 'false', 'Already used: you recorded dispatch or collection.'],
          ['REVOKED', 'false', 'Withdrawn permanently (e.g. order cancelled and refunded). Do not release.'],
        ]}
      />
      <P>
        A suspended release can be reinstated by the Bank; you then receive another <code>goods.release_authorized</code> with <code>reinstated: true</code>. Always re-verify immediately before handing over goods.
      </P>

      <H2>Release checklist</H2>
      <ol>
        <li>
          Receive <code>goods.release_authorized</code> (verify its signature) or see the order in the Partner portal’s <em>Ready for release</em> queue.
        </li>
        <li>
          Call <code>GET /api/v1/releases/{'{reference}'}</code>. Check <code>release_authorized === true</code>, the order reference and the items.
        </li>
        <li>Hand over only the authorised items to the customer’s verified delivery contact.</li>
        <li>
          Record it immediately with <Link href="/fulfilment">POST /orders/{'{ref}'}/fulfil</Link> (<code>DISPATCHED</code> or <code>COLLECTED</code>). This consumes the authorisation.
        </li>
      </ol>
      <P>
        Fulfilment calls are rejected with <code>409 RELEASE_NOT_AUTHORIZED</code> when no active authorisation exists — the API enforces the rule even if your code does not.
      </P>
    </DocPage>
  );
}
