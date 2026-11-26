import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock, CodeTabs } from '@/components/code';
import { Callout, DocPage, Endpoint, H2, H3, P, ParamTable, SimpleTable } from '@/components/doc';
import { CHECKOUT_RESPONSE, json } from '@/lib/examples';
import { CREATE_SESSION_TABS, fetchTabs } from '@/lib/snippets';

export const metadata: Metadata = { title: 'Create a checkout session' };

const CART_ERRORS: Array<[string, string]> = [
  ['EMPTY_CART', 'items is empty.'],
  ['INVALID_QUANTITY', 'A quantity is not an integer between 1 and 1000.'],
  ['INVALID_UNIT_AMOUNT', 'A unit_amount is not a positive integer.'],
  ['CATEGORY_NOT_ELIGIBLE', 'An item’s category is not in your partner configuration’s eligible categories.'],
  ['CATEGORY_NOT_PERMITTED_FOR_VENDOR', 'The item’s category is not one the vendor is approved to sell (details.sku names the item).'],
  ['AMOUNT_MISMATCH', 'amount ≠ Σ(unit_amount × quantity). The API recomputes the total; it never trusts the declared amount.'],
  ['BELOW_PARTNER_MINIMUM', 'amount is below your configured minimum transaction.'],
  ['ABOVE_PARTNER_MAXIMUM', 'amount is above your configured maximum transaction.'],
  ['MULTIPLE_VENDORS_NOT_SUPPORTED', 'Items reference more than one vendor and your configuration does not allow multi-vendor carts.'],
];

