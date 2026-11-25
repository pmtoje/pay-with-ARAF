import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code';
import { DocPage, H2, P } from '@/components/doc';
import { BASE_URL } from '@/lib/examples';

export const metadata: Metadata = { title: 'API reference' };

const ENDPOINTS: Array<{ method: 'GET' | 'POST'; path: string; scope: string; summary: string; status: string; doc: string }> = [
  { method: 'POST', path: '/checkout/sessions', scope: 'checkout:write', summary: 'Create a checkout session (Idempotency-Key required)', status: '201', doc: '/checkout-sessions' },
  { method: 'GET', path: '/checkout/sessions/{session_id}', scope: 'checkout:read', summary: 'Retrieve a checkout session', status: '200', doc: '/checkout-sessions#retrieve-a-session' },
  { method: 'GET', path: '/applications/{reference}', scope: 'applications:read', summary: 'Retrieve an application’s merchant status', status: '200', doc: '/applications' },
  { method: 'GET', path: '/orders/{merchant_order_reference}', scope: 'orders:read', summary: 'Retrieve an order with its current application', status: '200', doc: '/applications#retrieve-an-order' },
  { method: 'GET', path: '/releases/{release_reference}', scope: 'orders:read', summary: 'Verify a goods release authorisation', status: '200', doc: '/releases' },
  { method: 'POST', path: '/orders/{merchant_order_reference}/fulfil', scope: 'orders:write', summary: 'Record PREPARED, DISPATCHED or COLLECTED', status: '200', doc: '/fulfilment#record-fulfilment' },
  { method: 'POST', path: '/orders/{merchant_order_reference}/deliver', scope: 'orders:write', summary: 'Confirm delivery or report an exception', status: '200', doc: '/fulfilment#confirm-delivery' },
  { method: 'POST', path: '/orders/{merchant_order_reference}/cancel', scope: 'orders:write', summary: 'Cancel an order (reversal request after payment)', status: '200', doc: '/fulfilment#cancel-an-order' },
  { method: 'POST', path: '/orders/{merchant_order_reference}/return', scope: 'orders:write', summary: 'Request a return', status: '200', doc: '/fulfilment#request-a-return' },
  { method: 'GET', path: '/settlements', scope: 'settlements:read', summary: 'List vendor payments', status: '200', doc: '/settlements' },
  { method: 'GET', path: '/webhook-events', scope: 'webhooks:read', summary: 'List webhook events and deliveries', status: '200', doc: '/settlements#list-webhook-events' },
  { method: 'POST', path: '/webhook-events/{event_id}/retry', scope: 'webhooks:write', summary: 'Redeliver an event', status: '202', doc: '/settlements#retry-an-event' },
];

export default function ApiReference() {
  return (
    <DocPage path="/api-reference" eyebrow="Reference" title="API reference" lede="Every partner API endpoint at a glance. All paths are relative to the base URL and authenticated with a Bearer secret key." toc={['Base URL', 'Endpoints', 'Conventions']} wide>
      <H2>Base URL</H2>
      <CodeBlock lang="text" title="Sandbox" code={BASE_URL} />
      <H2>Endpoints</H2>
      <div className="my-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Partner API endpoints</caption>
          <thead className="bg-surface-2">
            <tr>
              {['Endpoint', 'Scope', 'Success', 'Description'].map((h) => (
                <th key={h} scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-subtle">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.method + e.path} className="border-t border-border align-top">
                <td className="px-4 py-3">
                  <Link href={e.doc} className="no-underline group inline-flex flex-wrap items-center gap-2">
                    <span className={`rounded-sm px-1.5 py-0.5 font-mono text-2xs font-bold ${e.method === 'GET' ? 'bg-info-soft text-info' : 'bg-success-soft text-success'}`}>{e.method}</span>
                    <span className="font-mono text-[13px] text-fg group-hover:text-gold-strong group-hover:underline">{e.path}</span>
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <code>{e.scope}</code>
                </td>
                <td className="px-4 py-3 font-mono text-[13px]">{e.status}</td>
                <td className="px-4 py-3 text-fg/90">{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <P>
        Try any of these against the sandbox in the <Link href="/explorer">API explorer</Link>.
      </P>
      <H2>Conventions</H2>
      <ul>
        <li>JSON request and response bodies, snake_case field names; unknown request fields are rejected.</li>
        <li>Amounts are integer kobo; currency is always NGN.</li>
        <li>Timestamps are ISO 8601 in UTC.</li>
        <li>
          Resources from other partners or environments return <code>404 NOT_FOUND</code>.
        </li>
        <li>
          Errors use one envelope — see <Link href="/errors">Errors &amp; idempotency</Link>.
        </li>
      </ul>
    </DocPage>
  );
}
