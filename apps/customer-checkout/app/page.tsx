import { Logo } from '@araf/ui';

export default function Page() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4 sm:px-6">
          <Logo />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">Secure checkout</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Pay with ARAF</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
          Non-interest (Murabaha) financing from The Alternative Bank, offered at the checkout of participating merchants. The Bank buys the item you choose and sells it to you at a disclosed profit markup, repaid in fixed monthly instalments.
        </p>
        <div className="mt-8 rounded-lg border border-border bg-surface p-6">
          <h2 className="text-base font-semibold text-fg">How to get here</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This page is reached from a merchant’s checkout. Add items to your cart at a participating store and choose <span className="font-medium text-fg">Pay with ARAF</span> as your payment method — you’ll be brought to a secure checkout link made just for your order.
          </p>
          <ol className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
            {[
              ['Verify', 'Confirm your identity with your BVN and a one-time code.'],
              ['Get an offer', 'Share a bank statement and see an indicative offer in minutes.'],
              ['Track', 'Follow approval, purchase and delivery in one place.'],
            ].map(([t, d], i) => (
              <li key={t} className="rounded-md bg-surface-2 p-4">
                <span className="text-xs font-semibold text-gold-strong">0{i + 1}</span>
                <p className="mt-1 font-medium text-fg">{t}</p>
                <p className="mt-1 text-muted">{d}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-6 text-xs text-subtle">We never ask for your card PIN or internet-banking password.</p>
      </main>
    </div>
  );
}
