'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Dialog, EmptyState, Field, Input, Select, StatusBadge, formatDateTime } from '@araf/ui';
import { api } from '@/lib/api';
import type { WebhookEndpoint } from '@/lib/types';
import { ConfirmDialog, FormError, Mono } from '../common';
import { SecretDialog } from './secret-dialog';

type EventType = { type: string; description: string };

export function Webhooks({ endpoints, eventTypes, canManage, sandbox, onChange, onTestSent }: { endpoints: WebhookEndpoint[]; eventTypes: EventType[]; canManage: boolean; sandbox: boolean; onChange: () => void; onTestSent: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'reveal' | 'rotate' | 'toggle'; ep: WebhookEndpoint } | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; note?: string } | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Webhook endpoints"
          description="HTTPS endpoints that receive signed event notifications (ARAF-Signature header). Subscribing to no events means all events."
          actions={canManage ? <Button onClick={() => setAdding(true)}>Add endpoint</Button> : undefined}
        />
        {endpoints.length === 0 ? (
          <EmptyState title="No webhook endpoints" description="Add an endpoint to receive application, payment and goods-release events." />
        ) : (
          <ul className="divide-y divide-border">
            {endpoints.map((ep) => (
              <li key={ep.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-medium text-fg">{ep.url}</p>
                    {ep.description && <p className="mt-0.5 text-sm text-muted">{ep.description}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={ep.status} />
                    {ep.rotation_in_progress && <Badge tone="warning">Secret rotation — previous secret valid ≤24h</Badge>}
                    {ep.consecutive_failures > 0 && <Badge tone="danger">{ep.consecutive_failures} consecutive failures</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {ep.events.length === 0 ? <Badge tone="gold">All events</Badge> : ep.events.map((e) => <Badge key={e}>{e}</Badge>)}
                </div>
                <p className="text-xs text-muted">
                  Signing secret <Mono>whsec_••••{ep.secret_last4}</Mono> · Added {formatDateTime(ep.created_at)}
                </p>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'reveal', ep })} aria-label={`Reveal secret for ${ep.url}`}>
                      Reveal secret
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setConfirm({ kind: 'rotate', ep })} aria-label={`Rotate secret for ${ep.url}`}>
                      Rotate secret
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(ep)} aria-label={`Edit events for ${ep.url}`}>
                      Edit events
                    </Button>
                    <Button size="sm" variant={ep.status === 'ACTIVE' ? 'ghost' : 'primary'} className={ep.status === 'ACTIVE' ? 'text-danger' : undefined} onClick={() => setConfirm({ kind: 'toggle', ep })} aria-label={`${ep.status === 'ACTIVE' ? 'Disable' : 'Enable'} ${ep.url}`}>
                      {ep.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sandbox && canManage && <TestEvent eventTypes={eventTypes} hasEndpoints={endpoints.some((e) => e.status === 'ACTIVE')} onSent={onTestSent} />}

      <EndpointDialog
        open={adding}
        eventTypes={eventTypes}
        onClose={() => setAdding(false)}
        onSaved={(res) => {
          setAdding(false);
          onChange();
          if (res?.signing_secret) setSecret({ title: 'Webhook signing secret', value: res.signing_secret, note: 'Use this secret to verify the ARAF-Signature header on every delivery.' });
        }}
      />
      <EndpointDialog
        open={!!editing}
        endpoint={editing ?? undefined}
        eventTypes={eventTypes}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChange();
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'reveal'}
        onClose={() => setConfirm(null)}
        title="Reveal signing secret?"
        description="Revealing the secret is recorded in the audit log with your name."
        confirmLabel="Reveal secret"
        onConfirm={async () => {
          const r = await api.post<{ signing_secret: string }>(`/api/partner-portal/webhooks/${confirm!.ep.id}/reveal-secret`);
          setConfirm(null);
          setSecret({ title: 'Webhook signing secret', value: r.signing_secret });
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'rotate'}
        onClose={() => setConfirm(null)}
        title="Rotate signing secret?"
        description="Deliveries are signed with the new secret immediately. For the next 24 hours they also carry a second v1 signature made with the previous secret, so you can deploy the new secret without dropping events."
        confirmLabel="Rotate secret"
        tone="gold"
        onConfirm={async () => {
          const r = await api.post<{ signing_secret: string; previous_secret_valid_until: string }>(`/api/partner-portal/webhooks/${confirm!.ep.id}/rotate-secret`);
          setConfirm(null);
          onChange();
          setSecret({ title: 'New webhook signing secret', value: r.signing_secret, note: `The previous secret remains valid until ${formatDateTime(r.previous_secret_valid_until)}.` });
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === 'toggle'}
        onClose={() => setConfirm(null)}
        title={confirm?.ep.status === 'ACTIVE' ? 'Disable this endpoint?' : 'Enable this endpoint?'}
        description={confirm?.ep.status === 'ACTIVE' ? 'No new deliveries are made to a disabled endpoint; pending deliveries are skipped.' : 'Deliveries resume for new events. The consecutive-failure counter is reset.'}
        confirmLabel={confirm?.ep.status === 'ACTIVE' ? 'Disable endpoint' : 'Enable endpoint'}
        tone={confirm?.ep.status === 'ACTIVE' ? 'danger' : 'primary'}
        onConfirm={async () => {
          await api.post(`/api/partner-portal/webhooks/${confirm!.ep.id}`, { status: confirm!.ep.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
          setConfirm(null);
          onChange();
        }}
      >
        <p className="break-all font-mono text-[13px] text-fg">{confirm?.ep.url}</p>
      </ConfirmDialog>
      {secret && (
        <SecretDialog
          open
          title={secret.title}
          secret={secret.value}
          warning="Store it with your webhook handler’s configuration."
          details={secret.note ? <p className="text-sm text-muted">{secret.note}</p> : undefined}
          onClose={() => setSecret(null)}
        />
      )}
    </div>
  );
}

function EventPicker({ eventTypes, value, onChange }: { eventTypes: EventType[]; value: string[]; onChange: (v: string[]) => void }) {
  const groups = [...new Set(eventTypes.map((e) => e.type.split('.')[0]))];
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg">Events</legend>
      <p className="mt-0.5 text-xs text-muted">{value.length === 0 ? 'No selection: this endpoint receives all events.' : `${value.length} selected.`}</p>
      <div className="mt-2 flex gap-3 text-xs">
        <button type="button" className="font-medium text-gold-strong underline-offset-4 hover:underline" onClick={() => onChange([])}>
          Receive all events
        </button>
      </div>
      <div className="mt-3 max-h-72 space-y-4 overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-subtle">{g}</p>
            <div className="space-y-2.5">
              {eventTypes
                .filter((e) => e.type.startsWith(`${g}.`))
                .map((e) => (
                  <Checkbox key={e.type} checked={value.includes(e.type)} onChange={(ev) => onChange(ev.target.checked ? [...value, e.type] : value.filter((x) => x !== e.type))} label={<span className="font-mono text-[13px]">{e.type}</span>} description={e.description} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function EndpointDialog({ open, endpoint, eventTypes, onClose, onSaved }: { open: boolean; endpoint?: WebhookEndpoint; eventTypes: EventType[]; onClose: () => void; onSaved: (r?: { signing_secret?: string }) => void }) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [init, setInit] = useState<string | null>(null);
  const key = endpoint?.id ?? (open ? 'new' : null);
  if (open && init !== key) {
    setInit(key);
    setUrl(endpoint?.url ?? '');
    setDescription(endpoint?.description ?? '');
    setEvents(endpoint?.events ?? []);
    setError(null);
  }
  if (!open && init !== null) setInit(null);
  let urlError: string | null = null;
  if (!endpoint && url) {
    try {
      const u = new URL(url);
      if (!['https:', 'http:'].includes(u.protocol)) urlError = 'Use an https:// URL';
    } catch {
      urlError = 'Enter a full URL, e.g. https://shop.example.com/webhooks/araf';
    }
  }
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title={endpoint ? 'Edit subscribed events' : 'Add webhook endpoint'}
      description={endpoint ? <span className="break-all font-mono">{endpoint.url}</span> : 'Production endpoints must be public HTTPS URLs. Redirects are not followed.'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!endpoint && (!url || !!urlError)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                if (endpoint) {
                  await api.post(`/api/partner-portal/webhooks/${endpoint.id}`, { events });
                  onSaved();
                } else {
                  onSaved(await api.post<{ signing_secret: string }>('/api/partner-portal/webhooks', { url: url.trim(), description: description.trim() || undefined, events }));
                }
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {endpoint ? 'Save events' : 'Add endpoint'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {!endpoint && (
          <>
            <Field label="Endpoint URL" required error={urlError}>
              {({ id, describedBy, invalid }) => <Input id={id} type="url" inputMode="url" aria-describedby={describedBy} aria-invalid={invalid} maxLength={500} placeholder="https://shop.example.com/webhooks/araf" value={url} onChange={(e) => setUrl(e.target.value)} />}
            </Field>
            <Field label="Description" hint="Optional, up to 200 characters">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />}
            </Field>
          </>
        )}
        <EventPicker eventTypes={eventTypes} value={events} onChange={setEvents} />
        <FormError error={error} />
      </div>
    </Dialog>
  );
}

function TestEvent({ eventTypes, hasEndpoints, onSent }: { eventTypes: EventType[]; hasEndpoints: boolean; onSent: () => void }) {
  const [type, setType] = useState(eventTypes.find((e) => e.type === 'goods.release_authorized')?.type ?? eventTypes[0]?.type ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Send a test event" description="Sandbox only. Sends a clearly-flagged event (test: true, application ARAF-TEST-000000, order TEST-ORDER) to every active endpoint subscribed to that type." />
      <form
        className="space-y-4 px-5 py-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setSent(null);
          try {
            const r = await api.post<{ event_id: string }>('/api/partner-portal/webhooks/test-event', { type });
            setSent(r.event_id);
            onSent();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Event type" className="min-w-[16rem] flex-1">
            {({ id }) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                {eventTypes.map((e) => (
                  <option key={e.type} value={e.type}>
                    {e.type}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" variant="gold" loading={busy} className="h-11">
            Send test event
          </Button>
        </div>
        <p className="text-xs text-muted">{eventTypes.find((e) => e.type === type)?.description}</p>
        {!hasEndpoints && <Alert tone="warning">You have no active endpoints, so the event will be recorded but not delivered.</Alert>}
        <div aria-live="polite">
          {sent && (
            <Alert tone="success" title="Test event queued">
              Event <Mono>{sent}</Mono> was created. Delivery status appears in the Event log within a few seconds.
            </Alert>
          )}
        </div>
        <FormError error={error} />
      </form>
    </Card>
  );
}
