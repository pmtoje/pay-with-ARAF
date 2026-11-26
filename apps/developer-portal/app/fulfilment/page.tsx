import type { Metadata } from 'next';
import { CodeBlock, CodeTabs } from '@/components/code';
import { Callout, DocPage, Endpoint, H2, H3, P, ParamTable, SimpleTable } from '@/components/doc';
import { json } from '@/lib/examples';
import { fetchTabs } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Fulfilment, cancellations & returns' };

export default function Fulfilment() {
  return (
    <DocPage
      path="/fulfilment"
      eyebrow="Orders & money"
      title="Fulfilment, cancellations & returns"
      lede="Record what happens to the goods after release, and ask the Bank to cancel or reverse an order. All endpoints take your merchant_order_reference and require the orders:write scope."
      toc={['Confirm customer equity', 'Record fulfilment', 'Confirm delivery', 'Cancel an order', 'Request a return']}
    >
      <Callout tone="info">
        These actions are also available to your staff in the Partner portal (<em>Ready for release</em> and application detail pages). Each step can be recorded once — repeating it returns <code>409 FULFILMENT_DUPLICATE</code>.
      </Callout>

      <H2>Confirm customer equity</H2>
      <P>
        If your configuration allows customer equity, a customer may choose to pay part of the price themselves (for example ₦2,000,000 of a ₦5,000,000 item). You collect that equity directly, after the Bank approves the financing (<code>application.equity.payable</code> is <code>true</code>). The Bank finances only the remainder (<code>financed_amount</code>, ₦3,000,000 in the example), charges its profit only on that amount, and pays the vendor only that amount — and only after you confirm the equity.
      </P>
      <Endpoint method="POST" path="/api/v1/orders/{merchant_order_reference}/equity" scope="orders:write" />
      <ParamTable
        caption="Equity body"
        params={[
          { name: 'amount', type: 'integer (kobo)', required: true, description: <>Must equal <code>application.equity.amount</code> exactly; otherwise <code>422 EQUITY_AMOUNT_MISMATCH</code>.</> },
          { name: 'payment_reference', type: 'string (4–64, A–Z 0–9 . _ -)', required: true, description: 'Your receipt reference. Repeating the same reference is idempotent; a different one after confirmation returns 409 EQUITY_ALREADY_CONFIRMED.' },
        ]}
      />
      <CodeTabs tabs={fetchTabs('POST', '/orders/ORD-10045/equity', { amount: 200000000, payment_reference: 'ALTMALL-EQ-10045' })} />
      <CodeBlock lang="json" title="200 OK" code={json({ status: 'CONFIRMED', idempotent_replay: false })} />
      <P>
        You then receive <code>application.equity_confirmed</code>. Before approval the call returns <code>409 INVALID_STATE</code>; if the customer chose no equity it returns <code>409 EQUITY_NOT_REQUIRED</code>.
      </P>

      <H2>Record fulfilment</H2>
      <Endpoint method="POST" path="/api/v1/orders/{merchant_order_reference}/fulfil" scope="orders:write" />
      <ParamTable
        caption="Fulfil body"
        params={[
          { name: 'status', type: '"PREPARED" | "DISPATCHED" | "COLLECTED"', required: true, description: <><code>PREPARED</code> is informational. <code>DISPATCHED</code> (shipped) or <code>COLLECTED</code> (customer collected in person) consumes the release authorisation and moves the application to <code>DISPATCHED</code>; <code>COLLECTED</code> also completes delivery immediately.</> },
          { name: 'tracking_reference', type: 'string (≤120)', description: 'Carrier tracking number. Included in goods.dispatched.' },
          { name: 'carrier', type: 'string (≤120)', description: 'Carrier name. Included in goods.dispatched.' },
          { name: 'note', type: 'string (≤500)', description: 'Free-text note for the record.' },
        ]}
      />
      <CodeTabs tabs={fetchTabs('POST', '/orders/ORD-10045/fulfil', { status: 'DISPATCHED', tracking_reference: 'GIG-123', carrier: 'GIG Logistics' })} />
      <CodeBlock lang="json" title="200 OK" code={json({ ok: true })} />
      <P>
        Requires an <strong>active</strong> release authorisation; otherwise <code>409 RELEASE_NOT_AUTHORIZED</code> (the blocked attempt is audited).
      </P>

      <H2>Confirm delivery</H2>
      <Endpoint method="POST" path="/api/v1/orders/{merchant_order_reference}/deliver" scope="orders:write" />
      <ParamTable
        caption="Deliver body"
        params={[
          { name: 'note', type: 'string (≤500)', description: 'e.g. “Signed for by customer”.' },
          { name: 'exception', type: 'boolean', description: <>Set <code>true</code> to report a delivery problem instead of confirming delivery. The Bank’s operations team is alerted; the application stays <code>DISPATCHED</code>.</> },
          { name: 'delivered_at', type: 'ISO 8601', description: 'Accepted for your records.' },
        ]}
      />
      <CodeTabs tabs={fetchTabs('POST', '/orders/ORD-10045/deliver', { note: 'Signed for by customer' })} />
      <P>
        Only valid while the application is <code>DISPATCHED</code> (else <code>409 INVALID_STATE</code>). Confirming delivery emits <code>goods.delivered</code> and completes origination; repayments continue between the customer and the Bank.
      </P>

      <H2>Cancel an order</H2>
      <Endpoint method="POST" path="/api/v1/orders/{merchant_order_reference}/cancel" scope="orders:write" />
      <ParamTable caption="Cancel body" params={[{ name: 'reason', type: 'string (3–500)', required: true, description: 'Why the order is being cancelled.' }]} />
      <CodeTabs tabs={fetchTabs('POST', '/orders/ORD-10045/cancel', { reason: 'Item out of stock' })} />
      <H3>Before the vendor is paid</H3>
      <P>The application is cancelled immediately and <code>order.cancelled</code> is emitted.</P>
      <CodeBlock lang="json" title="200 OK" code={json({ status: 'CANCELLED', requires_reversal: false })} />
      <H3>Once a vendor payment instruction exists</H3>
      <P>
        Cancellation becomes a <strong>reversal request</strong> reviewed by the Bank: any active release authorisation is suspended (<code>goods.release_suspended</code>, reason <code>CANCELLATION_REQUESTED</code>), and the vendor must refund the Bank before the order is finally cancelled (<code>refund.initiated</code> → <code>refund.completed</code> → <code>order.cancelled</code>). Do not release the goods.
      </P>
      <CodeBlock lang="json" title="200 OK" code={json({ status: 'CANCELLATION_REQUESTED', requires_reversal: true, cancellation_id: '6b0f3c7e-2a4d-4f55-9f0c-8e8b1a2d3c4e' })} />

      <H2>Request a return</H2>
      <Endpoint method="POST" path="/api/v1/orders/{merchant_order_reference}/return" scope="orders:write" />
      <ParamTable
        caption="Return body"
        params={[
          { name: 'type', type: 'enum', required: true, description: <>One of <code>FULL_RETURN</code>, <code>PARTIAL_RETURN</code>, <code>DAMAGED</code>, <code>INCORRECT_PRODUCT</code>, <code>NON_DELIVERY</code>.</> },
          { name: 'reason', type: 'string (3–500)', required: true, description: 'Description of the problem.' },
          { name: 'items', type: 'array', description: <>For partial returns: <code>[{'{ sku, quantity }'}]</code>.</> },
        ]}
      />
      <CodeTabs tabs={fetchTabs('POST', '/orders/ORD-10045/return', { type: 'DAMAGED', reason: 'Screen cracked on arrival', items: [{ sku: 'PHONE-001', quantity: 1 }] })} />
      <CodeBlock lang="json" title="200 OK" code={json({ return_id: '1d5c8b2a-7e44-4a1b-b0f6-5c3e9d8a2f10', status: 'REQUESTED' })} />
      <SimpleTable
        caption="When returns are accepted"
        head={['Application status', 'Return allowed?']}
        mono={[]}
        rows={[
          ['READY_FOR_RELEASE, DISPATCHED, DELIVERED, COMPLETED', 'Yes'],
          ['Any other status', <>No — <code>409 INVALID_STATE</code> (cancel instead)</>],
        ]}
      />
      <P>The Bank reviews each return. If a refund is due, the vendor refunds the Bank and you receive <code>refund.initiated</code> and <code>refund.completed</code>.</P>
    </DocPage>
  );
}
