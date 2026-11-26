import type { Metadata } from 'next';
import { BnplButtonPreview, EmbedFlow, embedSnippets } from '@araf/ui';
import { CodeBlock } from '@/components/code';
import { Callout, DocPage, H2, P, ParamTable, SimpleTable } from '@/components/doc';

export const metadata: Metadata = { title: 'Embedded checkout (no redirect)' };

const CHECKOUT = process.env.NEXT_PUBLIC_CHECKOUT_URL ?? 'http://localhost:3001';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function Embedded() {
  const s = embedSnippets(`${CHECKOUT}/v1/araf.js`, `${API}/api/v1`);
  return (
    <DocPage
      path="/embedded-checkout"
      eyebrow="Accept payments"
      title="Embedded checkout — shoppers never leave your site"
      lede="Offer “Buy Now Pay Later with AltBank” on any website. The Bank-hosted checkout opens in a secure panel on your own payment page and closes back to it — no redirect."
      toc={['How it works', 'Add the button', 'Events', 'Security', 'Slow networks and refreshes']}
    >
      <H2>How it works</H2>
      <EmbedFlow />
      <div className="my-6">
        <BnplButtonPreview />
      </div>
      <H2>Add the button</H2>
      <P>Load the SDK from the Bank’s checkout origin, create the session on your server, then open the panel with the returned <code>checkout_url</code>.</P>
      <CodeBlock lang="javascript" title="Your payment page (HTML)" code={s.html} />
      <CodeBlock lang="bash" title="Your server" code={s.server} />
      <ParamTable
        caption="ArafCheckout.open(options)"
        params={[
          { name: 'checkoutUrl', type: 'string', required: true, description: 'The checkout_url from POST /checkout/sessions. Must be on the SDK’s own origin.' },
          { name: 'onClose', type: '({ reason }) => void', description: 'Panel closed: customer, escape, return, cancel, equity (customer must pay equity to you) or complete.' },
          { name: 'onComplete', type: '({ outcome, application_reference }) => void', description: 'SUBMITTED, DECLINED, CANCELLED, EXPIRED or DELIVERED. A hint for your UI only.' },
          { name: 'onEvent', type: '(event) => void', description: 'Every event, including araf:status { stage, label }.' },
        ]}
      />
      <H2>Events</H2>
      <SimpleTable
        head={['Event', 'When']}
        rows={[
          ['araf:ready', 'Checkout loaded inside your page'],
          ['araf:status', 'Progress changed (stage and customer-facing label, no personal or credit data)'],
          ['araf:complete', 'A terminal or milestone outcome was reached'],
          ['araf:close', 'The checkout asked to return the shopper to your page (reason: return, cancel, equity)'],
          ['araf:closed', 'The panel closed (sent by the SDK)'],
        ]}
      />
      <H2>Security</H2>
      <Callout tone="gold" title="Events are hints — never proof">
        Before fulfilling, confirm status with <code>GET /api/v1/orders/&#123;ref&#125;</code> or signed webhooks, and release goods only after <code>goods.release_authorized</code>.
      </Callout>
      <P>
        The checkout can only be framed by websites the Bank approved for your account (Content-Security-Policy <code>frame-ancestors</code>); any other site sees a blank frame. The iframe is sandboxed so it can never navigate or script your page, messages are only accepted from the checkout origin, and in production the customer session cookie is <code>SameSite=None; Secure; Partitioned</code> so it works inside your page without third-party tracking. Steps that need a provider page (Remita mandate, Mono bank connection) stay inside the panel in the sandbox; production adapters that a provider will not allow inside a frame open in a pop-up and return to the panel.
      </P>
      <H2>Slow networks and refreshes</H2>
      <SimpleTable
        head={['Situation', 'What happens']}
        rows={[
          ['Shopper double-clicks or your page retries session creation', 'Use your order reference as the Idempotency-Key: the same session is returned, never a second application.'],
          ['Connection drops while the customer submits a step', 'The checkout retries with the same idempotency key; if the first attempt succeeded the stored result is replayed, so nothing is applied twice.'],
          ['Retries are exhausted', 'The checkout re-reads the authoritative state from the Bank and tells the customer whether the step went through.'],
          ['Customer refreshes or closes the panel', 'Progress is saved server-side. Re-open the panel with the same checkout_url to continue; a new browser requires a one-time code.'],
          ['Customer goes offline', 'An offline notice is shown; the checkout re-reads the state when the connection returns.'],
        ]}
      />
    </DocPage>
  );
}
