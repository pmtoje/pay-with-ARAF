'use client';

import Link from 'next/link';
import { useCart } from './cart';

export function HeaderCart() {
  const { count, ready } = useCart();
  return (
    <Link
      href="/cart"
      className="relative inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      aria-label={ready ? `Basket, ${count} item${count === 1 ? '' : 's'}` : 'Basket'}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M5 8h14l-1.2 11.1a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4z" strokeLinejoin="round" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" strokeLinecap="round" />
      </svg>
      <span className="hidden sm:inline">Basket</span>
      {ready && count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-mall px-1.5 text-2xs font-semibold tabular-nums text-mall-contrast" aria-hidden="true">
          {count}
        </span>
      )}
    </Link>
  );
}
