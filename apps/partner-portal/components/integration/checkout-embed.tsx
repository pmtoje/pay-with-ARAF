'use client';

import { Alert, Badge, BnplButtonPreview, Card, CardHeader, CopyButton, EmbedFlow, embedSnippets } from '@araf/ui';
import type { Integration } from '@/lib/types';

function Code({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-subtle">{title}</span>
        <CopyButton value={code} />
      </div>
      <pre className="max-h-[22rem] overflow-auto bg-[#0f1115] p-4 text-xs leading-relaxed text-[#e6e6e6]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Self-service: how this partner puts "Buy Now Pay Later with AltBank" on any website. */
export function CheckoutEmbed({ data }: { data: Integration }) {
  const c = data.checkout;
  const s = embedSnippets(c.sdk_url, data.api_base_url);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Your shoppers never leave your website" description="The Bank’s secure checkout opens in a panel on your own payment page and closes back to it. Works on any website — plain HTML, WordPress, Shopify custom pages, React, mobile web." />
        <div className="space-y-5 px-5 pb-5">
          <EmbedFlow merchant={data.partner.name} />
          <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-lg border border-border p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Button preview — payment screen</p>
              <div className="mt-4 space-y-3 rounded-md border border-dashed border-border-strong bg-surface-2/40 p-4">
                <p className="text-sm font-medium text-fg">Choose how to pay</p>
                <div className="rounded-md border border-gold bg-gold-soft/40 p-3 text-sm">
                  <span className="font-semibold text-fg">{c.button_label}</span>
                  <span className="mt-0.5 block text-xs text-muted">Non-interest (Murabaha) financing by The Alternative Bank, subject to approval.</span>
                </div>
                <BnplButtonPreview />
              </div>
              <p className="mt-3 text-xs text-muted">The SDK renders this button with the standard label. Show the amount on your own button if you build it yourself, e.g. “{c.button_label} — ₦645,000”.</p>
            </div>
            <div className="rounded-lg border border-border p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Websites allowed to embed the checkout</p>
              <ul className="mt-3 space-y-2">
                {c.embed_origins.length ? (
                  c.embed_origins.map((o) => (
                    <li key={o} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                      <span className="font-mono">{o}</span>
                      <Badge tone="success">Approved</Badge>
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted">No approved websites yet.</li>
                )}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                The checkout refuses to load inside any other website. To add a site, ask your relationship manager — the Bank approves it under maker–checker.
              </p>
              <div className="mt-4 flex items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2 text-xs">
                <span className="truncate">
                  SDK <span className="font-mono">{c.sdk_url}</span>
                </span>
                <CopyButton value={c.sdk_url} />
              </div>
            </div>
          </div>
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Code title="Your website (any HTML page)" code={s.html} />
        <Code title="Your server" code={s.server} />
      </div>
      <Alert tone="gold" title="Before you ship goods">
        Panel events (closed, complete) only update your page. Always confirm status with <span className="font-mono">GET /api/v1/orders/&#123;ref&#125;</span> or signed webhooks, and release goods only after <span className="font-mono">goods.release_authorized</span>. Re-using your order reference as the Idempotency-Key means a refresh or double-click never creates two applications.
      </Alert>
    </div>
  );
}
