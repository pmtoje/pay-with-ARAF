import type { Metadata } from 'next';
import { CartView } from './CartView';

export const metadata: Metadata = { title: 'Your basket' };

export default async function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const cancelled = sp.araf === 'cancelled';
  const order = typeof sp.order === 'string' && /^ALTMALL-ORD-\d{6,}$/.test(sp.order) ? sp.order : null;
  return (
    <div className="container-page py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">Your basket</h1>
      <CartView cancelledOrder={cancelled ? order ?? '' : null} />
    </div>
  );
}
