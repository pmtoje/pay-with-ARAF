'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, EmptyState, KeyValue, LoadingBlock, PageHeader, StatusBadge, Tabs, Timeline, formatDate, formatDateTime, humanize, statusTone } from '@araf/ui';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { APPROVAL_TYPES, roleLabel } from '@/lib/labels';
import { ActionDialog, ErrorAlert, Guard, Mono, Section } from '@/components/common';
import { ConfigForm, ConfigSummary, PartnerDetailsForm, VendorManager, type PartnerDetail } from '@/components/partner-forms';
import { Icon } from '@/components/icons';

export default function PartnerPage() {
  return <Guard perm="partner.read"><Partner /></Guard>;
}

type Act = 'submit' | 'suspend' | 'reactivate' | 'production' | null;

function Partner() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useSession();
  const state = useApi<PartnerDetail>(`/api/admin/partners/${id}`);
  const [tab, setTab] = useState('overview');
  const [act, setAct] = useState<Act>(null);
  const [editing, setEditing] = useState(false);
  const [proposing, setProposing] = useState(false);
  const p = state.data;
  useEffect(() => {
    if (p) document.title = `${p.trading_name} · Partners · Pay with ARAF admin`;
  }, [p]);

  if (state.error && !p) return <ErrorAlert error={state.error} onRetry={state.reload} title="Partner could not be loaded" />;
  if (!p) return <Card><LoadingBlock rows={8} /></Card>;

  const active = p.configurations.find((c) => c.status === 'ACTIVE');
  const canSubmit = can('partner.create') && ['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(p.status);
  const canSuspend = can('partner.suspend') && ['SANDBOX_ACTIVE', 'PRODUCTION_PENDING', 'PRODUCTION_ACTIVE'].includes(p.status);
  const canReactivate = can('partner.suspend') && p.status === 'SUSPENDED';
  const canProduction = can('partner.production.request') && p.status === 'SANDBOX_ACTIVE';
  const pendingApprovals = p.approvals.filter((a) => a.status === 'PENDING');

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/partners" className="inline-flex items-center gap-1 hover:underline">{Icon.back('h-3.5 w-3.5')} Partners</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{p.trading_name}<StatusBadge status={p.status} /></span>}
        description={<><Mono>{p.partner_code}</Mono> · {p.registered_name} · {humanize(p.partner_type)} · onboarded {formatDate(p.created_at)}</>}
        actions={
          <>
            {canSubmit && <Button variant="gold" onClick={() => setAct('submit')}>Submit for approval</Button>}
            {canProduction && <Button variant="secondary" onClick={() => setAct('production')}>{Icon.lock()} Request production</Button>}
            {canReactivate && <Button variant="secondary" onClick={() => setAct('reactivate')}>Request reactivation</Button>}
            {canSuspend && <Button variant="danger" onClick={() => setAct('suspend')}>Suspend</Button>}
          </>
        }
      />

      {pendingApprovals.length > 0 && (
        <Alert tone="info" className="mb-5" title={`${pendingApprovals.length} request${pendingApprovals.length > 1 ? 's' : ''} awaiting a checker`} action={<Link href="/approvals" className="text-sm font-medium text-gold-strong hover:underline">Approvals inbox</Link>}>
          {pendingApprovals.map((a) => a.summary).join(' · ')}
        </Alert>
      )}
      {me.sandbox && ['SANDBOX_ACTIVE', 'PRODUCTION_PENDING'].includes(p.status) && (
        <Alert tone="warning" className="mb-5" title="Production approval is locked in this sandbox deployment">
          A production activation request can be raised for tracking, but it cannot be approved until live operations are enabled after every production gate (integrations, policy, Shariah, security, UAT) is closed.
        </Alert>
      )}

      <Tabs
        label="Partner sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'config', label: 'Configuration', count: p.configurations.length },
          { id: 'vendors', label: 'Vendors', count: p.vendors.length },
          { id: 'integration', label: 'Integration' },
          { id: 'users', label: 'Users', count: p.users.length },
          { id: 'approvals', label: 'Approvals', count: p.approvals.length },
        ]}
      />
      <div className="mt-6 space-y-6">
        {tab === 'overview' && (
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <Section title="Partner details" actions={can('partner.create') && ['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(p.status) && !editing ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit details</Button> : undefined}>
                {editing ? (
                  <PartnerDetailsForm partnerId={p.id} initial={p} submitLabel="Save details" onSaved={() => { setEditing(false); state.reload(); }} />
                ) : (
                  <KeyValue
                    items={[
                      { label: 'Registered name', value: p.registered_name },
                      { label: 'Trading name', value: p.trading_name },
                      { label: 'Registration number', value: p.registration_number, mono: true },
                      { label: 'Tax ID', value: p.tax_identification_number ?? '—', mono: true },
                      { label: 'Business type', value: p.business_type },
                      { label: 'Category', value: p.business_category },
                      { label: 'Website', value: <a className="text-gold-strong hover:underline" href={p.website_url} target="_blank" rel="noopener noreferrer">{p.website_url}</a> },
                      { label: 'Risk classification', value: <Badge tone={statusTone(p.risk_classification === 'HIGH' ? 'FAILED' : 'OPEN')}>{humanize(p.risk_classification)}</Badge> },
                      { label: 'Address', value: p.business_address },
                      { label: 'Primary contact', value: <>{p.contact_name}<br /><span className="text-muted">{p.contact_email} · {p.contact_phone}</span></> },
                      { label: 'Technical contact', value: p.technical_contact_name ? <>{p.technical_contact_name}<br /><span className="text-muted">{p.technical_contact_email}</span></> : '—' },
                    ]}
                  />
                )}
              </Section>
              <Section title="Approved domains" description="Website and return-URL origins. Return URLs outside this list are refused." flush>
                <DataTable
                  caption="Partner domains"
                  rows={p.domains}
                  rowKey={(d) => d.id}
                  dense
                  empty={<p className="px-5 py-4 text-sm text-muted">No domains recorded.</p>}
                  columns={[
                    { key: 'k', header: 'Kind', cell: (d) => humanize(d.kind) },
                    { key: 'v', header: 'Origin', cell: (d) => <Mono>{d.value}</Mono> },
                    { key: 'e', header: 'Environment', cell: (d) => humanize(d.environment) },
                    { key: 'a', header: 'Status', cell: (d) => (d.approved ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Pending approval</Badge>) },
                  ]}
                />
              </Section>
            </div>
            <div className="space-y-6">
              <Section title="Status actions">
                <div className="space-y-3 text-sm">
                  <StatusAction show={['DRAFT', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(p.status)} allowed={can('partner.create')} label="Submit for approval" perm="partner.create" onClick={() => setAct('submit')} help="Requires a proposed configuration and a settlement account." />
                  <StatusAction show={['SANDBOX_ACTIVE', 'PRODUCTION_PENDING', 'PRODUCTION_ACTIVE'].includes(p.status)} allowed={can('partner.suspend')} label="Suspend partner" perm="partner.suspend" onClick={() => setAct('suspend')} help="Takes effect immediately; API credentials are suspended." danger />
                  <StatusAction show={p.status === 'SUSPENDED'} allowed={can('partner.suspend')} label="Request reactivation" perm="partner.suspend" onClick={() => setAct('reactivate')} help="Creates a reactivation request for a checker." />
                  <StatusAction show={p.status === 'SANDBOX_ACTIVE'} allowed={can('partner.production.request')} label="Request production activation" perm="partner.production.request" onClick={() => setAct('production')} help="Approval is locked while live operations are disabled." />
                  {['UNDER_REVIEW', 'SUBMITTED'].includes(p.status) && <p className="text-muted">Awaiting a Partner Approving Officer’s decision in the Approvals inbox.</p>}
                  {['REJECTED', 'TERMINATED'].includes(p.status) && <p className="text-muted">This partner is {humanize(p.status).toLowerCase()}. No further status actions are available.</p>}
                </div>
              </Section>
              <Section title="Status history">
                <Timeline
                  items={p.status_history.map((h) => ({
                    title: <span className="flex flex-wrap items-center gap-1.5">{h.from ? <><StatusBadge status={h.from} /><span className="text-subtle">→</span></> : null}<StatusBadge status={h.to} /></span>,
                    meta: formatDateTime(h.at),
                    description: h.reason ?? undefined,
                    tone: statusTone(h.to),
                  }))}
                />
              </Section>
            </div>
          </div>
        )}

        {tab === 'config' && (
          <>
            {proposing ? (
              <Section title="Propose new configuration" description={active ? `Prefilled from active version v${active.version}.` : 'No active configuration yet.'}>
                <ConfigForm partnerId={p.id} base={active ?? p.configurations[0]} domains={p.domains} partnerStatus={p.status} onSaved={() => { setProposing(false); state.reload(); }} onCancel={() => setProposing(false)} />
              </Section>
            ) : (
              can('partner.create') && !['REJECTED', 'TERMINATED'].includes(p.status) && (
                <div className="flex justify-end"><Button onClick={() => setProposing(true)}>{Icon.plus()} Propose new configuration</Button></div>
              )
            )}
            {p.configurations.length === 0 ? (
              <Card><EmptyState title="No configuration yet" description="Propose a configuration to set limits, tenors and categories." /></Card>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                {p.configurations.map((c) => (
                  <Section key={c.id} title={<span className="flex items-center gap-2">Version {c.version} <StatusBadge status={c.status} /></span>} description={c.approved_at ? `Approved ${formatDateTime(c.approved_at)}` : `Proposed ${formatDateTime(c.created_at)}`}>
                    <ConfigSummary c={c} />
                  </Section>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'vendors' && <Card className="p-5"><VendorManager partner={p} onChanged={state.reload} /></Card>}

        {tab === 'integration' && (
          <>
            <Alert tone="info">Credentials and webhook endpoints are managed by the partner in the partner portal. The Bank sees metadata only — secrets are never displayed here.</Alert>
            <Section title="API credentials" flush>
              <DataTable
                caption="API credentials"
                rows={p.credentials}
                rowKey={(c) => c.id}
                dense
                empty={<p className="px-5 py-6 text-sm text-muted">No API credentials issued.</p>}
                columns={[
                  { key: 'n', header: 'Name', cell: (c) => <span className="font-medium">{c.name}</span> },
                  { key: 'k', header: 'Key', cell: (c) => <Mono>{c.lookupPrefix}…{c.last4}</Mono> },
                  { key: 'e', header: 'Env', cell: (c) => humanize(c.environment) },
                  { key: 's', header: 'Scopes', cell: (c) => <span className="flex max-w-md flex-wrap gap-1">{c.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</span> },
                  { key: 'u', header: 'Last used', cell: (c) => <span className="whitespace-nowrap text-muted">{formatDateTime(c.lastUsedAt)}</span> },
                  { key: 'x', header: 'Expires', cell: (c) => <span className="whitespace-nowrap text-muted">{c.expiresAt ? formatDate(c.expiresAt) : 'Never'}</span> },
                  { key: 'st', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
                ]}
              />
            </Section>
            <Section title="Webhook endpoints" flush actions={can('integration.read') ? <Link href={`/integrations?partner=${p.id}`} className="text-sm font-medium text-gold-strong hover:underline">Deliveries</Link> : undefined}>
              <DataTable
                caption="Webhook endpoints"
                rows={p.webhook_endpoints}
                rowKey={(w) => w.id}
                dense
                empty={<p className="px-5 py-6 text-sm text-muted">No webhook endpoints configured.</p>}
                columns={[
                  { key: 'u', header: 'URL', cell: (w) => <Mono>{w.url}</Mono> },
                  { key: 'e', header: 'Env', cell: (w) => humanize(w.environment) },
                  { key: 'ev', header: 'Events', cell: (w) => (w.events.length ? `${w.events.length} selected` : 'All events') },
                  { key: 'f', header: 'Consecutive failures', align: 'right', cell: (w) => <span className={w.consecutiveFailures > 0 ? 'text-danger' : ''}>{w.consecutiveFailures}</span> },
                  { key: 's', header: 'Status', cell: (w) => <StatusBadge status={w.status} /> },
                ]}
              />
            </Section>
          </>
        )}

        {tab === 'users' && (
          <Section title="Partner portal users" description="Partner staff are managed by the partner administrator." flush>
            <DataTable
              caption="Partner users"
              rows={p.users}
              rowKey={(u) => u.id}
              empty={<EmptyState title="No partner users yet" description="The primary contact is invited when onboarding is approved." />}
              columns={[
                { key: 'n', header: 'Name', cell: (u) => <div><p className="font-medium">{u.full_name}</p><p className="text-xs text-muted">{u.email}</p></div> },
                { key: 'r', header: 'Roles', cell: (u) => <span className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone="gold">{roleLabel(r)}</Badge>)}</span> },
                { key: 'l', header: 'Last sign-in', cell: (u) => <span className="text-muted">{formatDateTime(u.last_login_at)}</span> },
                { key: 's', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
              ]}
            />
          </Section>
        )}

        {tab === 'approvals' && (
          <Section title="Approval requests for this partner" flush actions={<Link href="/approvals" className="text-sm font-medium text-gold-strong hover:underline">Approvals inbox</Link>}>
            <DataTable
              caption="Partner approvals"
              rows={p.approvals}
              rowKey={(a) => a.id}
              empty={<p className="px-5 py-6 text-sm text-muted">No approval requests.</p>}
              columns={[
                { key: 'r', header: 'Reference', cell: (a) => <Mono>{a.reference}</Mono> },
                { key: 't', header: 'Type', cell: (a) => APPROVAL_TYPES[a.type]?.label ?? a.type },
                { key: 's', header: 'Summary', cell: (a) => a.summary },
                { key: 'c', header: 'Requested', cell: (a) => <span className="whitespace-nowrap text-muted">{formatDateTime(a.created_at)}</span> },
                { key: 'd', header: 'Decided', cell: (a) => <span className="whitespace-nowrap text-muted">{formatDateTime(a.decided_at)}</span> },
                { key: 'cc', header: 'Checker comment', cell: (a) => <span className="text-muted">{a.checker_comment ?? '—'}</span> },
                { key: 'st', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
          </Section>
        )}
      </div>

      <ActionDialog open={act === 'submit'} onClose={() => setAct(null)} title={`Submit ${p.trading_name} for approval`} confirmLabel="Submit" tone="gold" reason={{ label: 'Comment for the checker', optional: true }} onConfirm={(c) => api.post(`/api/admin/partners/${p.id}/submit`, c ? { comment: c } : {})} successMessage="Submitted — awaiting checker approval" onDone={state.reload} />
      <ActionDialog open={act === 'suspend'} onClose={() => setAct(null)} title={`Suspend ${p.trading_name}`} description="New checkouts are refused and the partner’s API credentials are suspended immediately. Reactivation needs a checker." confirmLabel="Suspend partner" tone="danger" irreversible reason={{ label: 'Reason for suspension', minLength: 3 }} onConfirm={(r) => api.post(`/api/admin/partners/${p.id}/suspend`, { reason: r })} successMessage="Partner suspended" onDone={state.reload} />
      <ActionDialog open={act === 'reactivate'} onClose={() => setAct(null)} title={`Request reactivation of ${p.trading_name}`} description="Creates a reactivation request in the Approvals inbox. The partner returns to its previous active environment once approved." confirmLabel="Request reactivation" reason={{ label: 'Justification', minLength: 3 }} onConfirm={(c) => api.post(`/api/admin/partners/${p.id}/reactivation-request`, { comment: c })} successMessage="Reactivation requested — awaiting checker" onDone={state.reload} />
      <ActionDialog
        open={act === 'production'}
        onClose={() => setAct(null)}
        title={`Request production activation for ${p.trading_name}`}
        confirmLabel="Raise request"
        reason={{ label: 'Readiness summary', minLength: 3, hint: 'Summarise integration testing, UAT and sign-offs.' }}
        onConfirm={(c) => api.post<{ status: string; note?: string }>(`/api/admin/partners/${p.id}/production-request`, { comment: c })}
        successMessage={(r) => r.note ?? 'Production activation requested'}
        onDone={state.reload}
      >
        <Alert tone="warning" title="Locked in sandbox">The partner moves to Production pending and a request is created, but approval is refused by the platform while live operations are disabled.</Alert>
      </ActionDialog>
    </>
  );
}

function StatusAction({ show, allowed, label, perm, onClick, help, danger }: { show: boolean; allowed: boolean; label: string; perm: string; onClick: () => void; help: string; danger?: boolean }) {
  if (!show) return null;
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{label}</p>
        <Button size="sm" variant={danger ? 'danger' : 'secondary'} disabled={!allowed} onClick={onClick}>{allowed ? 'Start' : 'No access'}</Button>
      </div>
      <p className="mt-1 text-xs text-muted">{allowed ? help : <>Requires <Mono>{perm}</Mono>.</>}</p>
    </div>
  );
}
