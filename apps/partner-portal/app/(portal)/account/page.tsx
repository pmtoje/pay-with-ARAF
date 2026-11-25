'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, KeyValue, LoadingBlock, PageHeader } from '@araf/ui';
import { formatDateTime } from '@araf/ui';
import { api, useApi } from '@/lib/api';
import { ROLE_LABEL, useSession } from '@/lib/session';
import type { SessionRow } from '@/lib/types';
import { ConfirmDialog, ErrorState, Mono } from '@/components/common';

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/i.test(ua) ? 'curl' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export default function AccountPage() {
  const { me } = useSession();
  const { data, error, reload } = useApi<{ data: SessionRow[] }>('/api/auth/partner/sessions');
  const [revoke, setRevoke] = useState<SessionRow | null>(null);
  return (
    <>
      <PageHeader title="Security & sessions" description="Your profile and the devices currently signed in to your account. Sessions end after 15 minutes of inactivity or 8 hours in total." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Your profile" />
          <div className="px-5 py-5">
            <KeyValue
              columns={3}
              items={[
                { label: 'Name', value: me.user.full_name },
                { label: 'Email', value: me.user.email },
                { label: 'Role', value: me.user.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') },
                { label: 'Partner', value: me.partner ? `${me.partner.tradingName} (${me.partner.partnerCode})` : '—' },
                { label: 'Two-step verification', value: me.mfa_verified ? <Badge tone="success">Verified this session</Badge> : <Badge tone="warning">Not verified</Badge> },
                { label: 'Environment', value: me.environment },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Active sessions" actions={<Button variant="secondary" size="sm" onClick={reload}>Refresh</Button>} />
          {error ? (
            <ErrorState error={error} onRetry={reload} title="Sessions could not be loaded" />
          ) : !data ? (
            <LoadingBlock rows={3} label="Loading sessions" />
          ) : (
            <DataTable
              caption="Active sessions"
              rows={data.data}
              rowKey={(s) => s.id}
              empty={<EmptyState title="No active sessions" />}
              columns={[
                { key: 'device', header: 'Device', cell: (s) => <span className="font-medium text-fg">{describeAgent(s.user_agent)} {s.current && <Badge tone="gold">This device</Badge>}</span> },
                { key: 'ip', header: 'IP address', cell: (s) => <Mono>{s.ip_address ?? '—'}</Mono> },
                { key: 'created', header: 'Signed in', cell: (s) => <span className="whitespace-nowrap text-muted">{formatDateTime(s.created_at)}</span> },
                { key: 'seen', header: 'Last active', cell: (s) => <span className="whitespace-nowrap text-muted">{formatDateTime(s.last_seen_at)}</span> },
                {
                  key: 'act',
                  header: <span className="sr-only">Actions</span>,
                  align: 'right',
                  cell: (s) =>
                    s.current ? null : (
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoke(s)}>
                        Sign out
                      </Button>
                    ),
                },
              ]}
            />
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title="Sign out this session?"
        description={revoke ? `${describeAgent(revoke.user_agent)} · ${revoke.ip_address ?? 'unknown IP'}` : undefined}
        confirmLabel="Sign out session"
        tone="danger"
        onConfirm={async () => {
          await api.post(`/api/auth/partner/sessions/${revoke!.id}/revoke`);
          setRevoke(null);
          reload();
        }}
      />
    </>
  );
}
