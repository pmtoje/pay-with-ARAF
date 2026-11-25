import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { isVendor } from '@/lib/auth';
import { VendorLoginForm } from './VendorLoginForm';

export const metadata: Metadata = { title: 'Vendor console sign-in' };
export const dynamic = 'force-dynamic';

export default async function VendorLoginPage() {
  if (await isVendor()) redirect('/vendor');
  return (
    <div className="container-page grid max-w-4xl gap-10 py-12 md:grid-cols-[1fr_300px]">
      <div className="max-w-md">
        <p className="eyebrow text-mall">AltMall back-office</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Vendor fulfilment console</h1>
        <p className="mt-2 text-muted">Dispatch and deliver Pay with ARAF orders — only once The Alternative Bank has paid the vendor and authorised release.</p>
        <div className="mt-8">
          <VendorLoginForm />
        </div>
      </div>
      <aside className="h-fit rounded-lg border border-dashed border-warning/50 bg-warning-soft/40 p-5">
        <p className="eyebrow text-warning">Sandbox demo credential</p>
        <p className="mt-2 text-sm text-muted">Demo back-office password:</p>
        <p className="mt-1 font-mono text-[13px] text-fg">Vendor-Demo-2026!</p>
      </aside>
    </div>
  );
}
