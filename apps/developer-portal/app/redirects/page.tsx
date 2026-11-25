import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code';
import { Callout, DocPage, H2, P } from '@/components/doc';

export const metadata: Metadata = { title: 'Redirects & return URLs' };

export default function Redirects() {
  return (
    <DocPage
      path="/redirects"
      eyebrow="Accept payments"
      title="Redirects & return URLs"
      lede="Send the customer to the hosted checkout, then bring them back to your store. A redirect is a navigation event — never a payment or release confirmation."
      toc={['Redirect to checkout', 'Handling return_url', 'Handling cancel_url', 'What the customer sees']}
    >
      <H2>Redirect to checkout</H2>
      <P>
        Redirect the customer’s browser to <code>checkout_url</code> with an HTTP <code>303 See Other</code> (or a full-page navigation). Do not embed the hosted checkout in an iframe — it refuses to be framed. Each session belongs to one customer; never share a <code>checkout_url</code> between customers.
      </P>
      <CodeBlock
        lang="javascript"
        title="Express"
        code={`app.post('/checkout/pay-with-araf', async (req, res) => {
  const session = await createArafSession(req.user, req.session.cartId); // server-side call
  res.redirect(303, session.checkout_url);
});`}
      />

      <H2>Handling return_url</H2>
      <P>
        When the customer leaves the hosted checkout they are sent to your <code>return_url</code>. Arriving there means only that the customer came back — the application may be eligible, under review, approved, declined or still in progress. Financing approval can take minutes to days.
      </P>
      <Callout tone="danger" title="Never treat a redirect as proof of payment">
        Query strings and redirects can be forged or replayed by anyone. On your return page, look up the order on your server and call <code>GET /api/v1/applications/{'{reference}'}</code>. Release goods only after <Link href="/releases">verifying the release authorisation</Link>.
      </Callout>
      <CodeBlock
        lang="typescript"
        title="Return page (server)"
        code={`export default async function OrderReturnPage({ params }: { params: { order: string } }) {
  const order = await db.orders.find(params.order);              // your own record
  const app = await araf.get(\`/applications/\${order.arafReference}\`); // authoritative status
  return <OrderStatus status={app.status} />;                      // e.g. "Under review"
}`}
      />
      <P>Show the customer an honest status, for example:</P>
      <ul>
        <li>
          <code>SUBMITTED</code> — “Your financing application is with The Alternative Bank. It is not yet approved.”
        </li>
        <li>
          <code>APPROVED</code> … <code>VENDOR_PAYMENT_CONFIRMED</code> — “Financing approved. We will prepare your order once the Bank authorises release.”
        </li>
        <li>
          <code>READY_FOR_RELEASE</code> — prepare the order, after verifying the release.
        </li>
        <li>
          <code>DECLINED</code> — “Pay with ARAF could not finance this purchase.” Offer other payment methods. Do not speculate about reasons; none are shared with merchants.
        </li>
      </ul>

      <H2>Handling cancel_url</H2>
      <P>
        The customer chose to leave without completing. Keep the cart, and offer to resume (redirect to the same <code>checkout_url</code> while the session is active) or to choose another payment method. If they change the cart, create a <Link href="/checkout-sessions#revised-carts">revised session</Link>.
      </P>

      <H2>What the customer sees</H2>
      <P>
        The hosted checkout guides the customer through identity verification (BVN and date of birth), a preliminary eligibility check, account selection or opening, statement sharing, an indicative offer, the Murabaha documents and the repayment mandate.
      </P>
    </DocPage>
  );
}
