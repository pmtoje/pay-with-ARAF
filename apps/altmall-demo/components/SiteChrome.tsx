import Link from 'next/link';
import { ThemeToggle } from '@araf/ui';
import { currentCustomer } from '@/lib/auth';
import { CATEGORIES } from '@/lib/catalogue';
import { logout } from '@/app/actions/auth';
import { HomeLink, PayWithArafMark } from './brand';
import { HeaderCart } from './HeaderCart';

const navLink = 'inline-flex h-11 items-center whitespace-nowrap rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export async function SiteHeader() {
  const customer = await currentCustomer();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="container-page flex h-16 items-center gap-2">
        <HomeLink />
        <nav aria-label="Departments" className="ml-6 hidden items-center lg:flex">
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={`/category/${c.slug}`} className={navLink}>
              {c.name}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          {customer ? (
            <>
              <Link href="/orders" className={navLink}>
                <span className="hidden sm:inline">My orders</span>
                <span className="sm:hidden">Orders</span>
              </Link>
              <form action={logout} className="hidden sm:block">
                <button type="submit" className={navLink} title={`Signed in as ${customer.email}`}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className={navLink}>
              Sign in
            </Link>
          )}
          <HeaderCart />
          <ThemeToggle className="h-11 w-11" />
        </div>
      </div>
      <nav aria-label="Departments" className="border-t border-border lg:hidden">
        <div className="container-page flex gap-1 overflow-x-auto py-1 [scrollbar-width:none]">
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={`/category/${c.slug}`} className={navLink}>
              {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-surface">
      <div className="container-page grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-md space-y-3">
          <HomeLink />
          <p className="text-sm leading-relaxed text-muted">
            AltMall is a <strong className="font-medium text-fg">demonstration store</strong>. It integrates Pay with ARAF exactly as any external merchant would — through the public partner API (<code className="font-mono text-xs">/api/v1</code>) with a secret key held on the server, and a signed-webhook receiver. Products, prices and vendors are fictional; no real money moves and no goods ship.
          </p>
        </div>
        <div>
          <p className="eyebrow text-subtle">Shop</p>
          <ul className="mt-3 space-y-2 text-sm">
            {CATEGORIES.map((c) => (
              <li key={c.slug}>
                <Link href={`/category/${c.slug}`} className="text-muted hover:text-fg">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <p className="eyebrow text-subtle">Payments</p>
          <PayWithArafMark size="sm" />
          <p className="text-sm text-muted">Non-interest (Murabaha) financing by The Alternative Bank, subject to eligibility.</p>
          <ul className="space-y-2 pt-2 text-sm">
            <li>
              <Link href="/orders" className="text-muted hover:text-fg">
                Track an order
              </Link>
            </li>
            <li>
              <Link href="/vendor" className="text-muted hover:text-fg">
                Vendor fulfilment console (demo)
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="container-page py-4 text-xs text-subtle">© 2026 AltMall demo store · Sandbox build · Product illustrations drawn in-house</p>
      </div>
    </footer>
  );
}
