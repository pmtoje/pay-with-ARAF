import type { Metadata } from 'next';
import { CheckoutApp } from '@/components/checkout/CheckoutApp';

export const metadata: Metadata = { title: 'Pay with ARAF — Connecting your bank', referrer: 'no-referrer' };

export default async function MonoReturn({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const code = typeof sp.code === 'string' ? sp.code : null;
  const error = typeof sp.error === 'string' ? sp.error : null;
  return <CheckoutApp sessionId={sessionId} returnAction={{ kind: 'mono', code, error }} />;
}
