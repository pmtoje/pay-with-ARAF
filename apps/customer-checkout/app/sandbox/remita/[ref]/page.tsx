import { RemitaSimulator } from './simulator';

export const metadata = { title: 'SANDBOX — Remita mandate simulator', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <RemitaSimulator reference={ref} />;
}
