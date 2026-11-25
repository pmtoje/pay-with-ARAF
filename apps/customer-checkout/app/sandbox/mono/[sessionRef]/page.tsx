import { MonoSimulator } from './simulator';

export const metadata = { title: 'SANDBOX — Mono Connect simulator', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ sessionRef: string }> }) {
  const { sessionRef } = await params;
  return <MonoSimulator sessionRef={sessionRef} />;
}
