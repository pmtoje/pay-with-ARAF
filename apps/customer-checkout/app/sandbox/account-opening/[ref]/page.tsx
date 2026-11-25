import { AccountOpeningSimulator } from './simulator';

export const metadata = { title: 'SANDBOX — Account opening simulator', robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <AccountOpeningSimulator reference={ref} />;
}
