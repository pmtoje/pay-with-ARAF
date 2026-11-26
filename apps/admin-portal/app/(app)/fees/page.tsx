'use client';

import { useState } from 'react';
import { Badge, DataTable, PageHeader, formatNaira } from '@araf/ui';
import { useApi } from '@/lib/hooks';
import { Guard, Section } from '@/components/common';
import { PartnerFees } from '@/components/partner-fees';

interface Row { partner_id: string; name: string; code: string; uninvoiced_total: number; uninvoiced_count: number; outstanding_total: number; outstanding_invoices: number }

export default function FeesPage() {
  return <Guard perm="fee.manage"><Fees /></Guard>;
}

/** ARAF merchant fees across partners: 2% of each processed purchase, invoiced monthly. */
function Fees() {
  const state = useApi<Row[]>('/api/admin/fees');
  const [selected, setSelected] = useState<string | null>(null);
  const rows = state.data ?? [];
  const pick = selected ?? rows.find((r) => r.uninvoiced_count || r.outstanding_invoices)?.partner_id ?? rows[0]?.partner_id ?? null;
  return (
    <>
      <PageHeader title="Fees & invoices" description="ARAF’s merchant fee — a percentage of every processed purchase (equity included), charged to the partner and invoiced monthly. Settlement issues invoices; Finance records payment." />
      <div className="space-y-6">
        <Section title="Partners" flush>
          <DataTable caption="Fees by partner" rows={rows} rowKey={(r) => r.partner_id} dense empty={<p className="px-5 py-4 text-sm text-muted">No partners.</p>} columns={[
            { key: 'n', header: 'Partner', cell: (r) => <button type="button" className={`font-medium underline-offset-2 hover:underline ${pick === r.partner_id ? 'text-gold-strong' : ''}`} onClick={() => setSelected(r.partner_id)}>{r.name}</button> },
            { key: 'u', header: 'Not yet invoiced', align: 'right', cell: (r) => `${formatNaira(r.uninvoiced_total)} · ${r.uninvoiced_count}` },
            { key: 'o', header: 'Invoices awaiting payment', align: 'right', cell: (r) => (r.outstanding_invoices ? <Badge tone="warning">{formatNaira(r.outstanding_total)} · {r.outstanding_invoices}</Badge> : '—') },
          ]} />
        </Section>
        {pick && <PartnerFees key={pick} partnerId={pick} source="finance" />}
      </div>
    </>
  );
}
