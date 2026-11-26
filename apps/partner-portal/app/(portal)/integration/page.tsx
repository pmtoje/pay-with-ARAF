'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, CardHeader, CopyButton, KeyValue, LoadingBlock, Meter, PageHeader, Stat, StatusBadge, Tabs, formatDateTime, formatNaira, formatPercent, humanize } from '@araf/ui';
import { useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { Integration } from '@/lib/types';
import { ErrorState, Mono } from '@/components/common';
import { RequirePermission } from '@/components/gate';
import { ApiKeys } from '@/components/integration/api-keys';
import { Webhooks } from '@/components/integration/webhooks';
import { ApiRequestLog, EventLog } from '@/components/integration/logs';
import { CheckoutEmbed } from '@/components/integration/checkout-embed';

const DOCS_URL = process.env.NEXT_PUBLIC_DEVELOPER_PORTAL_URL ?? 'http://localhost:3004';

type TabId = 'overview' | 'checkout' | 'keys' | 'webhooks' | 'events' | 'requests';
const TAB_IDS: TabId[] = ['overview', 'checkout', 'keys', 'webhooks', 'events', 'requests'];

export default function IntegrationPage() {
  return (
    <RequirePermission perm="p.integration.read">
      <IntegrationInner />
    </RequirePermission>
  );
}

function IntegrationInner() {
  const { me, can } = useSession();
  const canManage = can('p.integration.manage');
  const { data, error, loading, reload } = useApi<Integration>('/api/partner-portal/integration');
  const [tab, setTab] = useState<TabId>('overview');
  const [eventsKey, setEventsKey] = useState(0);

  useEffect(() => {
    const h = window.location.hash.slice(1) as TabId;
    if (TAB_IDS.includes(h)) setTab(h);
  }, []);
  const selectTab = (t: string) => {
    setTab(t as TabId);
    history.replaceState(null, '', `#${t}`);
  };

  return (
    <>
      <PageHeader
        title="Integration"
        description="Checkout button, API keys, webhooks and logs for offering Buy Now Pay Later with AltBank on your website."
        actions={
          <>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              Developer docs ↗
            </a>
            <Button variant="secondary" onClick={reload} loading={loading}>
              Refresh
            </Button>
          </>
        }
      />
      <div className="mb-5">
        <Tabs
          label="Integration sections"
          value={tab}
          onChange={selectTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'checkout', label: 'Checkout button' },
            { id: 'keys', label: 'API keys', count: data?.credentials.filter((c) => c.status === 'ACTIVE').length },
            { id: 'webhooks', label: 'Webhooks', count: data?.webhook_endpoints.length },
            { id: 'events', label: 'Event log' },
            { id: 'requests', label: 'API requests' },
          ]}
        />
      </div>
      {tab === 'events' ? (
        <EventLog key={eventsKey} eventTypes={data?.event_types ?? []} canManage={canManage} />
      ) : tab === 'requests' ? (
        <ApiRequestLog />
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} title="Integration settings could not be loaded" />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingBlock rows={8} label="Loading integration settings" />
        </Card>
      ) : tab === 'overview' ? (
        <OverviewTab data={data} sandbox={me.sandbox} />
      ) : tab === 'checkout' ? (
        <CheckoutEmbed data={data} />
      ) : tab === 'keys' ? (
        <ApiKeys credentials={data.credentials} canManage={canManage} environment={data.environment} onChange={reload} />
      ) : (
        <Webhooks
          endpoints={data.webhook_endpoints}
          eventTypes={data.event_types}
          canManage={canManage}
          sandbox={me.sandbox}
          onChange={reload}
          onTestSent={() => {
            setEventsKey((k) => k + 1);
            reload();
          }}
        />
      )}
    </>
  );
}

