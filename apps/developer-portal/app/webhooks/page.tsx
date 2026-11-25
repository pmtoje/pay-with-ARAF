import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code';
import { Callout, DocPage, H2, H3, P, ParamTable, SimpleTable } from '@/components/doc';
import { exampleEvent, json } from '@/lib/examples';

export const metadata: Metadata = { title: 'Receiving webhooks' };

export default function Webhooks() {
  return (
    <DocPage
      path="/webhooks"
      eyebrow="Webhooks"
      title="Receiving webhooks"
      lede="Pay with ARAF notifies your server as applications, payments and goods releases progress. Every delivery is signed, delivered at least once and retried with backoff."
      toc={['Set up an endpoint', 'The request', 'Envelope fields', 'Responding', 'Delivery guarantees', 'Retries and dead-lettering', 'Best practices']}
    >
      <H2>Set up an endpoint</H2>
      <P>
        Add endpoints in <strong>Partner portal → Integration → Webhooks</strong>. Choose the events to subscribe to (no selection = all events). The signing secret (<code>whsec_…</code>) is shown once when you add the endpoint; it can be revealed again (audited) or rotated.
      </P>
      <ul>
        <li>Production endpoints must be public HTTPS URLs; private-network and unsafe targets are rejected with <code>422 WEBHOOK_URL_UNSAFE</code>.</li>
        <li>Redirects are not followed — a 3xx response counts as a failed delivery.</li>
        <li>In the sandbox you can send a test event of any type from the portal.</li>
      </ul>

      <H2>The request</H2>
      <P>Each delivery is an HTTP <code>POST</code> with a JSON body and these headers:</P>
      <SimpleTable
        caption="Webhook headers"
        head={['Header', 'Value']}
        rows={[
          ['Content-Type', 'application/json'],
          ['User-Agent', 'PayWithARAF-Webhooks/1.0'],
          ['ARAF-Signature', <code key="s">t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256&gt;[,v1=…]</code>],
          ['ARAF-Timestamp', 'Unix seconds when the delivery was signed (same as t)'],
          ['ARAF-Event-Id', <>The event ID (<code>evt_…</code>), identical across retries</>],
        ]}
      />
      <CodeBlock lang="json" title="POST /your/webhook/endpoint" code={json(exampleEvent('goods.release_authorized'))} />
      <P>
        Verify the signature before trusting anything in the body — see <Link href="/webhooks/signatures">Verifying signatures</Link>.
      </P>

      <H2>Envelope fields</H2>
      <ParamTable
        caption="Envelope fields"
        params={[
          { name: 'event_id', type: 'string', required: true, description: <>Unique event ID (<code>evt_…</code>). Use it to de-duplicate.</> },
          { name: 'event', type: 'string', required: true, description: <>Event type, e.g. <code>goods.release_authorized</code>. See the <Link href="/webhooks/events">event catalogue</Link>.</> },
          { name: 'version', type: 'string', required: true, description: <>Payload schema version, currently <code>&quot;1.0&quot;</code>.</> },
          { name: 'created_at', type: 'ISO 8601', required: true, description: 'When the event was created (the state change committed). Not the delivery time.' },
          { name: 'livemode', type: 'boolean', required: true, description: 'false for sandbox events.' },
          { name: 'test', type: 'boolean', description: <>Present and <code>true</code> only on test events sent from the Partner portal. Never act on test events.</> },
          { name: 'partner_id', type: 'string', required: true, description: 'Your partner ID.' },
          { name: 'resource_version', type: 'integer', required: true, description: 'Monotonic version of the application when the event was emitted (0 at creation). Use it to discard out-of-order updates.' },
          { name: 'data', type: 'object', required: true, description: <>Always contains <code>application_reference</code> and <code>merchant_order_reference</code>; most events include <code>status</code> (merchant status after the change) plus event-specific fields.</> },
        ]}
      />

      <H2>Responding</H2>
      <P>
        Return any <code>2xx</code> status within <strong>10 seconds</strong> to acknowledge. Anything else — non-2xx, 3xx, a timeout or a connection error — is a failure and is retried. Acknowledge first and do slow work asynchronously (queue the event).
      </P>

      <H2>Delivery guarantees</H2>
      <H3>At-least-once</H3>
      <P>
        An event can be delivered more than once (retries, manual redelivery, network failures after you processed it). Store processed <code>event_id</code>s and make handling idempotent.
      </P>
      <H3>Ordering is not guaranteed</H3>
      <P>
        Retries mean events can arrive out of order. Keep the highest <code>resource_version</code> you have processed per <code>application_reference</code> and ignore events with a lower one — or simply re-read <code>GET /applications/{'{reference}'}</code>, which is always current.
      </P>
      <CodeBlock
        lang="javascript"
        title="Idempotent, order-safe handling"
        code={`async function handleOnce(event) {
  const seen = await db.webhookEvents.insertIfAbsent(event.event_id); // unique index on event_id
  if (!seen.inserted) return;                                        // duplicate delivery

  const ref = event.data.application_reference;
  const current = await db.orders.findByArafReference(ref);
  if (current && event.resource_version < current.arafVersion) return; // stale, out of order

  await db.orders.updateArafState(ref, { status: event.data.status, arafVersion: event.resource_version });
  if (event.event === 'goods.release_authorized') await verifyReleaseAndNotifyWarehouse(event.data.release_reference);
}`}
      />

      <H2>Retries and dead-lettering</H2>
      <ul>
        <li>
          Failed deliveries are retried with <strong>exponential backoff and jitter</strong> (each delay is a random value between half and all of the exponential step). In the sandbox steps start at 4 seconds and cap at 2 minutes so you can watch retries; in production they start at 1 minute and cap at 12 hours.
        </li>
        <li>
          After <strong>8 failed attempts</strong> the delivery is <strong>dead-lettered</strong> and no longer retried automatically.
        </li>
        <li>
          An endpoint that fails <strong>25 times in a row</strong> is automatically suspended. Fix it, then re-enable it in the portal (this resets the failure counter).
        </li>
        <li>
          <strong>Manual retry:</strong> redeliver any event to your active, subscribed endpoints from <strong>Integration → Event log</strong>, or with <code>POST /api/v1/webhook-events/{'{id}'}/retry</code> (scope <code>webhooks:write</code>). The attempt counter starts again.
        </li>
        <li>
          Every delivery, its attempts, last status code, last error and next attempt time are visible in the Event log and via <code>GET /api/v1/webhook-events</code>.
        </li>
      </ul>
      <Callout tone="info" title="Missed events?">
        Webhooks are a convenience, not your only source of truth. Reconcile periodically with <code>GET /api/v1/webhook-events</code> or the application endpoint, especially after outages on your side.
      </Callout>

      <H2>Best practices</H2>
      <ul>
        <li>Verify the signature on the raw body, enforce the 300-second timestamp tolerance, compare in constant time.</li>
        <li>
          Check <code>livemode</code> matches your environment and ignore <code>test: true</code> events in business logic.
        </li>
        <li>
          Never release goods on a webhook alone — confirm with <Link href="/releases">GET /releases/{'{reference}'}</Link>.
        </li>
        <li>Respond quickly; process asynchronously; alert on repeated failures.</li>
        <li>Rotate the signing secret if it may have leaked — both secrets sign deliveries for 24 hours.</li>
      </ul>
    </DocPage>
  );
}
