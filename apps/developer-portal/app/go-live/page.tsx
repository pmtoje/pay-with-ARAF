import type { Metadata } from 'next';
import Link from 'next/link';
import { Callout, DocPage, H2, P } from '@/components/doc';

export const metadata: Metadata = { title: 'Production checklist' };

const CHECKLIST: Array<{ title: string; items: string[] }> = [
  {
    title: 'Integration',
    items: [
      'Checkout sessions are created only from your server, with amounts loaded from your own database (integer kobo).',
      'Every POST /checkout/sessions sends a unique Idempotency-Key per logical attempt and reuses it on retry.',
      'DUPLICATE_CHECKOUT, CART_INVALID, VENDOR_NOT_ELIGIBLE and RETURN_URL_NOT_APPROVED are handled with clear customer messaging.',
      'Your return page reads the application status from the API; it never treats the redirect as a payment.',
      'Revised carts use revises_session_id.',
    ],
  },
  {
    title: 'Goods release',
    items: [
      'Goods are released only after GET /api/v1/releases/{reference} returns release_authorized: true for the expected order and items.',
      'goods.release_suspended immediately stops picking, packing and dispatch.',
      'Dispatch, collection and delivery are recorded through the API or the Partner portal.',
    ],
  },
  {
    title: 'Webhooks',
    items: [
      'Signatures are verified on the raw body with a 300-second tolerance and constant-time comparison, accepting any v1 (rotation).',
      'Events are de-duplicated by event_id and stale ones ignored by resource_version.',
      'Your endpoint responds 2xx within 10 seconds and processes asynchronously.',
      'You alert on delivery failures and reconcile with GET /webhook-events after outages.',
      'livemode is checked and test events are ignored by business logic.',
    ],
  },
  {
    title: 'Security & operations',
    items: [
      'sk_live_ keys are stored in a secret manager, never in frontend code or source control.',
      'Production keys carry only the scopes they need and an IP allowlist of your egress addresses.',
      'You have a key and webhook-secret rotation procedure (24-hour overlap) and know how to revoke.',
      'Production webhook endpoints are public HTTPS URLs without redirects.',
      'Return/cancel URL origins for production are registered with the Bank (HTTPS only).',
      'Staff accounts in the Partner portal use least-privilege roles; leavers are suspended promptly.',
      'Logs capture correlation IDs (X-Correlation-Id) but never secret keys or customer personal data.',
    ],
  },
];

export default function GoLive() {
  return (
    <DocPage path="/go-live" eyebrow="Reference" title="Production checklist" lede="Production access is granted by The Alternative Bank after review. Use this checklist before requesting go-live." toc={[...CHECKLIST.map((c) => c.title), 'Requesting production']}>
      <Callout tone="warning" title="Production is locked until the Bank approves it">
        Until your partner account reaches production status and the Bank enables live operations, production key creation fails with <code>PRODUCTION_LOCKED</code> and <code>sk_live_</code> keys cannot be used.
      </Callout>
      {CHECKLIST.map((c) => (
        <section key={c.title}>
          <H2>{c.title}</H2>
          <ul className="!list-none !pl-0 space-y-2">
            {c.items.map((i) => (
              <li key={i} className="flex gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
                <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-strong text-xs text-subtle" />
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <H2>Requesting production</H2>
      <P>
        Demonstrate a full sandbox run (checkout → webhook → release verification → dispatch → delivery) to your Bank integration contact, then ask them to submit your production request. The Bank’s onboarding and approval teams review it under maker-checker controls. You will be told when production keys can be created in the Partner portal. See also <Link href="/support">Support</Link>.
      </P>
    </DocPage>
  );
}
