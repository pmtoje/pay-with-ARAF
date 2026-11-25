import type { Metadata } from 'next';
import { CheckoutApp } from '@/components/checkout/CheckoutApp';

export const metadata: Metadata = { title: 'Pay with ARAF — Confirming your mandate', referrer: 'no-referrer' };

export default async function MandateReturn({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CheckoutApp sessionId={sessionId} returnAction={{ kind: 'mandate' }} />;
}
