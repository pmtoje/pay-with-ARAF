import type { Metadata } from 'next';
import { CheckoutApp } from '@/components/checkout/CheckoutApp';

export const metadata: Metadata = { title: 'Pay with ARAF — Confirming your account', referrer: 'no-referrer' };

export default async function AccountOpeningReturn({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const state = typeof sp.state === 'string' ? sp.state : null;
  return <CheckoutApp sessionId={sessionId} returnAction={{ kind: 'account-opening', state }} />;
}
