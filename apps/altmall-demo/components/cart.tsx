'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MAX_QTY, PRODUCT_BY_SKU, type Product } from '@/lib/catalogue';

export interface CartLine {
  sku: string;
  qty: number;
}

interface CartCtx {
  ready: boolean;
  lines: CartLine[];
  detailed: Array<{ product: Product; qty: number; lineKobo: number }>;
  count: number;
  subtotalKobo: number;
  vendors: string[];
  add: (sku: string, qty?: number) => void;
  setQty: (sku: string, qty: number) => void;
  remove: (sku: string) => void;
  keepOnlyVendor: (vendorReference: string) => void;
  clear: () => void;
}

const KEY = 'altmall-cart-v1';
const Ctx = createContext<CartCtx | null>(null);

function sanitize(v: unknown): CartLine[] {
  if (!Array.isArray(v)) return [];
  const out: CartLine[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const { sku, qty } = x as Record<string, unknown>;
    if (typeof sku !== 'string' || !PRODUCT_BY_SKU[sku]) continue;
    const q = Math.max(1, Math.min(MAX_QTY, Math.trunc(Number(qty)) || 1));
    if (!out.some((l) => l.sku === sku)) out.push({ sku, qty: q });
  }
  return out;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setLines(sanitize(JSON.parse(localStorage.getItem(KEY) ?? '[]')));
    } catch {
      setLines([]);
    }
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        try {
          setLines(sanitize(JSON.parse(e.newValue ?? '[]')));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — cart lives for this page only */
    }
  }, []);

  const value = useMemo<CartCtx>(() => {
    const detailed = lines.map((l) => {
      const product = PRODUCT_BY_SKU[l.sku];
      return { product, qty: l.qty, lineKobo: product.priceKobo * l.qty };
    });
    return {
      ready,
      lines,
      detailed,
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotalKobo: detailed.reduce((s, d) => s + d.lineKobo, 0),
      vendors: [...new Set(detailed.map((d) => d.product.vendorReference))],
      add: (sku, qty = 1) => {
        const existing = lines.find((l) => l.sku === sku);
        persist(existing ? lines.map((l) => (l.sku === sku ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l)) : [...lines, { sku, qty: Math.min(MAX_QTY, qty) }]);
      },
      setQty: (sku, qty) => persist(lines.map((l) => (l.sku === sku ? { ...l, qty: Math.max(1, Math.min(MAX_QTY, qty)) } : l))),
      remove: (sku) => persist(lines.filter((l) => l.sku !== sku)),
      keepOnlyVendor: (v) => persist(lines.filter((l) => PRODUCT_BY_SKU[l.sku].vendorReference === v)),
      clear: () => persist([]),
    };
  }, [lines, ready, persist]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}
