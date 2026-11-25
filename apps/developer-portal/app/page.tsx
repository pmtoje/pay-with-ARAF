import Link from 'next/link';
import { CodeTabs } from '@/components/code';
import { Callout, DocPage, H2, P, Steps } from '@/components/doc';
import { CREATE_SESSION_TABS } from '@/lib/snippets';

const STAGES = [
  { label: 'Eligible', note: 'Indicative only' },
  { label: 'Submitted', note: 'Not approved' },
  { label: 'Approved', note: 'Not paid' },
  { label: 'Vendor paid', note: 'Not released' },
  { label: 'Release authorised', note: 'Hand over goods', final: true },
];

export default function Overview() {
  return (
    <DocPage
      path="/"
      eyebrow="Pay with ARAF · API v1"
      title="Embedded Murabaha financing for your checkout"
      lede="Pay with ARAF lets your customers buy now and pay over time with non-interest (Murabaha) asset financing from The Alternative Bank. You create a checkout session on your server, redirect the customer, and fulfil the order only when the Bank authorises goods release."
      toc={['How it works', 'Quickstart', 'Key principles', 'Where to next']}
    >
      <div className="not-prose my-8 grid gap-3 sm:grid-cols-3">
        {[
          { href: '/checkout-sessions', t: 'Create a checkout session', d: 'POST /api/v1/checkout/sessions' },
          { href: '/webhooks', t: 'Receive webhooks', d: 'Signed, at-least-once events' },
          { href: '/releases', t: 'Verify goods release', d: 'GET /api/v1/releases/{reference}' },
        ].map((c) => (
          <Link key={c.href} href={c.href} className="no-underline group rounded-lg border border-border bg-surface px-4 py-4 transition-colors hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <span className="block font-semibold text-fg group-hover:text-gold-strong">{c.t} →</span>
            <span className="mt-1 block font-mono text-xs text-muted">{c.d}</span>
          </Link>
        ))}
      </div>

      <H2>How it works</H2>
      <Steps
        items={[
          { title: 'Create a checkout session (server-side)', body: <>When the customer chooses “Pay with ARAF”, your server calls <code>POST /api/v1/checkout/sessions</code> with the cart (integer kobo), an <code>Idempotency-Key</code>, and approved return/cancel URLs. You receive a <code>checkout_url</code> and an <code>application_reference</code>.</> },
          { title: 'Redirect the customer', body: <>Send the customer to <code>checkout_url</code>. The Bank’s hosted checkout handles identity, eligibility, the offer, documents and the repayment mandate. You never see BVNs, credit scores or statements.</> },
          { title: 'Listen for webhooks', body: <>Your endpoint receives signed events as the application progresses — <code>application.*</code>, <code>financing.*</code>, <code>vendor.*</code>, <code>goods.*</code>. Treat them as notifications and confirm state through the API.</> },
          { title: 'Verify the release authorisation', body: <>When you receive <code>goods.release_authorized</code>, call <code>GET /api/v1/releases/{'{reference}'}</code>. Only <code>release_authorized: true</code> with <code>status: &quot;AUTHORIZED&quot;</code> permits you to hand over the goods.</> },
          { title: 'Fulfil and confirm delivery', body: <>Record dispatch or collection with <code>POST /orders/{'{ref}'}/fulfil</code>, then confirm delivery with <code>POST /orders/{'{ref}'}/deliver</code>. The Bank pays the vendor directly; see <Link href="/settlements">Settlements</Link>.</> },
        ]}
      />
      <Callout tone="danger" title="Release goods only on a verified release authorisation">
        A customer redirect, screenshot, email, <code>financing.approved</code> or even <code>vendor.payment_confirmed</code> is <strong>not</strong> proof that you may release goods. The only acceptable proof is <code>GET /api/v1/releases/{'{reference}'}</code> returning <code>release_authorized: true</code>.
      </Callout>
      <div className="my-6 overflow-x-auto">
        <ol className="!list-none !pl-0 flex min-w-[36rem] items-stretch gap-2" aria-label="Financing stages">
          {STAGES.map((s) => (
            <li key={s.label} className={`flex-1 rounded-md border px-3 py-2.5 ${s.final ? 'border-success bg-success-soft' : 'border-border bg-surface'}`}>
              <span className={`block text-sm font-semibold ${s.final ? 'text-success' : 'text-fg'}`}>{s.label}</span>
              <span className="block text-xs text-muted">{s.note}</span>
            </li>
          ))}
        </ol>
      </div>

      <H2>Quickstart</H2>
      <P>
        Get a sandbox secret key (<code>sk_test_…</code>) from <strong>Partner portal → Integration → API keys</strong>, then create your first session. Amounts are integer kobo: ₦450,000.00 is <code>45000000</code>.
      </P>
      <CodeTabs tabs={CREATE_SESSION_TABS} />
      <P>
        Try it without writing code in the <Link href="/explorer">API explorer</Link>, and use the <Link href="/sandbox">sandbox test identities</Link> to drive the customer journey to any outcome.
      </P>

      <H2>Key principles</H2>
      <ul>
        <li>
          <strong>Server-side only.</strong> Secret keys never go into browsers or mobile apps. Create sessions from your backend with amounts from your own database.
        </li>
        <li>
          <strong>Money is integer kobo.</strong> <code>amount</code> must equal the sum of <code>unit_amount × quantity</code>; the API recomputes it and rejects mismatches.
        </li>
        <li>
          <strong>Idempotent writes.</strong> <code>POST /checkout/sessions</code> requires an <code>Idempotency-Key</code>; retries with the same key return the original response.
        </li>
        <li>
          <strong>Events are at-least-once.</strong> De-duplicate by <code>event_id</code> and use <code>resource_version</code> to ignore stale updates.
        </li>
        <li>
          <strong>Privacy by design.</strong> Merchants receive operational statuses only — never BVNs, credit scores, statements, salary, affordability or decline reasons.
        </li>
      </ul>

      <H2>Where to next</H2>
      <ul>
        <li>
          <Link href="/environments">Sandbox &amp; production</Link> — keys, base URLs and go-live.
        </li>
        <li>
          <Link href="/authentication">Authentication</Link> — scopes, IP allowlists and rotation.
        </li>
        <li>
          <Link href="/webhooks/events">Event catalogue</Link> — every event with an example payload.
        </li>
        <li>
          <Link href="/errors">Errors &amp; idempotency</Link> — the full error catalogue.
        </li>
      </ul>
    </DocPage>
  );
}
