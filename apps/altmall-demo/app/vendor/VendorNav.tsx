import Link from 'next/link';
import { cn } from '@/lib/cn';
import { vendorLogout } from './actions';

export function VendorNav({ active }: { active: 'orders' | 'webhooks' }) {
  const tab = (on: boolean) =>
    cn('-mb-px inline-flex h-11 items-center border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', on ? 'border-mall text-fg' : 'border-transparent text-muted hover:text-fg');
  return (
    <div className="border-b border-border bg-surface">
      <div className="container-page flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pt-6">
        <div className="pb-3">
          <p className="eyebrow text-mall">AltMall back-office · demo</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Vendor fulfilment console</h1>
        </div>
        <div className="flex w-full items-end justify-between gap-4 sm:w-auto">
          <nav aria-label="Console" className="flex">
            <Link href="/vendor" className={tab(active === 'orders')} aria-current={active === 'orders' ? 'page' : undefined}>
              Orders
            </Link>
            <Link href="/vendor/webhooks" className={tab(active === 'webhooks')} aria-current={active === 'webhooks' ? 'page' : undefined}>
              Webhook log
            </Link>
          </nav>
          <form action={vendorLogout} className="pb-1">
            <button type="submit" className="inline-flex h-10 items-center rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
