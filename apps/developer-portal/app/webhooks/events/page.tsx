import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock } from '@/components/code';
import { Callout, DocPage, H2, P } from '@/components/doc';
import { EVENT_NOTES, exampleEvent, json } from '@/lib/examples';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/lib/reference';

export const metadata: Metadata = { title: 'Event catalogue' };

const GROUP_TITLES: Record<string, string> = {
  application: 'Application events',
  financing: 'Financing events',
  vendor: 'Vendor payment events',
  goods: 'Goods release & fulfilment events',
  order: 'Order events',
  refund: 'Refund events',
};

export default function Events() {
  const types = Object.keys(WEBHOOK_EVENT_TYPES) as WebhookEventType[];
  const groups = [...new Set(types.map((t) => t.split('.')[0]))];
  return (
    <DocPage
      path="/webhooks/events"
      eyebrow="Webhooks"
      title="Event catalogue"
      lede={`All ${types.length} event types, with the exact data fields each one carries. Every event uses the same envelope; examples are from the sandbox (livemode: false).`}
      toc={groups.map((g) => GROUP_TITLES[g] ?? g)}
      wide
    >
      <Callout tone="danger" title="Only goods.release_authorized permits release — after verification">
        <code>financing.approved</code>, <code>financing.booked</code> and <code>vendor.payment_confirmed</code> are progress notifications. Hand over goods only after <code>goods.release_authorized</code> <strong>and</strong> a successful <Link href="/releases">GET /api/v1/releases/{'{reference}'}</Link>.
      </Callout>
      <nav aria-label="Event index" className="my-6 rounded-lg border border-border bg-surface p-4">
        <ul className="!list-none !pl-0 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((t) => (
            <li key={t}>
              <a href={`#${t.replace('.', '-')}`} className="font-mono text-[13px]">
                {t}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map((g) => (
        <section key={g}>
          <H2>{GROUP_TITLES[g] ?? g}</H2>
          {types
            .filter((t) => t.startsWith(`${g}.`))
            .map((t) => (
              <article key={t} id={t.replace('.', '-')} className="scroll-mt-24 border-b border-border py-6 last:border-0">
                <h3 className="font-mono text-lg font-semibold text-fg">{t}</h3>
                <P>{WEBHOOK_EVENT_TYPES[t]}</P>
                {EVENT_NOTES[t] && <p className="my-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg/85">{EVENT_NOTES[t]}</p>}
                <CodeBlock lang="json" title={`${t} · example payload`} code={json(exampleEvent(t))} />
              </article>
            ))}
        </section>
      ))}
    </DocPage>
  );
}
