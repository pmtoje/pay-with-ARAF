import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocPage, H2, H3, P, SimpleTable } from '@/components/doc';
import { SANDBOX_IDENTITIES } from '@/lib/reference';

export const metadata: Metadata = { title: 'Sandbox testing' };

export default function Sandbox() {
  return (
    <DocPage
      path="/sandbox"
      eyebrow="Reference"
      title="Sandbox testing"
      lede="Drive the hosted checkout to any outcome with synthetic test identities, and exercise payments, release and webhooks with the sandbox simulators."
      toc={['Test identities', 'Using a test identity', 'Simulators', 'Test webhooks']}
      wide
    >
      <H2>Test identities</H2>
      <Callout tone="warning" title="Synthetic data only">
        These people are fictional. BVNs in the <code>222000000xx</code> range are reserved for the sandbox simulator and never resolve in production. Never enter real customer data in the sandbox.
      </Callout>
      <SimpleTable
        caption="Sandbox test identities"
        mono={[1, 2]}
        head={['Scenario', 'BVN', 'Date of birth', 'What happens', 'Expected path']}
        rows={SANDBOX_IDENTITIES.map((i) => [
          <span key="s">
            <span className="block font-semibold text-fg">{i.title}</span>
            <code className="text-2xs">{i.scenario}</code>
          </span>,
          i.bvn,
          i.dateOfBirth,
          i.description,
          i.suggestedPath,
        ])}
      />

      <H2>Using a test identity</H2>
      <ol>
        <li>
          Create a checkout session with your <code>sk_test_</code> key (or in the <Link href="/explorer">API explorer</Link>) and open its <code>checkout_url</code>.
        </li>
        <li>Enter the identity’s BVN and date of birth. One-time codes are delivered to a sandbox message inbox — no real SMS or email is sent.</li>
        <li>Follow the scenario’s path. Mono connections, account opening and Remita mandate authorisation are simulated sandbox pages; statement PDFs are analysed by a simulator.</li>
        <li>Watch your webhook endpoint and the Partner portal as the application progresses.</li>
      </ol>
      <P>
        Steps that the Bank performs — credit review, ARAF approval, documentation checks, maker-checker vendor payment approval and release — are completed by Bank staff in the sandbox administration portal. Ask your Bank integration contact to progress test applications, or to run a scenario end to end with you.
      </P>

      <H2>Simulators</H2>
      <H3>Payments and release</H3>
      <P>
        Vendor payments use a simulated NIP rail: responses and resources carry <code>simulated: true</code>, provider references start with <code>NIP-SBX-</code>, and the <code>PAYMENT_FAILURE</code> and <code>PAYMENT_UNKNOWN</code> identities exercise failure and reconciliation paths.
      </P>
      <H3>Refunds</H3>
      <P>
        When a refund is awaiting the vendor (<code>VENDOR_REFUND_PENDING</code>), use <strong>Partner portal → Settlements → Refunds → Simulate vendor refund sent</strong> to record the vendor’s refund on the simulated rail and trigger reconciliation (<code>refund.completed</code>).
      </P>

      <H2>Test webhooks</H2>
      <P>
        In <strong>Partner portal → Integration → Webhooks</strong>, send a test event of any type to your endpoints. Test events carry <code>&quot;test&quot;: true</code>, application <code>ARAF-TEST-000000</code> and order <code>TEST-ORDER</code>. The test <code>goods.release_authorized</code> event contains the note “TEST EVENT — do not release goods”.
      </P>
      <P>
        Sandbox retries are fast (seconds to two minutes) so you can observe backoff and dead-lettering. Verify your handler with the <Link href="/tools/webhook-verifier">signature verifier</Link>.
      </P>
    </DocPage>
  );
}