export default function CheckoutSessions() {
  return (
    <DocPage
      path="/checkout-sessions"
      eyebrow="Accept payments"
      title="Create a checkout session"
      lede="A checkout session represents one customer’s attempt to finance one order. Create it from your server with whatever customer details you already have — Pay with ARAF pre-fills them and only asks for what is missing — then open the checkout on your page (or redirect)."
      toc={['Create a session', 'Request body', 'Response', 'Validation rules', 'Duplicate checkouts', 'Revised carts', 'Retrieve a session']}
    >
      <H2>Create a session</H2>
      <Endpoint method="POST" path="/api/v1/checkout/sessions" scope="checkout:write" />
      <P>
        The <code>Idempotency-Key</code> header is <strong>required</strong> (8–128 characters from <code>A–Z a–z 0–9 _ - : .</code>). Use one key per logical attempt — for example your order reference plus an attempt counter — and reuse it when retrying after a timeout. See <Link href="/errors#idempotency">idempotency</Link>.
      </P>
      <CodeTabs tabs={CREATE_SESSION_TABS} />

      <H2>Request body</H2>
      <P>JSON, snake_case. Unknown fields are rejected. All monetary values are <strong>integer kobo</strong> (₦1 = 100 kobo).</P>
      <ParamTable
        caption="Checkout session fields"
        params={[
          { name: 'merchant_order_reference', type: 'string (1–64)', required: true, description: <>Your order ID. Letters, digits and <code>. _ : - /</code> only. Unique per order in your store.</> },
          { name: 'currency', type: '"NGN"', required: true, description: 'Only Nigerian naira is supported.' },
          { name: 'amount', type: 'integer (kobo)', required: true, description: 'Cart total. Must equal the sum of unit_amount × quantity across items and fall within your configured minimum and maximum.' },
          { name: 'items', type: 'array (1–50)', required: true, description: 'Cart lines, see below.' },
          { name: 'items[].sku', type: 'string (1–64)', required: true, description: 'Your SKU. Same character rules as merchant_order_reference.' },
          { name: 'items[].name', type: 'string (1–200)', required: true, description: 'Product name shown to the customer and on the financing documents.' },
          { name: 'items[].quantity', type: 'integer (1–1000)', required: true, description: 'Quantity.' },
          { name: 'items[].unit_amount', type: 'integer (kobo)', required: true, description: 'Unit price in kobo (positive).' },
          { name: 'items[].category', type: 'string (1–64)', required: true, description: 'Product category, matched case-insensitively against your eligible categories and the vendor’s approved categories (e.g. smartphones, laptops, appliances).' },
          { name: 'items[].vendor_reference', type: 'string (1–64)', required: true, description: 'The approved vendor that will be paid for this item.' },
          { name: 'customer.email', type: 'email', description: 'Customer contact for delivery and notifications. Shown to your fulfilment staff in the release queue.' },
          { name: 'customer.phone', type: 'string', description: <>10–15 digits, optional leading <code>+</code> (e.g. <code>+2348030000001</code>).</> },
          { name: 'customer.first_name / last_name', type: 'string (≤80)', description: 'Send whatever you already collected — the hosted checkout pre-fills it and only asks the shopper for what is missing.' },
          { name: 'customer.address', type: '{ line1, city, state }', description: 'Delivery address. Pre-fills account opening for new-to-bank customers.' },
          { name: 'customer.date_of_birth', type: 'YYYY-MM-DD', description: 'If provided, the shopper is not asked for it. Identity is still confirmed with a one-time code to the BVN-linked phone.' },
          { name: 'customer.bvn', type: '11 digits', description: <>Only if you already hold it lawfully (e.g. KYC-regulated partners). Encrypted at rest, never returned to you, never put in URLs; the shopper sees only its last two digits and can replace it. If it does not match, the shopper is asked to enter it.</> },
          { name: 'return_url', type: 'URL (≤2048)', required: true, description: 'Where the customer is sent after the hosted checkout. Its origin must be on your approved list (HTTPS in production).' },
          { name: 'cancel_url', type: 'URL (≤2048)', required: true, description: 'Where the customer is sent if they abandon checkout. Same origin rules as return_url.' },
          { name: 'revises_session_id', type: 'string', description: <>Replace an active session for the same order with a revised cart. See <a href="#revised-carts">revised carts</a>.</> },
          { name: 'metadata', type: 'object', description: 'Up to 64-character keys and 256-character string values. Validated and accepted; it is not currently stored or returned, so keep your own mapping.' },
        ]}
      />

      <H2>Response</H2>
      <P>
        <code>201 Created</code>. A replay with the same <code>Idempotency-Key</code> and body returns the same response with the header <code>Idempotent-Replayed: true</code>.
      </P>
      <CodeBlock lang="json" title="201 Created" code={json(CHECKOUT_RESPONSE)} />
      <ParamTable
        caption="Response fields"
        params={[
          { name: 'session_id', type: 'string', required: true, description: <>The session ID (<code>cs_test_…</code> / <code>cs_live_…</code>). Store it against your order.</> },
          { name: 'application_reference', type: 'string', required: true, description: <>The financing application reference (<code>ARAF-YYYY-NNNNNN</code>). Use it with <code>GET /applications/{'{reference}'}</code> and to match webhooks.</> },
          { name: 'checkout_url', type: 'URL', required: true, description: 'Redirect the customer here.' },
          { name: 'status', type: 'string', required: true, description: 'CREATED on creation; later OPEN, COMPLETED, EXPIRED, CANCELLED or SUPERSEDED.' },
          { name: 'expires_at', type: 'ISO 8601', required: true, description: 'When the session expires if the customer does not progress (your configured application expiry).' },
          { name: 'livemode', type: 'boolean', required: true, description: 'false in the sandbox.' },
        ]}
      />

      <H2>Validation rules</H2>
      <H3>Schema errors — 422 VALIDATION_FAILED</H3>
      <P>
        Missing or malformed fields return <code>VALIDATION_FAILED</code> with <code>details.fields[]</code> (<code>path</code>, <code>message</code>) — for example a decimal amount, an unknown field, or a missing <code>Idempotency-Key</code>.
      </P>
      <H3>Cart errors — 422 CART_INVALID</H3>
      <P>
        The cart is validated server-side; <code>details.errors[]</code> lists every problem found:
      </P>
      <SimpleTable caption="Cart validation errors" head={['details.errors[]', 'Meaning']} rows={CART_ERRORS.map(([c, d]) => [c, d])} />
      <H3>Vendors — 422 VENDOR_NOT_ELIGIBLE</H3>
      <P>
        Every <code>vendor_reference</code> must be one of your vendors, approved by the Bank, with an active and verified settlement account. Otherwise the request fails with <code>details.vendor_reference</code>.
      </P>
      <H3>Return URLs — 422 RETURN_URL_NOT_APPROVED</H3>
      <P>
        The origins (scheme + host + port) of <code>return_url</code> and <code>cancel_url</code> must exactly match an approved origin for your account — this prevents open redirects. Approved origins are listed in <strong>Partner portal → Integration</strong> and changed by the Bank’s onboarding team. Production requires HTTPS.
      </P>
      <CodeBlock
        lang="json"
        title="422 Unprocessable Entity"
        code={json({ error: { code: 'CART_INVALID', message: 'The cart failed validation.', retryable: false, details: { errors: ['AMOUNT_MISMATCH'] }, correlation_id: '0c5d7e7a-3c8f-4e0e-9b1e-2f3a8d7c1b20' } })}
      />

      <H2>Duplicate checkouts</H2>
      <P>Only one live financing attempt is allowed per <code>merchant_order_reference</code>. Creating another returns <code>409 DUPLICATE_CHECKOUT</code>:</P>
      <ul>
        <li>
          If an active session exists (created/open, not expired, and its application is not declined, cancelled or expired), <code>details.session_id</code> identifies it. Redirect the customer to that session, or revise it.
        </li>
        <li>
          If the order’s application has already been submitted beyond the offer stage, the message is “A financing application for this order has already been submitted.” and <code>details.application_reference</code> identifies it.
        </li>
        <li>After a previous attempt was declined, cancelled or expired, you may create a new session for the same order.</li>
      </ul>
      <P>Different <code>Idempotency-Key</code> values do not bypass this check — it is enforced per order, under a lock.</P>

      <H2 id="revised-carts">Revised carts</H2>
      <P>
        If the customer changes their cart — or is eligible for less than the cart total (<code>application.action_required</code> with <code>reason: &quot;CART_REVISION_REQUIRED&quot;</code>) — create a new session for the same order with <code>revises_session_id</code> set to the active session’s ID:
      </P>
      <ul>
        <li>The revised session gets a new <code>session_id</code> and <code>application_reference</code>.</li>
        <li>
          The old session becomes <code>SUPERSEDED</code> (its <code>superseded_by</code> points to the new session) and its application is cancelled.
        </li>
        <li>
          <code>revises_session_id</code> must reference an active session for the same order, and revision is only possible before the customer accepts an offer; otherwise you receive <code>409 INVALID_STATE</code>.
        </li>
      </ul>

      <H2>Retrieve a session</H2>
      <Endpoint method="GET" path="/api/v1/checkout/sessions/{session_id}" scope="checkout:read" />
      <CodeTabs tabs={fetchTabs('GET', '/checkout/sessions/cs_test_8jgcwIBR4vXwdvc093VF3lCD')} />
      <CodeBlock
        lang="json"
        title="200 OK"
        code={json({
          object: 'checkout_session',
          session_id: 'cs_test_8jgcwIBR4vXwdvc093VF3lCD',
          status: 'CREATED',
          application_reference: 'ARAF-2026-000002',
          application_status: 'CUSTOMER_ACTION_REQUIRED',
          merchant_order_reference: 'ORD-10045',
          amount: 45000000,
          currency: 'NGN',
          checkout_url: 'http://localhost:3001/c/cs_test_8jgcwIBR4vXwdvc093VF3lCD',
          expires_at: '2026-11-26T09:09:03.998Z',
          superseded_by: null,
        })}
      />
      <Callout tone="info">
        Sessions and every other resource are scoped to your partner account and environment: identifiers belonging to anyone else return <code>404 NOT_FOUND</code>.
      </Callout>
    </DocPage>
  );
}
