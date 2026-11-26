'use client';

import { useState } from 'react';
import { Alert, Badge, Button, DataTable, Field, Input, Select, formatDateTime, formatNaira } from '@araf/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ErrorAlert, Mono, Section, useToast } from '@/components/common';

interface Fees {
  rate_percent: number;
  basis: string;
  uninvoiced: { count: number; total: number; items: Array<{ application_reference: string | null; kind: string; purchase_amount: number; rate_percent: number; fee: number; reason: string | null; accrued_at: string }> };
  invoices: Array<{ id: string; reference: string; period: string; fee_count: number; total: number; status: string; issued_at: string; paid_at: string | null; payment_reference: string | null }>;
}

const months = () => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

/** ARAF's merchant fee for one partner: accrued per processed transaction, invoiced monthly. */
export function PartnerFees({ partnerId, source = 'partner' }: { partnerId: string; source?: 'partner' | 'finance' }) {
  const { can } = useSession();
  const state = useApi<Fees>(source === 'finance' ? `/api/admin/fees/partners/${partnerId}` : `/api/admin/partners/${partnerId}/fees`);
  const [period, setPeriod] = useState(months()[0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [payRef, setPayRef] = useState<Record<string, string>>({});
  const toast = useToast();
  const f = state.data;
  const manage = can('fee.manage');
  const issue = async () => {
    setBusy('issue');
    setError(null);
    try {
      const r = await api.post<{ reference: string; total: number }>(`/api/admin/partners/${partnerId}/invoices`, { period });
      toast(`Invoice ${r.reference} issued — ${formatNaira(r.total)}`);
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const paid = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api.post(`/api/admin/invoices/${id}/paid`, { payment_reference: payRef[id] ?? '' });
      toast('Payment recorded');
      state.reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  if (!f) return <Section title="ARAF fees"><p className="text-sm text-muted">Loading…</p></Section>;
  return (
    <div className="space-y-6">
      <Section title={`ARAF fee — ${f.rate_percent}% per transaction`} description={f.basis}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Not yet invoiced</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gold-strong">{formatNaira(f.uninvoiced.total)}</p>
            <p className="text-xs text-muted">{f.uninvoiced.count} transaction{f.uninvoiced.count === 1 ? '' : 's'}</p>
          </div>
          <div className="rounded-md border border-border p-4 sm:col-span-2">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Issue the monthly invoice</p>
            {manage ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <Field label="Month" className="w-40">
                  {(ids) => <Select id={ids.id} value={period} onChange={(e) => setPeriod(e.target.value)}>{months().map((m) => <option key={m} value={m}>{m}</option>)}</Select>}
                </Field>
                <Button onClick={() => void issue()} loading={busy === 'issue'} disabled={!f.uninvoiced.count}>
                  {`Issue ${period} invoice — ${formatNaira(f.uninvoiced.total)}`}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">Settlement or Finance officers issue invoices.</p>
            )}
          </div>
        </div>
        {error ? <ErrorAlert error={error} title="Action not completed" /> : null}
      </Section>
      <Section title="Fees not yet invoiced" flush>
        <DataTable caption="Uninvoiced fees" rows={f.uninvoiced.items} rowKey={(r) => `${r.application_reference}-${r.kind}`} dense empty={<p className="px-5 py-4 text-sm text-muted">Nothing to invoice.</p>} columns={[
          { key: 'a', header: 'Application', cell: (r) => <Mono>{r.application_reference}</Mono> },
          { key: 'k', header: 'Type', cell: (r) => (r.kind === 'FEE' ? 'Fee' : <Badge tone="warning">Credit · {r.reason?.replace(/_/g, ' ').toLowerCase()}</Badge>) },
          { key: 'p', header: 'Purchase amount', align: 'right', cell: (r) => formatNaira(r.purchase_amount) },
          { key: 'r', header: 'Rate', align: 'right', cell: (r) => `${r.rate_percent}%` },
          { key: 'f', header: 'Fee', align: 'right', cell: (r) => <span className="font-medium">{formatNaira(r.fee)}</span> },
          { key: 't', header: 'Accrued', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.accrued_at)}</span> },
        ]} />
      </Section>
      <Section title="Invoices" flush>
        <DataTable caption="Invoices" rows={f.invoices} rowKey={(i) => i.id} dense empty={<p className="px-5 py-4 text-sm text-muted">No invoices yet.</p>} columns={[
          { key: 'r', header: 'Invoice', cell: (i) => <Mono>{i.reference}</Mono> },
          { key: 'p', header: 'Month', cell: (i) => i.period },
          { key: 'n', header: 'Transactions', align: 'right', cell: (i) => i.fee_count },
          { key: 't', header: 'Total', align: 'right', cell: (i) => <span className="font-medium">{formatNaira(i.total)}</span> },
          { key: 's', header: 'Status', cell: (i) => <Badge tone={i.status === 'PAID' ? 'success' : 'warning'}>{i.status === 'PAID' ? `Paid · ${i.payment_reference}` : 'Awaiting payment'}</Badge> },
          { key: 'x', header: '', cell: (i) => (i.status === 'ISSUED' && manage ? (
            <div className="flex items-center gap-2">
              <Input aria-label={`Payment reference for ${i.reference}`} placeholder="Payment reference" className="h-9 w-40" value={payRef[i.id] ?? ''} onChange={(e) => setPayRef({ ...payRef, [i.id]: e.target.value })} />
              <Button size="sm" variant="secondary" loading={busy === i.id} onClick={() => void paid(i.id)}>{`Record ${formatNaira(i.total)} received`}</Button>
            </div>
          ) : null) },
        ]} />
      </Section>
      <Alert tone="info">The fee is charged to the partner and invoiced monthly. It never changes the customer’s price or the amount the Bank pays the vendor. Fees reverse automatically as credits if a vendor payment is reversed or goods are refunded. Whoever issues an invoice cannot also record its payment.</Alert>
    </div>
  );
}
