import type { Metadata } from 'next';
import { DocPage, H2 } from '@/components/doc';

export const metadata: Metadata = { title: 'Changelog' };

const ENTRIES: Array<{ date: string; version: string; items: string[] }> = [
  {
    date: '25 November 2026',
    version: 'API v1 · webhook schema 1.0 (sandbox)',
    items: [
      'Partner API v1 available in the sandbox: checkout sessions, applications, orders, releases, fulfilment, cancellations, returns, settlements and webhook events.',
      '21 webhook event types with ARAF-Signature (HMAC-SHA256, t/v1 scheme), at-least-once delivery, exponential backoff with jitter, dead-lettering after 8 attempts and manual retry.',
      'Scoped secret keys with optional IP allowlists, expiry and 24-hour rotation overlap; webhook secret rotation with dual signatures for 24 hours.',
      'Idempotency-Key required on checkout session creation; Idempotent-Replayed response header on replays.',
      'Revised carts via revises_session_id.',
      'Developer portal with API explorer (sandbox) and in-browser webhook signature verifier.',
    ],
  },
];

export default function Changelog() {
  return (
    <DocPage path="/changelog" eyebrow="More" title="Changelog" lede="Changes to the partner API, webhooks and developer tools. Breaking changes will be announced in advance and versioned.">
      {ENTRIES.map((e) => (
        <section key={e.date}>
          <H2>{e.date}</H2>
          <p className="text-sm font-medium text-gold-strong">{e.version}</p>
          <ul className="mt-3">
            {e.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      ))}
    </DocPage>
  );
}
