import type { Metadata } from 'next';
import { CodeBlock, CodeTabs } from '@/components/code';
import { DocPage, Endpoint, H2, P, ParamTable, SimpleTable } from '@/components/doc';
import { exampleEvent, json } from '@/lib/examples';
import { fetchTabs } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Settlements & event history' };

export default function Settlements() {
  return (
    <DocPage
      path="/settlements"
      eyebrow="Orders & money"
      title="Settlements & event history"
      lede="The Bank pays approved vendors directly to their verified settlement accounts. Use these endpoints to reconcile payments and to audit or replay webhook events."
      toc={['List settlements', 'Payment statuses', 'List webhook events', 'Retry an event']}
    >
      <H2>List settlements</H2>
      <Endpoint method="GET" path="/api/v1/settlements" scope="settlements:read" />
      <ParamTable
        caption="Query parameters"
        params={[
          { name: 'status', type: 'string', description: 'Filter by payment status, e.g. CONFIRMED.' },
          { name: 'limit', type: 'integer (1–200)', description: 'Default 50, newest first.' },
        ]}
      />
      <CodeTabs tabs={fetchTabs('GET', '/settlements?status=CONFIRMED&limit=50')} />
      <CodeBlock
        lang="json"
        title="200 OK"
        code={json({
          object: 'list',
          data: [
            {
              payment_reference: 'PAY-000014',
              application_reference: 'ARAF-2026-000002',
              merchant_order_reference: 'ORD-10045',
              vendor_reference: 'VENDOR-LEKKI-ELEC',
              vendor_name: 'Lekki Electronics Ltd',
              amount: 45000000,
              currency: 'NGN',
              status: 'CONFIRMED',
              beneficiary_account: '••••••6781',
              beneficiary_bank: 'Sandbox Bank',
              provider_reference: 'NIP-SBX-3F9A1C7E52B0',
              reconciliation_status: 'MATCHED',
              initiated_at: '2026-11-25T10:30:09.020Z',
              confirmed_at: '2026-11-25T10:42:18.120Z',
              simulated: true,
            },
          ],
        })}
      />

      <H2>Payment statuses</H2>
      <SimpleTable
        caption="Vendor payment statuses"
        head={['Status', 'Meaning']}
        rows={[
          ['PENDING_APPROVAL', 'Instruction created; awaiting the Bank’s maker-checker approval.'],
          ['INITIATED / PROCESSING', 'Sent to the payment rail.'],
          ['UNKNOWN', 'The outcome is unknown (e.g. timeout). The Bank reconciles before any retry — no double payment.'],
          ['RECONCILIATION_REQUIRED', 'The provider’s confirmation did not match the instruction; under investigation.'],
          ['CONFIRMED', 'Confirmed by the authoritative payment system. Not by itself a release authorisation.'],
          ['FAILED', 'Rejected by the rail. A new instruction needs fresh approval.'],
          ['REVERSED', 'A confirmed payment was reversed. Any release is suspended.'],
        ]}
      />
      <P>
        <code>reconciliation_status</code> is one of <code>PENDING</code>, <code>MATCHED</code>, <code>DISCREPANCY</code> or <code>RESOLVED</code>. Beneficiary account numbers are always masked.
      </P>

      <H2>List webhook events</H2>
      <Endpoint method="GET" path="/api/v1/webhook-events" scope="webhooks:read" />
      <ParamTable
        caption="Query parameters"
        params={[
          { name: 'type', type: 'string', description: 'Filter by event type, e.g. goods.release_authorized.' },
          { name: 'limit', type: 'integer (1–200)', description: 'Default 50, newest first.' },
        ]}
      />
      <CodeTabs tabs={fetchTabs('GET', '/webhook-events?type=goods.release_authorized&limit=20')} />
      <CodeBlock
        lang="json"
        title="200 OK"
        maxHeight="30rem"
        code={json({
          object: 'list',
          data: [
            {
              id: 'evt_95L9ZTu48WZumW0FUOMXD8mI',
              event: 'goods.release_authorized',
              created_at: '2026-11-25T10:55:02.441Z',
              application_reference: 'ARAF-2026-000002',
              merchant_order_reference: 'ORD-10045',
              payload: exampleEvent('goods.release_authorized'),
              deliveries: [
                { id: '0b2bbd8c-53e7-417e-9505-5e6cd7972b2c', endpoint: 'https://shop.example.com/webhooks/araf', status: 'SUCCEEDED', attempts: 1, last_status_code: 200, last_error: null, next_attempt_at: null, succeeded_at: '2026-11-25T10:55:03.012Z' },
              ],
            },
          ],
        })}
      />
      <P>
        Delivery <code>status</code> is <code>PENDING</code>, <code>RETRYING</code>, <code>SUCCEEDED</code>, <code>DEAD_LETTERED</code> or <code>SKIPPED</code> (endpoint disabled). <code>payload</code> is exactly the body that was signed and delivered.
      </P>

      <H2>Retry an event</H2>
      <Endpoint method="POST" path="/api/v1/webhook-events/{event_id}/retry" scope="webhooks:write" />
      <P>Queues a fresh delivery of the event to every <strong>active</strong> endpoint subscribed to its type, resetting the attempt counter.</P>
      <CodeTabs tabs={fetchTabs('POST', '/webhook-events/evt_95L9ZTu48WZumW0FUOMXD8mI/retry')} />
      <CodeBlock lang="json" title="202 Accepted" code={json({ queued_deliveries: 1 })} />
    </DocPage>
  );
}
