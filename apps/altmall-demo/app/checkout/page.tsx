import type { Metadata } from 'next';
import { requireCustomer } from '@/lib/auth';
import { CheckoutForm } from './CheckoutForm';

export const metadata: Metadata = { title: 'Checkout' };
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const customer = await requireCustomer('/checkout');
  const localPhone = customer.phone?.startsWith('+234') ? `0${customer.phone.slice(4)}` : customer.phone ?? '';
  return (
    <div className="container-page py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-fg">Checkout</h1>
      <p className="mt-1 text-sm text-muted">Signed in as {customer.email}</p>
      <CheckoutForm defaults={{ name: customer.name, phone: localPhone }} />
    </div>
  );
}
