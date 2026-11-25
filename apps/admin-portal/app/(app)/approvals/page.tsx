'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, EmptyState, PageHeader, Tabs } from '@araf/ui';
import { ApprovalDialog, ApprovalTable, type Approval } from '@/components/approvals';
import { qs } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { APPROVAL_TYPES } from '@/lib/labels';
import { Async, FilterField, Toolbar, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';


export default function ApprovalsPage() {
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<Approval | null>(null);
  const types = type ? type : undefined;
  const pending = useApi<Approval[]>(`/api/admin/approvals${qs({ status: 'PENDING', types })}`);
  const approved = useApi<Approval[]>(tab === 'history' ? `/api/admin/approvals${qs({ status: 'APPROVED', types })}` : null);
  const rejected = useApi<Approval[]>(tab === 'history' ? `/api/admin/approvals${qs({ status: 'REJECTED', types })}` : null);
  useEffect(() => {
    document.title = 'Approvals · Pay with ARAF admin';
  }, []);

  const history = useMemo(() => {
    if (!approved.data || !rejected.data) return undefined;
    return [...approved.data, ...rejected.data].sort((a, b) => (b.decided_at ?? b.created_at).localeCompare(a.decided_at ?? a.created_at));
  }, [approved.data, rejected.data]);
  const historyState = { data: history, error: approved.error || rejected.error, loading: approved.loading || rejected.loading, reload: () => { approved.reload(); rejected.reload(); } };
  const mine = pending.data?.filter((a) => a.can_decide).length ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Maker–checker"
        title="Approvals inbox"
        description="Every restricted change is proposed by one officer (maker) and takes effect only when a second, authorised officer (checker) approves it. You can never approve your own request."
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs
            label="Approval views"
            value={tab}
            onChange={(t) => setTab(t as 'pending' | 'history')}
            tabs={[
              { id: 'pending', label: 'Pending', count: pending.data?.length },
              { id: 'history', label: 'History' },
            ]}
          />
        </div>
        <Toolbar>
          <FilterField label="Request type">
            {(id) => (
              <select id={id} className={filterControl} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {Object.entries(APPROVAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            )}
          </FilterField>
          {tab === 'pending' && pending.data && (
            <p className="pb-2 text-sm text-muted" aria-live="polite">
              <span className="font-semibold text-fg">{mine}</span> awaiting your decision · {pending.data.length - mine} awaiting another officer
            </p>
          )}
          <Button className="ml-auto" variant="ghost" size="sm" onClick={tab === 'pending' ? pending.reload : historyState.reload}>{Icon.refresh()} Refresh</Button>
        </Toolbar>
        <Async
          state={tab === 'pending' ? pending : historyState}
          rows={6}
          empty={<EmptyState title={tab === 'pending' ? 'Nothing awaiting approval' : 'No decided requests'} description={tab === 'pending' ? 'New maker requests will appear here.' : 'Approved and rejected requests appear here.'} icon={Icon.approvals('h-5 w-5')} />}
        >
          {(rows) => <ApprovalTable rows={rows} onOpen={setSelected} history={tab === 'history'} />}
        </Async>
      </Card>
      <ApprovalDialog approval={selected} onClose={() => setSelected(null)} onDecided={() => { pending.reload(); historyState.reload(); }} />
    </>
  );
}

