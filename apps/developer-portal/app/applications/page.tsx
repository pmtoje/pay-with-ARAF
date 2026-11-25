import type { Metadata } from 'next';
import { CodeBlock, CodeTabs } from '@/components/code';
import { Callout, DocPage, Endpoint, H2, P, ParamTable, SimpleTable } from '@/components/doc';
import { APPLICATION_RESPONSE, json } from '@/lib/examples';
import { fetchTabs } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Application status' };

/** Merchant statuses — packages/business-rules/src/statuses.ts (deriveMerchantStatus). */
const STATUSES: Array<[string, string, string]> = [
  ['CUSTOMER_ACTION_REQUIRED', 'The customer needs to do something: verify identity, confirm or open an account, share a statement, or revise the cart.', 'Wait. Optionally remind the customer to finish.'],
  ['IN_PROGRESS', 'Automated checks are running (identity, eligibility, statement analysis).', 'Wait.'],
  ['UNDER_REVIEW', 'A Bank officer is reviewing the application (manual review).', 'Wait. Reviews can take 24–48 hours.'],
  ['ELIGIBLE', 'The customer is eligible and is reviewing an indicative offer. Not an approval.', 'Wait.'],
  ['SUBMITTED', 'The customer accepted the offer; the application is in the Bank’s ARAF workflow. Not yet approved.', 'Wait.'],
  ['APPROVED', 'Financing approved (documents, mandate and booking may still be in progress).', 'Reserve stock. Do NOT release.'],
  ['VENDOR_PAYMENT_PENDING', 'The Bank is paying the vendor.', 'Do NOT release.'],
  ['VENDOR_PAYMENT_CONFIRMED', 'The vendor payment is confirmed; contractual conditions are being completed.', 'Do NOT release yet.'],
  ['READY_FOR_RELEASE', 'A release authorisation was issued.', 'Verify GET /releases/{reference}, then release.'],
  ['DISPATCHED', 'You recorded dispatch (or collection).', 'Confirm delivery when it happens.'],
  ['DELIVERED', 'Delivery was confirmed.', 'None.'],
  ['COMPLETED', 'Origination complete; repayments continue with the Bank.', 'None.'],
  ['DECLINED', 'The Bank could not offer financing. No reasons are shared.', 'Offer another payment method.'],
  ['CANCELLED', 'The application was cancelled (by the customer, you, a revised cart, or the Bank).', 'Release any reserved stock.'],
  ['EXPIRED', 'The customer did not progress before the session expired.', 'Release any reserved stock.'],
  ['ON_HOLD', 'An operational exception is being resolved by the Bank (e.g. a failed or reversed payment).', 'Do NOT release. Wait for updates.'],
];

export default function Applications() {
  return (
    <DocPage
      path="/applications"
      eyebrow="Accept payments"
      title="Application status"
      lede="Each checkout session creates a financing application. Read its operational status at any time — the API is the source of truth, webhooks are notifications."
      toc={['Retrieve an application', 'Merchant statuses', 'Retrieve an order']}
    >
      <H2>Retrieve an application</H2>
      <Endpoint method="GET" path="/api/v1/applications/{reference}" scope="applications:read" />
      <CodeTabs tabs={fetchTabs('GET', '/applications/ARAF-2026-000002')} />
      <CodeBlock lang="json" title="200 OK" code={json(APPLICATION_RESPONSE)} maxHeight="28rem" />
      <ParamTable
        caption="Application fields"
        params={[
          { name: 'status', type: 'string', required: true, description: 'Merchant status (see below).' },
          { name: 'purchase_amount', type: 'integer (kobo)', required: true, description: 'Cart total.' },
          { name: 'customer_contribution', type: 'integer (kobo)', required: true, description: 'Any part of the cart paid by the customer rather than financed (0 unless partial financing is enabled for your account).' },
          { name: 'vendor_payment', type: 'object | null', required: true, description: 'Latest vendor payment instruction: reference, status, amount, confirmed_at, simulated.' },
          { name: 'release', type: 'object', required: true, description: <><code>{'{ authorized: false }'}</code> until a release exists; then reference, status, authorized (true while AUTHORIZED or after use, CONSUMED) and authorized_at. Verify with the releases endpoint before handing over goods.</> },
          { name: 'timeline', type: 'array', required: true, description: 'Merchant-status history ({ status, at }).' },
          { name: 'fulfilment', type: 'array', required: true, description: 'Fulfilment records you created ({ status, at, tracking_reference }).' },
        ]}
      />
      <Callout tone="gold" title="Privacy">
        Application responses never include BVNs, credit scores, bureau data, statements, salary, affordability calculations, decline reasons or internal notes.
      </Callout>

      <H2>Merchant statuses</H2>
      <P>
        Statuses appear in roughly this order. Eligibility ≠ submission ≠ approval ≠ vendor payment ≠ goods release — only <code>READY_FOR_RELEASE</code> plus a verified release permits handing over goods.
      </P>
      <SimpleTable caption="Merchant statuses" head={['Status', 'Meaning', 'What you should do']} rows={STATUSES.map((s) => [...s])} />

      <H2>Retrieve an order</H2>
      <Endpoint method="GET" path="/api/v1/orders/{merchant_order_reference}" scope="orders:read" />
      <P>Returns your order with its items and the current application (if any). Useful when you only stored your own order reference.</P>
      <CodeBlock
        lang="json"
        title="200 OK"
        code={json({
          object: 'order',
          merchant_order_reference: 'ORD-10045',
          status: 'FINANCING_IN_PROGRESS',
          amount: 45000000,
          currency: 'NGN',
          items: [{ sku: 'PHONE-001', name: 'Sandbox Smartphone X', quantity: 1, unit_amount: 45000000, line_amount: 45000000, category: 'smartphones' }],
          application: { object: 'application', reference: 'ARAF-2026-000002', status: 'CUSTOMER_ACTION_REQUIRED', '…': '(same shape as GET /applications/{reference})' },
        })}
      />
    </DocPage>
  );
}
