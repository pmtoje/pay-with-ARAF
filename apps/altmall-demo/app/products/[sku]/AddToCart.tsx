'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@araf/ui';
import { MAX_QTY, PRODUCT_BY_SKU, VENDORS } from '@/lib/catalogue';
import { useCart } from '@/components/cart';

export function QtyStepper({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const btn = 'inline-flex h-11 w-11 items-center justify-center text-lg text-fg hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-md';
  return (
    <div role="group" aria-label={label} className="inline-flex items-center rounded-md border border-border-strong bg-surface">
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Decrease quantity">
        −
      </button>
      <span className="w-10 text-center text-sm font-medium tabular-nums" aria-live="polite" aria-label={`Quantity ${value}`}>
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= MAX_QTY} aria-label="Increase quantity">
        +
      </button>
    </div>
  );
}

export function AddToCart({ sku, vendorName }: { sku: string; vendorName: string }) {
  const cart = useCart();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const product = PRODUCT_BY_SKU[sku];
  const otherVendors = cart.vendors.filter((v) => v !== product.vendorReference);

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <QtyStepper value={qty} onChange={(v) => setQty(Math.max(1, Math.min(MAX_QTY, v)))} label="Quantity" />
        <Button
          size="lg"
          className="flex-1 sm:flex-none sm:px-10"
          onClick={() => {
            cart.add(sku, qty);
            setAdded(true);
          }}
          disabled={!cart.ready}
        >
          Add to basket
        </Button>
      </div>
      <div aria-live="polite" className="min-h-[1.25rem]">
        {added && (
          <p className="text-sm text-success">
            Added to your basket.{' '}
            <Link href="/cart" className="link">
              View basket
            </Link>
          </p>
        )}
        {added && otherVendors.length > 0 && (
          <p className="mt-1 text-sm text-warning">
            Your basket now has items from {otherVendors.length + 1} vendors ({[...otherVendors.map((v) => VENDORS[v].name), vendorName].join(', ')}). Pay with ARAF can finance one vendor per order.
          </p>
        )}
      </div>
    </div>
  );
}