function OverviewTab({ data, sandbox }: { data: Integration; sandbox: boolean }) {
  const c = data.configuration;
  const h = data.health;
  return (
    <div className="space-y-4">
      {sandbox && (
        <Alert tone="warning" title="Sandbox environment">
          Use <Mono>sk_test_</Mono> keys here. Production (<Mono>sk_live_</Mono>) stays locked until The Alternative Bank approves your go-live{data.production_available ? '' : ' — production is not yet available for your account'}.
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Connection details" />
          <div className="space-y-5 px-5 py-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">API base URL</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Mono className="break-all text-sm text-fg">{data.api_base_url}</Mono>
                <CopyButton value={data.api_base_url} />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Partner ID</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Mono className="break-all text-sm text-fg">{data.partner.id}</Mono>
                <CopyButton value={data.partner.id} />
              </div>
            </div>
            <KeyValue
              columns={3}
              items={[
                { label: 'Environment', value: <Badge tone={data.environment === 'SANDBOX' ? 'warning' : 'success'}>{data.environment}</Badge> },
                { label: 'Partner code', value: data.partner.code, mono: true },
                { label: 'Partner status', value: <StatusBadge status={data.partner.status} /> },
                { label: 'Production access', value: data.production_available ? 'Available' : 'Locked pending Bank approval' },
                { label: 'Active API keys', value: data.credentials.filter((k) => k.status === 'ACTIVE').length },
                { label: 'Webhook endpoints', value: data.webhook_endpoints.length },
              ]}
            />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Approved return / cancel URL origins</p>
              {data.approved_return_origins.length ? (
                <ul className="mt-1.5 flex flex-wrap gap-2">
                  {data.approved_return_origins.map((o) => (
                    <li key={o}>
                      <Badge>
                        <span className="font-mono">{o}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">None approved. Checkout sessions will be rejected with RETURN_URL_NOT_APPROVED.</p>
              )}
              <p className="mt-1.5 text-xs text-muted">Changes to origins are made by the Bank’s onboarding team.</p>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Webhook health" description="Deliveries in the last 7 days" />
          <div className="space-y-4 px-5 py-5">
            {h.total === 0 ? (
              <p className="text-sm text-muted">No deliveries in the last 7 days.</p>
            ) : (
              <>
                <Meter value={h.success_rate ?? 0} label="Success rate" />
                <p className="text-3xl font-semibold tabular-nums text-fg">{formatPercent(h.success_rate)}</p>
              </>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Total" value={h.total} />
              <Stat label="Succeeded" value={h.succeeded} />
              <Stat label="Retrying" value={h.retrying} />
              <Stat label="Dead-lettered" value={h.dead_lettered} />
            </div>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Active configuration" description={c ? `Version ${c.version} · approved ${formatDateTime(c.approved_at)}` : undefined} />
        <div className="px-5 py-5">
          {c ? (
            <KeyValue
              columns={3}
              items={[
                { label: 'Transaction range', value: `${formatNaira(c.min_transaction_kobo, { noKobo: true })} – ${formatNaira(c.max_transaction_kobo, { noKobo: true })}` },
                { label: 'Products', value: c.permitted_products.map(humanize).join(', ') },
                { label: 'Tenors (months)', value: c.permitted_tenors.join(', ') },
                { label: 'Eligible categories', value: <span className="flex flex-wrap gap-1">{c.eligible_categories.map((cat) => <Badge key={cat}><span className="font-mono">{cat}</span></Badge>)}</span> },
                { label: 'Application expiry', value: `${c.application_expiry_minutes / 60} hours` },
                { label: 'Order reservation', value: `${c.order_reservation_minutes / 60} hours` },
                { label: 'Profit rate', value: c.annual_profit_rate_percent !== undefined ? `${c.annual_profit_rate_percent}% per annum` : '—' },
                { label: 'Customer equity', value: c.partial_financing_enabled ? 'Enabled — you collect it, then confirm via POST /orders/{ref}/equity' : 'Disabled' },
                { label: 'Multiple vendors per cart', value: c.allow_multiple_vendors ? 'Allowed' : 'Not allowed' },
                { label: 'Settlement arrangement', value: humanize(c.settlement_arrangement) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No active configuration. Contact the Bank’s partner onboarding team.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
