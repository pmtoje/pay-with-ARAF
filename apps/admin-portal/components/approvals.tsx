'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, DataTable, Dialog, Field, KeyValue, StatusBadge, Textarea, formatDateTime } from '@araf/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { APPROVAL_TYPES } from '@/lib/labels';
import { ErrorAlert, JsonBlock, Mono, useToast } from '@/components/common';
import { Icon } from '@/components/icons';

export interface Approval {
  id: string;
  reference: string;
  type: string;
  resource_type: string;
  resource_id: string;
  partner_id: string | null;
  summary: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  maker: string;
  maker_comment: string | null;
  checker: string | null;
  checker_comment: string | null;
  created_at: string;
  decided_at: string | null;
  can_decide: boolean;
  payload: Record<string, unknown> | null;
}

export function ApprovalTable({ rows, onOpen, history }: { rows: Approval[]; onOpen: (a: Approval) => void; history?: boolean }) {
  return (
    <DataTable
      caption="Approval requests"
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={onOpen}
      columns={[
        { key: 'ref', header: 'Reference', cell: (r) => <Mono>{r.reference}</Mono>, sortValue: (r) => r.reference },
        { key: 'type', header: 'Type', cell: (r) => <span className="whitespace-nowrap text-sm">{APPROVAL_TYPES[r.type]?.label ?? r.type}</span>, sortValue: (r) => r.type },
        { key: 'summary', header: 'Summary', cell: (r) => <span className="line-clamp-2 min-w-[16rem]">{r.summary}</span> },
        { key: 'maker', header: 'Maker', cell: (r) => <span className="whitespace-nowrap">{r.maker}</span>, sortValue: (r) => r.maker },
        history
          ? { key: 'checker', header: 'Checker', cell: (r) => <span className="whitespace-nowrap">{r.checker ?? '—'}</span> }
          : { key: 'created', header: 'Requested', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span>, sortValue: (r) => r.created_at },
        history
          ? { key: 'decided', header: 'Decided', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.decided_at)}</span>, sortValue: (r) => r.decided_at ?? '' }
          : { key: 'you', header: 'Your action', cell: (r) => (r.can_decide ? <Badge tone="gold">Decision required</Badge> : <Badge>View only</Badge>), sortValue: (r) => (r.can_decide ? 0 : 1) },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}

function resourceLink(a: Approval): { href: string; label: string } | null {
  if (a.type === 'REVIEW_DECISION') return { href: `/reviews/${a.resource_id}`, label: 'Open credit review' };
  if (a.type === 'CREDIT_POLICY') return { href: '/policy', label: 'Open credit policy' };
  if (a.type === 'ROLE_ASSIGNMENT') return { href: '/users', label: 'Open users & roles' };
  if (a.type === 'VENDOR_PAYMENT' || a.type === 'REFUND') {
    const ref = (a.payload?.application as string | undefined) ?? a.summary.match(/APP-[A-Z0-9-]+/)?.[0];
    return ref ? { href: `/applications?search=${encodeURIComponent(ref)}`, label: `Find application ${ref}` } : null;
  }
  if (a.partner_id) return { href: `/partners/${a.partner_id}`, label: 'Open partner' };
  return null;
}

export function ApprovalDialog({ approval, onClose, onDecided }: { approval: Approval | null; onClose: () => void; onDecided: () => void }) {
  const { me, can } = useSession();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setComment('');
    setError(null);
    setTouched(false);
  }, [approval?.id]);
  if (!approval) return null;
  const a = approval;
  const meta = APPROVAL_TYPES[a.type];
  const isMaker = a.maker === me.user.full_name || a.maker === me.user.id;
  const lacks = meta && !can(meta.permission);
  const blockedReason = a.status !== 'PENDING'
    ? null
    : !a.can_decide
      ? isMaker
        ? 'You created this request. Maker–checker control requires a different authorised officer to decide it.'
        : lacks
          ? `Deciding this request requires the ${meta.permission} permission, which your roles do not include.`
          : 'You cannot decide this request.'
      : null;
  const link = resourceLink(a);
  const commentError = comment.trim().length < 3 ? 'A comment of at least 3 characters is required.' : null;

  const decide = async (decision: 'APPROVE' | 'REJECT' | 'REQUEST_INFO') => {
    setTouched(true);
    if (commentError) return;
    setBusy(decision);
    setError(null);
    try {
      await api.post(`/api/admin/approvals/${a.id}/decide`, { decision, comment: comment.trim() });
      toast(`${a.reference} ${decision === 'APPROVE' ? 'approved' : decision === 'REJECT' ? 'rejected' : 'returned for more information'}`);
      onDecided();
      onClose();
    } catch (e) {
      setError(e);
      onDecided();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? () => undefined : onClose}
      size="lg"
      title={<span className="flex flex-wrap items-center gap-2"><Mono>{a.reference}</Mono><span>·</span><span>{meta?.label ?? a.type}</span><StatusBadge status={a.status} /></span>}
      description={a.summary}
      footer={
        a.status === 'PENDING' && a.can_decide ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={!!busy}>Close</Button>
            {a.type === 'PARTNER_APPROVAL' && <Button variant="secondary" loading={busy === 'REQUEST_INFO'} disabled={!!busy} onClick={() => decide('REQUEST_INFO')}>Request information</Button>}
            <Button variant="danger" loading={busy === 'REJECT'} disabled={!!busy} onClick={() => decide('REJECT')}>Reject</Button>
            <Button variant="gold" loading={busy === 'APPROVE'} disabled={!!busy} onClick={() => decide('APPROVE')}>Approve</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="space-y-5">
        <KeyValue
          items={[
            { label: 'Maker', value: a.maker },
            { label: 'Requested', value: formatDateTime(a.created_at) },
            { label: 'Resource', value: <Mono>{a.resource_type} · {a.resource_id.slice(0, 18)}{a.resource_id.length > 18 ? '…' : ''}</Mono> },
            { label: 'Required permission', value: meta ? <Mono>{meta.permission}</Mono> : '—' },
            { label: 'Maker comment', value: a.maker_comment ?? <span className="text-subtle">No comment</span> },
            ...(a.status !== 'PENDING' ? [{ label: 'Checker', value: a.checker ?? '—' }, { label: 'Decided', value: formatDateTime(a.decided_at) }, { label: 'Checker comment', value: a.checker_comment ?? '—' }] : []),
          ]}
        />
        {link && <Link href={link.href} className="inline-flex items-center gap-1 text-sm font-medium text-gold-strong hover:underline">{link.label} {Icon.chevron('h-3.5 w-3.5')}</Link>}
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-subtle">Payload</p>
          <JsonBlock value={a.payload} maxHeight="max-h-56" />
        </div>
        {a.type === 'PARTNER_PRODUCTION' && a.status === 'PENDING' && (
          <Alert tone="warning" title="Production approval is locked in this deployment">
            Live operations are disabled until every production gate is closed. Approving will be refused by the platform; rejecting returns the partner to sandbox.
          </Alert>
        )}
        {a.type === 'VENDOR_PAYMENT' && a.status === 'PENDING' && (
          <Alert tone="info" title="Approving executes the payment instruction">
            The instruction is sent to the payment system. Payment is only “confirmed” once the authoritative source reports it — approval alone is not confirmation.
          </Alert>
        )}
        {blockedReason && (
          <Alert tone="warning" title="You cannot decide this request">{blockedReason}</Alert>
        )}
        {a.status === 'PENDING' && a.can_decide && (
          <Field label="Decision comment" required hint="Recorded in the audit log and visible to the maker." error={touched ? commentError : null}>
            {(ids) => <Textarea id={ids.id} aria-describedby={ids.describedBy} aria-invalid={ids.invalid} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} placeholder="Explain the basis for your decision" />}
          </Field>
        )}
        <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Decision not recorded" /> : null}</div>
      </div>
    </Dialog>
  );
}
