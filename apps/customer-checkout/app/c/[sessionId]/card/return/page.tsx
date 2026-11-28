import type { Metadata } from 'next';
import { CheckoutApp } from '@/components/checkout/CheckoutApp';

export const metadata: Metadata = { title: 'Pay with ARAF — Confirming your card', referrer: 'no-referrer' };

export default async function CardReturn({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const reference = typeof sp.reference === 'string' && /^[a-z0-9-]{8,120}$/.test(sp.reference) ? sp.reference : null;
  return <CheckoutApp sessionId={sessionId} returnAction={{ kind: 'card', reference }} />;
}
