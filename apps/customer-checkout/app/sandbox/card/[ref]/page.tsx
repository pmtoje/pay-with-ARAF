import { CardSimulator } from './simulator';

export const metadata = { title: 'SANDBOX — Paystack card simulator', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <CardSimulator reference={decodeURIComponent(ref)} />;
}
