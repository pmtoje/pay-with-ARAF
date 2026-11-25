'use client';

import { Fragment, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, CopyButton, DataTable, EmptyState, LoadingBlock, StatusBadge, cn, formatDateTime } from '@araf/ui';
import { api, qs, useApi } from '@/lib/api';
import type { ApiLog, WebhookEventRow } from '@/lib/types';
import { ErrorState, FormError, Mono, SelectFilter } from '../common';

export function EventLog({ eventTypes, canManage }: { eventTypes: Array<{ type: string }>; canManage: boolean }) {
  const [type, setType] = useState('');
  const { data, error, loading, reload } = useApi<{ data: WebhookEventRow[] }>(`/api/partner-portal/webhook-events${qs({ type: type || undefined })}`);
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<{ id: string; n?: number; error?: unknown } | null>(null);

  const retry = async (id: string) => {
    setRetrying(id);
    setRetryResult(null);
    try {
      const r = await api.post<{ queued_deliveries: number }>(`/api/partner-portal/webhook-events/${encodeURIComponent(id)}/retry`);
      setRetryResult({ id, n: r.queued_deliveries });
      setTimeout(reload, 2500);
    } catch (e) {
      setRetryResult({ id, error: e });
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Event log"
        description="The latest 100 events and their deliveries. Delivery is at-least-once with exponential backoff; failed deliveries are dead-lettered after 8 attempts."
        actions={
          <Button variant="secondary" size="sm" onClick={reload} loading={loading}>
            Refresh
          </Button>
        }
      />
      <div className="border-b border-border px-5 py-4">
        <SelectFilter label="Event type" className="max-w-xs" value={type} onChange={setType} options={[{ value: '', label: 'All event types' }, ...eventTypes.map((e) => ({ value: e.type, label: e.type }))]} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} title="Events could not be loaded" />
      ) : !data ? (
        <LoadingBlock rows={6} label="Loading events" />
      ) : data.data.length === 0 ? (
        <EmptyState title="No events yet" description="Events are created as applications progress. In the sandbox you can send a test event from the Webhooks tab." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Webhook events</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-subtle">
                <th scope="col" className="px-4 py-2.5">Event</th>
                <th scope="col" className="px-4 py-2.5">Created</th>
                <th scope="col" className="px-4 py-2.5">Application / order</th>
                <th scope="col" className="px-4 py-2.5">Deliveries</th>
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((ev) => {
                const isOpen = open === ev.id;
                const ok = ev.deliveries.filter((d) => d.status === 'SUCCEEDED').length;
                const isTest = (ev.payload as { test?: boolean }).test === true;
                return (
                  <Fragment key={ev.id}>
                    <tr className={cn('border-b border-border', isOpen && 'bg-surface-2')}>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Mono className="font-medium">{ev.event}</Mono>
                          {isTest && <Badge tone="warning">Test</Badge>}
                        </div>
                        <Mono className="text-2xs text-subtle">{ev.id}</Mono>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(ev.created_at)}</td>
                      <td className="px-4 py-3">
                        <Mono>{ev.application_reference ?? '—'}</Mono>
                        <br />
                        <Mono className="text-muted">{ev.merchant_order_reference ?? ''}</Mono>
                      </td>
                      <td className="px-4 py-3">
                        {ev.deliveries.length === 0 ? (
                          <span className="text-muted">No subscribed endpoint</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {[...new Set(ev.deliveries.map((d) => d.status))].map((s) => (
                              <StatusBadge key={s} status={s} label={`${ev.deliveries.filter((d) => d.status === s).length} ${s.toLowerCase().replace(/_/g, ' ')}`} />
                            ))}
                            <span className="sr-only">
                              {ok} of {ev.deliveries.length} succeeded
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" aria-expanded={isOpen} aria-controls={`ev-${ev.id}`} onClick={() => setOpen(isOpen ? null : ev.id)}>
                          {isOpen ? 'Hide' : 'Details'}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`ev-${ev.id}`} className="border-b border-border bg-surface-2/50">
                        <td colSpan={5} className="space-y-4 px-4 py-4">
                          {ev.deliveries.length > 0 && (
                            <div className="overflow-x-auto rounded-md border border-border bg-surface">
                              <DataTable
                                dense
                                caption="Deliveries"
                                rows={ev.deliveries}
                                rowKey={(d) => d.id}
                                columns={[
                                  { key: 'ep', header: 'Endpoint', cell: (d) => <span className="break-all font-mono text-xs">{d.endpoint}</span> },
                                  { key: 'st', header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
                                  { key: 'att', header: 'Attempts', align: 'right', cell: (d) => d.attempts },
                                  { key: 'code', header: 'Last code', cell: (d) => (d.last_status_code ? <Mono>{d.last_status_code}</Mono> : '—') },
                                  { key: 'err', header: 'Last error', cell: (d) => <span className="text-xs text-danger">{d.last_error ?? ''}</span> },
                                  { key: 'next', header: 'Next attempt', cell: (d) => <span className="whitespace-nowrap text-xs text-muted">{d.next_attempt_at ? formatDateTime(d.next_attempt_at) : '—'}</span> },
                                  { key: 'ok', header: 'Succeeded', cell: (d) => <span className="whitespace-nowrap text-xs text-muted">{d.succeeded_at ? formatDateTime(d.succeeded_at) : '—'}</span> },
                                ]}
                              />
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            {canManage && (
                              <Button size="sm" onClick={() => retry(ev.id)} loading={retrying === ev.id}>
                                Retry delivery
                              </Button>
                            )}
                            <CopyButton value={JSON.stringify(ev.payload, null, 2)} label="Copy payload" />
                            <span aria-live="polite" className="text-sm text-muted">
                              {retryResult?.id === ev.id && retryResult.n !== undefined && `${retryResult.n} delivery(ies) queued.`}
                            </span>
                          </div>
                          {retryResult?.id === ev.id && retryResult.error ? <FormError error={retryResult.error} /> : null}
                          <pre className="max-h-80 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-fg">{JSON.stringify(ev.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ApiRequestLog() {
  const [errorsOnly, setErrorsOnly] = useState(false);
  const { data, error, loading, reload } = useApi<ApiLog[]>(`/api/partner-portal/api-logs${qs({ errors_only: errorsOnly ? 'true' : undefined })}`);
  return (
    <Card>
      <CardHeader
        title="API request log"
        description="The latest 200 requests made with your secret keys. Bodies are never logged. Quote the correlation ID when contacting support."
        actions={
          <Button variant="secondary" size="sm" onClick={reload} loading={loading}>
            Refresh
          </Button>
        }
      />
      <div className="border-b border-border px-5 py-3">
        <Checkbox label="Errors only (HTTP 4xx and 5xx)" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} title="Request log could not be loaded" />
      ) : !data ? (
        <LoadingBlock rows={6} label="Loading request log" />
      ) : (
        <DataTable
          caption="API requests"
          dense
          rows={data}
          rowKey={(r) => r.id}
          empty={<EmptyState title={errorsOnly ? 'No failed requests' : 'No API requests yet'} description="Requests authenticated with your API keys appear here." />}
          columns={[
            { key: 'at', header: 'Time', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.at)}</span>, sortValue: (r) => r.at },
            { key: 'req', header: 'Request', cell: (r) => <span className="whitespace-nowrap font-mono text-xs"><strong>{r.method}</strong> {r.path}</span> },
            { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status >= 500 ? 'danger' : r.status >= 400 ? 'warning' : 'success'}>{r.status}</Badge>, sortValue: (r) => r.status },
            { key: 'dur', header: 'Duration', align: 'right', cell: (r) => `${r.duration_ms} ms`, sortValue: (r) => r.duration_ms },
            { key: 'corr', header: 'Correlation ID', cell: (r) => <Mono className="text-xs text-muted">{r.correlation_id}</Mono> },
            { key: 'idem', header: 'Idempotency-Key', cell: (r) => <Mono className="text-xs text-muted">{r.idempotency_key ?? '—'}</Mono> },
          ]}
        />
      )}
    </Card>
  );
}
