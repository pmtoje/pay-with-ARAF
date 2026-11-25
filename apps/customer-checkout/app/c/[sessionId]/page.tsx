import type { Metadata } from 'next';
import { CheckoutApp } from '@/components/checkout/CheckoutApp';

export const metadata: Metadata = { title: 'Pay with ARAF — Secure checkout', referrer: 'no-referrer' };

export default async function CheckoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CheckoutApp sessionId={sessionId} />;
}
