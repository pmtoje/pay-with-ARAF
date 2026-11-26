import type { Metadata } from 'next';
import { BnplButtonPreview, Logo } from '@araf/ui';

export const metadata: Metadata = {
  title: 'Pay with ARAF — Buy Now Pay Later with AltBank',
  description: 'Non-interest (Murabaha) Buy Now Pay Later from The Alternative Bank, at the checkout of participating stores.',
};

const DEVELOPERS = process.env.NEXT_PUBLIC_DEVELOPER_PORTAL_URL ?? 'http://localhost:3004';
const PARTNERS = process.env.NEXT_PUBLIC_PARTNER_PORTAL_URL ?? 'http://localhost:3002';
const SITE = (process.env.NEXT_PUBLIC_CHECKOUT_URL ?? 'https://www.araf.ng').replace(/^https?:\/\//, '').replace(/\/$/, '');

const STEPS: Array<[string, string]> = [
  ['Choose “Buy Now Pay Later with AltBank”', 'At the payment step of a participating store. You stay on the store’s website.'],
  ['Verify and check eligibility', 'Your BVN, a one-time code and a bank statement. An indicative offer in minutes; the Bank confirms final approval. No cash is lent to you.'],
  ['See your exact price', 'Pay part upfront as equity if you like. The profit is fixed and disclosed before you accept.'],
  ['The Bank buys, you receive', 'The Bank pays the store, sells the item to you, and the store delivers. You repay monthly.'],
];

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="ml-auto flex items-center gap-1 text-sm">
            <a href="#how" className="hidden rounded-md px-3 py-2 text-muted hover:text-fg sm:inline-block">How it works</a>
            <a href="#merchants" className="hidden rounded-md px-3 py-2 text-muted hover:text-fg sm:inline-block">For merchants</a>
            <a href={PARTNERS} className="rounded-md border border-border-strong px-3 py-2 font-medium text-fg hover:bg-surface-2">Merchant sign in</a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="border-b border-border bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_1fr] lg:py-20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">The Alternative Bank · Pay with ARAF</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">Buy Now Pay Later with AltBank</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
                Non-interest (Murabaha) financing right at the checkout of the stores you already use. The Bank buys the item and sells it to you at a fixed, disclosed price, repaid monthly for up to 24 months.
              </p>
              <ul className="mt-6 grid max-w-xl gap-2 text-sm text-fg sm:grid-cols-2">
                {['No interest — a disclosed profit, fixed when you accept', 'Pay some equity upfront to lower what you finance', 'You never leave the store’s website', 'We never ask for your PIN or banking password'].map((t) => (
                  <li key={t} className="flex gap-2">
                    <span aria-hidden="true" className="mt-0.5 text-gold-strong">✓</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-bg p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Look for this at checkout</p>
              <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface p-4">
                <p className="text-sm font-medium text-fg">Choose how to pay</p>
                <div className="rounded-md border border-gold bg-gold-soft/40 p-3 text-sm">
                  <span className="font-semibold text-fg">Buy Now Pay Later with AltBank</span>
                  <span className="mt-0.5 block text-xs text-muted">Subject to approval by The Alternative Bank.</span>
                </div>
                <BnplButtonPreview />
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                The Bank’s secure checkout opens in a panel on the store’s page. If you are ever sent to a page, check the address is <span className="font-mono text-fg">{SITE}</span>.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-fg">How it works</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-lg border border-border bg-surface p-5">
                <span className="text-xs font-semibold text-gold-strong">0{i + 1}</span>
                <p className="mt-1 font-semibold text-fg">{t}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted">
            Already applied? Use the secure link the store gave you, or re-open Pay with ARAF from your order on the store’s website. Your progress is saved — you’ll confirm it’s you with a one-time code.
          </p>
        </section>

        <section id="merchants" className="border-t border-border bg-surface">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-fg">For merchants</h2>
              <p className="mt-3 text-base leading-relaxed text-muted">
                Offer Buy Now Pay Later on any website with one script and a server call. Your shoppers never leave your site, the Bank pays your vendor directly, and you release goods only when the Bank authorises it.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={DEVELOPERS} className="inline-flex h-11 items-center rounded-md bg-ink px-5 text-sm font-medium text-ink-contrast hover:opacity-90">Read the developer docs</a>
                <a href={PARTNERS} className="inline-flex h-11 items-center rounded-md border border-border-strong px-5 text-sm font-medium text-fg hover:bg-surface-2">Partner portal</a>
              </div>
            </div>
            <pre className="overflow-auto rounded-lg bg-[#0f1115] p-5 text-xs leading-relaxed text-[#e6e6e6]">
              <code>{`<script src="https://${SITE}/v1/araf.js"></script>
<div id="altbank-bnpl"></div>
<script>
  ArafCheckout.button('#altbank-bnpl', {
    onClick: async () => {
      const { checkout_url } = await createSessionOnYourServer();
      ArafCheckout.open({ checkoutUrl: checkout_url });
    },
  });
</script>`}</code>
            </pre>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-subtle sm:px-6">
          <span>Pay with ARAF is provided by The Alternative Bank. Financing is subject to eligibility and approval.</span>
          <span>We will never ask for your card PIN, OTP by phone, or internet-banking password.</span>
        </div>
      </footer>
    </div>
  );
}
