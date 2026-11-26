// Server-safe (no client-only imports): usable from server and client components.
import type { ReactNode } from 'react';

/** The standard merchant call to action rendered by /v1/araf.js. */
export const BNPL_BUTTON_LABEL = 'Buy Now Pay Later with AltBank';

/** Static preview of the SDK button (portals cannot load the merchant SDK). */
export function BnplButtonPreview({ label = BNPL_BUTTON_LABEL, className }: { label?: string; className?: string }) {
  return (
    <span role="img" aria-label={`Button preview: ${label}`} className={`inline-flex min-h-[48px] w-full max-w-sm items-center justify-center gap-2.5 rounded-[10px] bg-[#0c0c0d] px-5 text-[15px] font-semibold text-white ${className ?? ''}`}>
      <span aria-hidden="true" className="grid h-[22px] w-[22px] place-items-center rounded-md bg-[#b08a2e] text-[13px] font-extrabold text-[#0c0c0d]">
        A
      </span>
      {label}
    </span>
  );
}

/** How the embedded checkout keeps the shopper on the merchant's website. */
export function EmbedFlow({ merchant = 'Your website' }: { merchant?: string }) {
  const steps: Array<[string, ReactNode]> = [
    ['1', <>Shopper picks <strong>{BNPL_BUTTON_LABEL}</strong> on {merchant}’s payment screen.</>],
    ['2', <>{merchant}’s <strong>server</strong> creates a checkout session with its secret key.</>],
    ['3', <>The Bank’s secure checkout opens <strong>in a panel on {merchant}’s page</strong> — no redirect.</>],
    ['4', <>The shopper closes the panel and is still on {merchant}. {merchant} confirms the status <strong>server-side</strong>.</>],
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map(([n, t]) => (
        <li key={n} className="flex gap-3 rounded-md border border-border bg-surface-2/50 p-3 text-sm text-muted">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold-soft text-xs font-semibold text-gold-strong">{n}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

export function embedSnippets(sdkUrl: string, apiBase: string) {
  return {
    html: `<!-- 1. On your payment page -->
<script src="${sdkUrl}"></script>
<div id="altbank-bnpl"></div>
<script>
  ArafCheckout.button('#altbank-bnpl', {
    // Label: "${BNPL_BUTTON_LABEL}"
    onClick: async () => {
      // 2. Your SERVER creates the session (never put your secret key in the browser)
      const res = await fetch('/checkout/araf-session', { method: 'POST' });
      const { checkout_url } = await res.json();
      // 3. The Bank's checkout opens in a panel on THIS page — no redirect
      ArafCheckout.open({
        checkoutUrl: checkout_url,
        onClose: () => location.reload(), // 4. then re-read the order status from your server
      });
    },
  });
</script>`,
    server: `# Your server (secret key stays here)
curl -X POST ${apiBase}/checkout/sessions \\
  -H "Authorization: Bearer $ARAF_SECRET_KEY" \\
  -H "Idempotency-Key: order-<your order ref>" \\
  -H "Content-Type: application/json" \\
  -d '{ "merchant_order_reference": "<your order ref>", "currency": "NGN", "amount": 64500000,
        "items": [ ... ], "customer": { "email": "..." },
        "return_url": "https://your-site/orders/<ref>", "cancel_url": "https://your-site/cart" }'
# → { "checkout_url": "…/c/cs_test_…" }  pass checkout_url to ArafCheckout.open()`,
  };
}
