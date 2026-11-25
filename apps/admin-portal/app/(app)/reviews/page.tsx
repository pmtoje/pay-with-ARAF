'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Card, DataTable, EmptyState, PageHeader, StatusBadge, Tabs, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { REVIEW_QUEUES } from '@/lib/labels';
import { Async, FilterField, Guard, Mono, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface ReviewRow { id: string; queue: string; status: string; application_id: string; application_reference: string; application_status: string; partner: string; purchase_amount: number; income_profile: string | null; sla_due_at: string | null; sla_breached: boolean; assigned_to_id: string | null; created_at: string }

const STATUSES = ['PENDING', 'AWAITING_CUSTOMER', 'CLARIFICATION_REQUESTED', 'DECISION_PENDING_APPROVAL', 'ESCALATED', 'CLEARED', 'DECLINED'];

export default function ReviewsPage() {
  return <Guard perm="application.read.sensitive"><Reviews /></Guard>;
}

function slaText(r: ReviewRow) {
  if (!r.sla_due_at) return '—';
  const ms = new Date(r.sla_due_at).getTime() - Date.now();
  const h = Math.abs(ms) / 3_600_000;
  const t = h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  return ms < 0 ? `Breached ${t} ago` : `Due in ${t}`;
}

function Reviews() {
  const router = useRouter();
  const [queue, setQueue] = useState(REVIEW_QUEUES[0].id);
  const [status, setStatus] = useState('');
  useEffect(() => { document.title = 'Credit reviews · Pay with ARAF admin'; }, []);
  const all = useApi<ReviewRow[]>(`/api/admin/reviews${qs({ status })}`, { pollMs: 60_000 });
  const rows = all.data?.filter((r) => r.queue === queue);
  const q = REVIEW_QUEUES.find((x) => x.id === queue)!;
  const breaches = all.data?.filter((r) => r.sla_breached).length ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Credit"
        title="Enhanced credit reviews"
        description="Applications routed to a credit analyst by policy. An analyst’s decision is a maker action: it takes effect only after a Credit Risk Reviewer approves it in the Approvals inbox."
      />
      {breaches > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-4 py-2.5 text-sm text-danger" role="status">
          {Icon.operations()} <strong>{breaches}</strong> review{breaches > 1 ? 's have' : ' has'} breached the SLA across all queues.
        </div>
      )}
      <Card>
        <div className="px-4 pt-2">
          <Tabs label="Review queues" value={queue} onChange={setQueue} tabs={REVIEW_QUEUES.map((x) => ({ id: x.id, label: <span className="inline-flex items-center gap-1.5">{x.label}{all.data?.some((r) => r.queue === x.id && r.sla_breached) && <span className="text-danger" aria-label="SLA breached">{Icon.dot()}</span>}</span>, count: all.data?.filter((r) => r.queue === x.id).length }))} />
        </div>
        <Toolbar>
          <p className="max-w-xl flex-1 pb-2 text-sm text-muted">{q.description}</p>
          <FilterField label="Status">
            {(id) => (
              <select id={id} className={filterControl} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Open (all open statuses)</option>
                {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </select>
            )}
          </FilterField>
        </Toolbar>
        <Async state={{ ...all, data: rows }} rows={5} empty={<EmptyState title={`No ${q.label.toLowerCase()} reviews`} description="The queue is clear." icon={Icon.reviews('h-5 w-5')} />}>
          {(list) => (
            <DataTable
              caption={`${q.label} reviews`}
              rows={list}
              rowKey={(r) => r.id}
              onRowClick={(r) => router.push(`/reviews/${r.id}`)}
              columns={[
                { key: 'ref', header: 'Application', sortValue: (r) => r.application_reference, cell: (r) => <Link href={`/reviews/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] font-medium hover:underline">{r.application_reference}</Link> },
                { key: 'p', header: 'Partner', cell: (r) => r.partner },
                { key: 'amt', header: 'Purchase', align: 'right', sortValue: (r) => r.purchase_amount, cell: (r) => formatNaira(r.purchase_amount) },
                { key: 'pr', header: 'Profile', cell: (r) => (r.income_profile ? <Badge>{humanize(r.income_profile)}</Badge> : '—') },
                { key: 'st', header: 'Review status', cell: (r) => <StatusBadge status={r.status} /> },
                { key: 'as', header: 'Application', cell: (r) => <span className="text-xs text-muted">{humanize(r.application_status)}</span> },
                { key: 'sla', header: 'SLA', sortValue: (r) => r.sla_due_at ?? '', cell: (r) => <span className={r.sla_breached ? 'inline-flex items-center gap-1 font-medium text-danger' : 'text-muted'}>{r.sla_breached && Icon.operations('h-3.5 w-3.5')}{slaText(r)}</span> },
                { key: 'c', header: 'Queued', sortValue: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span> },
              ]}
            />
          )}
        </Async>
      </Card>
      <p className="mt-3 text-xs text-muted">Queue ordering is oldest first. <Mono>Breached</Mono> means the review passed its SLA due time without a decision.</p>
    </>
  );
}
