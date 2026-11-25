'use client';

import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Dialog, EmptyState, Field, Input, Select, StatusBadge, Textarea, formatDate, formatDateTime } from '@araf/ui';
import { api } from '@/lib/api';
import { API_SCOPES, type ApiScope } from '@/lib/reference';
import type { CreatedCredential, Credential } from '@/lib/types';
import { ConfirmDialog, FormError, Mono } from '../common';
import { SecretDialog } from './secret-dialog';

const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[];
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

export function ApiKeys({ credentials, canManage, environment, onChange }: { credentials: Credential[]; canManage: boolean; environment: string; onChange: () => void }) {
  const [creating, setCreating] = useState(false);
  const [revoke, setRevoke] = useState<Credential | null>(null);
  const [rotate, setRotate] = useState<Credential | null>(null);
  const [secret, setSecret] = useState<{ title: string; created: CreatedCredential } | null>(null);
  const now = Date.now();
  const effectiveStatus = (c: Credential) => (c.status === 'ACTIVE' && c.expires_at && new Date(c.expires_at).getTime() < now ? 'EXPIRED' : c.status);
  return (
    <Card>
      <CardHeader
        title="API keys"
        description={`Secret keys authenticate your server to the Pay with ARAF API (${environment === 'SANDBOX' ? 'sk_test_' : 'sk_live_'}…). Keep them on your server only.`}
        actions={canManage ? <Button onClick={() => setCreating(true)}>Create API key</Button> : undefined}
      />
      <DataTable
        caption="API keys"
        rows={credentials}
        rowKey={(c) => c.id}
        empty={<EmptyState title="No API keys yet" description="Create a key to call the API from your server." />}
        columns={[
          {
            key: 'name',
            header: 'Name',
            cell: (c) => (
              <div className="min-w-[10rem]">
                <p className="font-medium text-fg">{c.name}</p>
                <Mono className="text-muted">
                  {c.prefix}…{c.last4}
                </Mono>
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={effectiveStatus(c)} /> },
          {
            key: 'scopes',
            header: 'Scopes',
            cell: (c) => (
              <div className="flex max-w-xs flex-wrap gap-1">
                {c.scopes.length === ALL_SCOPES.length ? <Badge tone="gold">All scopes</Badge> : c.scopes.map((s) => <Badge key={s}>{s}</Badge>)}
              </div>
            ),
          },
          { key: 'ip', header: 'IP allowlist', cell: (c) => (c.ip_allowlist.length ? <Mono>{c.ip_allowlist.join(', ')}</Mono> : <span className="text-muted">Any IP</span>) },
          { key: 'used', header: 'Last used', cell: (c) => <span className="whitespace-nowrap text-muted">{c.last_used_at ? formatDateTime(c.last_used_at) : 'Never'}</span> },
          { key: 'expires', header: 'Expires', cell: (c) => <span className="whitespace-nowrap text-muted">{c.revoked_at ? `Revoked ${formatDate(c.revoked_at)}` : c.expires_at ? formatDateTime(c.expires_at) : 'Never'}</span> },
          { key: 'created', header: 'Created', cell: (c) => <span className="whitespace-nowrap text-muted">{formatDate(c.created_at)}</span> },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            cell: (c) =>
              canManage && effectiveStatus(c) === 'ACTIVE' ? (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setRotate(c)} aria-label={`Rotate ${c.name}`}>
                    Rotate
                  </Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoke(c)} aria-label={`Revoke ${c.name}`}>
                    Revoke
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          setSecret({ title: 'Your new API key', created });
          onChange();
        }}
      />
      <ConfirmDialog
        open={!!rotate}
        onClose={() => setRotate(null)}
        title={`Rotate “${rotate?.name}”?`}
        description="A new key with the same scopes and IP allowlist is issued now. The current key keeps working for 24 hours, then expires — deploy the new key within that window."
        confirmLabel="Rotate key"
        tone="gold"
        onConfirm={async () => {
          const created = await api.post<CreatedCredential>(`/api/partner-portal/credentials/${rotate!.id}/rotate`);
          setRotate(null);
          setSecret({ title: 'Your rotated API key', created });
          onChange();
        }}
      />
      <ConfirmDialog
        open={!!revoke}
        onClose={() => setRevoke(null)}
        title={`Revoke “${revoke?.name}”?`}
        description="Requests using this key will fail immediately with INVALID_API_KEY. This cannot be undone."
        confirmLabel="Revoke key"
        tone="danger"
        onConfirm={async () => {
          await api.post(`/api/partner-portal/credentials/${revoke!.id}/revoke`);
          setRevoke(null);
          onChange();
        }}
      >
        <p className="text-sm text-fg">
          Key <Mono>{revoke?.prefix}…{revoke?.last4}</Mono>
        </p>
      </ConfirmDialog>
      {secret && (
        <SecretDialog
          open
          title={secret.title}
          secret={secret.created.secret}
          warning={secret.created.warning}
          details={
            <p className="text-sm text-muted">
              Environment <strong className="text-fg">{secret.created.environment}</strong> · Scopes {secret.created.scopes.join(', ')}
            </p>
          }
          onClose={() => setSecret(null)}
        />
      )}
    </Card>
  );
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: CreatedCredential) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(ALL_SCOPES);
  const [ips, setIps] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ipList = ips
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const badIps = ipList.filter((ip) => !IPV4.test(ip) && !(ip.includes(':') && IPV6.test(ip)));
  const valid = name.trim().length > 0 && scopes.length > 0 && badIps.length === 0 && ipList.length <= 20;
  const reset = () => {
    setName('');
    setScopes(ALL_SCOPES);
    setIps('');
    setExpiry('');
    setError(null);
  };
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Create API key"
      description="The secret is shown once after creation."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const created = await api.post<CreatedCredential>('/api/partner-portal/credentials', {
                  name: name.trim(),
                  scopes,
                  ip_allowlist: ipList,
                  ...(expiry ? { expires_in_days: Number(expiry) } : {}),
                });
                reset();
                onCreated(created);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create key
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Name" required hint="e.g. “Storefront server”. Up to 80 characters.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-fg">
            Scopes <span className="text-danger" aria-hidden="true">*</span>
          </legend>
          <p className="mt-0.5 text-xs text-muted">Grant only what this key needs.</p>
          <div className="mt-2 flex gap-3 text-xs">
            <button type="button" className="font-medium text-gold-strong underline-offset-4 hover:underline" onClick={() => setScopes(ALL_SCOPES)}>
              Select all
            </button>
            <button type="button" className="font-medium text-muted underline-offset-4 hover:underline" onClick={() => setScopes([])}>
              Clear
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {ALL_SCOPES.map((s) => (
              <Checkbox
                key={s}
                checked={scopes.includes(s)}
                onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                label={<span className="font-mono text-[13px]">{s}</span>}
                description={API_SCOPES[s]}
              />
            ))}
          </div>
          {scopes.length === 0 && (
            <p className="mt-2 text-xs font-medium text-danger" role="alert">
              Select at least one scope.
            </p>
          )}
        </fieldset>
        <Field label="IP allowlist" hint="Optional. Up to 20 IPv4/IPv6 addresses, separated by commas or new lines. Empty = any IP." error={badIps.length ? `Not a valid IP address: ${badIps.join(', ')}` : ipList.length > 20 ? 'At most 20 addresses' : null}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} className="min-h-[72px] font-mono text-[13px]" value={ips} onChange={(e) => setIps(e.target.value)} placeholder="203.0.113.10" />}
        </Field>
        <Field label="Expiry">
          {({ id }) => (
            <Select id={id} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              <option value="">Never expires</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
              <option value="730">2 years</option>
            </Select>
          )}
        </Field>
        <FormError error={error} />
      </div>
    </Dialog>
  );
}
