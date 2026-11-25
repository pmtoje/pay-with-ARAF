'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, DataTable, Dialog, EmptyState, Field, Input, KeyValue, LoadingBlock, PageHeader, Textarea, formatDateTime, formatNaira, humanize } from '@araf/ui';
import { api, useApi } from '@/lib/api';
import type { ApplicationRow, Paged, ReleaseItem } from '@/lib/types';
import { ErrorState, FormError, Mono, SimulatedBadge, useToast } from '@/components/common';
import { RequirePermission } from '@/components/gate';
import { ReleaseVerdict } from '@/components/release-verdict';

type Action =
  | { kind: 'prepared' | 'dispatch' | 'collected'; item: ReleaseItem }
  | { kind: 'delivered' | 'exception'; order: string; reference: string };

export default function ReleasePage() {
  return (
    <RequirePermission perm="p.fulfilment.manage">
      <ReleaseInner />
    </RequirePermission>
  );
}

function ReleaseInner() {
  const queue = useApi<ReleaseItem[]>('/api/partner-portal/release-queue');
  const dispatched = useApi<Paged<ApplicationRow>>('/api/partner-portal/applications?range=all&status=DISPATCHED&page_size=100');
  const [action, setAction] = useState<Action | null>(null);
  const { toast, toastNode } = useToast();
  const reloadAll = () => {
    queue.reload();
    dispatched.reload();
  };
  const authorized = (queue.data ?? []).filter((r) => r.release_status === 'AUTHORIZED');
  const suspended = (queue.data ?? []).filter((r) => r.release_status !== 'AUTHORIZED');

  return (
    <>
      <PageHeader
        title="Ready for release"
        description="Orders the Bank has paid for and authorised you to hand over. Release goods only when the status below reads AUTHORISED — never on a customer screenshot, redirect or payment notice alone."
        actions={
          <Button variant="secondary" size="sm" onClick={reloadAll} loading={queue.loading || dispatched.loading}>
            Refresh
          </Button>
        }
      />
      {toastNode}

      <section aria-labelledby="queue-h" className="space-y-4">
        <h2 id="queue-h" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-subtle">
          Release queue {queue.data && <Badge>{queue.data.length}</Badge>}
        </h2>
        {queue.error ? (
          <Card>
            <ErrorState error={queue.error} onRetry={queue.reload} title="Release queue could not be loaded" />
          </Card>
        ) : !queue.data ? (
          <Card>
            <LoadingBlock rows={6} label="Loading release queue" />
          </Card>
        ) : queue.data.length === 0 ? (
          <Card>
            <EmptyState title="Nothing to release right now" description="Orders appear here once the Bank confirms the vendor payment and authorises release. You will also receive a goods.release_authorized webhook." />
          </Card>
        ) : (
          <div className="space-y-4">
            {[...suspended, ...authorized].map((item) => (
              <ReleaseCard key={item.release_reference} item={item} onAction={(kind) => setAction({ kind, item })} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="dispatched-h" className="mt-10">
        <Card>
          <CardHeader title={<span id="dispatched-h">Dispatched — awaiting delivery</span>} description="Confirm delivery once the customer has received the goods, or report a delivery exception to the Bank." />
          {dispatched.error ? (
            <ErrorState error={dispatched.error} onRetry={dispatched.reload} />
          ) : !dispatched.data ? (
            <LoadingBlock rows={4} label="Loading dispatched orders" />
          ) : (
            <DataTable
              caption="Dispatched orders awaiting delivery"
              rows={dispatched.data.data}
              rowKey={(r) => r.reference}
              empty={<EmptyState title="No orders in transit" description="Orders you dispatch appear here until delivery is confirmed." />}
              columns={[
                { key: 'order', header: 'Order', cell: (r) => <Mono className="font-medium">{r.merchant_order_reference ?? '—'}</Mono> },
                { key: 'app', header: 'Application', cell: (r) => <Link className="font-mono text-[13px] underline-offset-4 hover:underline" href={`/applications/${encodeURIComponent(r.reference)}`}>{r.reference}</Link> },
                { key: 'amount', header: 'Amount', align: 'right', cell: (r) => formatNaira(r.purchase_amount) },
                { key: 'since', header: 'Dispatched', cell: (r) => <span className="whitespace-nowrap text-muted">{formatDateTime(r.updated_at)}</span> },
                {
                  key: 'actions',
                  header: <span className="sr-only">Actions</span>,
                  align: 'right',
                  cell: (r) =>
                    r.merchant_order_reference ? (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => setAction({ kind: 'delivered', order: r.merchant_order_reference!, reference: r.reference })}>
                          Confirm delivery
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'exception', order: r.merchant_order_reference!, reference: r.reference })}>
                          Report exception
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
            />
          )}
        </Card>
      </section>

      <ActionDialog
        action={action}
        onClose={() => setAction(null)}
        onDone={(msg) => {
          setAction(null);
          toast(msg);
          reloadAll();
        }}
      />
    </>
  );
}

function ReleaseCard({ item, onAction }: { item: ReleaseItem; onAction: (k: 'prepared' | 'dispatch' | 'collected') => void }) {
  const ok = item.release_status === 'AUTHORIZED';
  return (
    <Card className={ok ? 'border-success/40' : 'border-danger/40'}>
      <div className="space-y-5 px-5 py-5">
        <ReleaseVerdict status={item.release_status} reason={item.suspension_reason} />
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-fg">
            Order <Mono className="text-base">{item.merchant_order_reference}</Mono>
          </h3>
          <SimulatedBadge simulated={item.simulated} />
          {item.prepared && <Badge tone="info">Prepared</Badge>}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Products to hand over</p>
            <ul className="mt-1.5 space-y-1 text-sm text-fg">
              {item.products.map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden="true" className="text-gold-strong">•</span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-subtle">Vendor</p>
            <p className="mt-1 text-sm text-fg">{item.vendor}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Customer delivery contact</p>
            <p className="mt-1 text-sm text-fg">{item.customer_contact.email ?? 'No email provided'}</p>
            <p className="text-sm text-fg">{item.customer_contact.phone ?? 'No phone provided'}</p>
          </div>
        </div>
        <KeyValue
          columns={3}
          items={[
            { label: 'Vendor payment', value: <span className="tabular-nums font-semibold">{formatNaira(item.payment_amount)}</span> },
            { label: 'Payment reference', value: item.payment_reference, mono: true },
            { label: 'Payment status', value: humanize(item.payment_status) },
            { label: 'Release reference', value: item.release_reference, mono: true },
            { label: 'Authorised at', value: formatDateTime(item.authorized_at) },
            { label: 'Application', value: <Link className="font-mono text-[13px] underline-offset-4 hover:underline" href={`/applications/${encodeURIComponent(item.application_reference)}`}>{item.application_reference}</Link> },
          ]}
        />
        {ok ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="secondary" onClick={() => onAction('prepared')} disabled={item.prepared}>
              {item.prepared ? 'Marked prepared' : 'Mark prepared'}
            </Button>
            <Button variant="gold" onClick={() => onAction('dispatch')}>
              Confirm dispatch
            </Button>
            <Button variant="secondary" onClick={() => onAction('collected')}>
              Customer collected
            </Button>
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-sm font-medium text-danger">Fulfilment actions are disabled while the release is suspended.</p>
        )}
      </div>
    </Card>
  );
}

function ActionDialog({ action, onClose, onDone }: { action: Action | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [tracking, setTracking] = useState('');
  const [carrier, setCarrier] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reset = () => {
    setTracking('');
    setCarrier('');
    setNote('');
    setError(null);
  };
  if (!action) return null;
  const order = 'item' in action ? action.item.merchant_order_reference : action.order;
  const meta = {
    prepared: { title: 'Mark order as prepared', cta: 'Mark prepared', ok: 'Order marked as prepared.' },
    dispatch: { title: 'Confirm dispatch', cta: 'Confirm dispatch', ok: 'Dispatch confirmed. The release authorisation has been used.' },
    collected: { title: 'Customer collected the goods', cta: 'Confirm collection', ok: 'Collection recorded and delivery completed.' },
    delivered: { title: 'Confirm delivery', cta: 'Confirm delivery', ok: 'Delivery confirmed.' },
    exception: { title: 'Report a delivery exception', cta: 'Report exception', ok: 'Delivery exception reported to the Bank.' },
  }[action.kind];
  const needsNote = action.kind === 'exception';
  const submit = async () => {
    setBusy(true);
    setError(null);
    const path = `/api/partner-portal/orders/${encodeURIComponent(order)}`;
    try {
      if (action.kind === 'delivered' || action.kind === 'exception') {
        await api.post(`${path}/deliver`, { note: note.trim() || undefined, exception: action.kind === 'exception' ? true : undefined });
      } else {
        await api.post(`${path}/fulfil`, {
          status: action.kind === 'prepared' ? 'PREPARED' : action.kind === 'dispatch' ? 'DISPATCHED' : 'COLLECTED',
          tracking_reference: action.kind === 'dispatch' && tracking.trim() ? tracking.trim() : undefined,
          carrier: action.kind === 'dispatch' && carrier.trim() ? carrier.trim() : undefined,
          note: note.trim() || undefined,
        });
      }
      reset();
      onDone(meta.ok);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title={meta.title}
      description={<>Order <Mono>{order}</Mono></>}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant={action.kind === 'exception' ? 'danger' : 'primary'} loading={busy} disabled={needsNote && note.trim().length < 3} onClick={submit}>
            {meta.cta}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(action.kind === 'dispatch' || action.kind === 'collected') && (
          <p className="text-sm text-muted">Recording {action.kind === 'dispatch' ? 'dispatch' : 'collection'} consumes the release authorisation and notifies the customer. This cannot be undone.</p>
        )}
        {action.kind === 'dispatch' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tracking reference" hint="Optional, up to 120 characters">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={120} value={tracking} onChange={(e) => setTracking(e.target.value)} />}
            </Field>
            <Field label="Carrier" hint="e.g. GIG Logistics">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={120} value={carrier} onChange={(e) => setCarrier(e.target.value)} />}
            </Field>
          </div>
        )}
        <Field label={needsNote ? 'What went wrong?' : 'Note'} required={needsNote} hint={needsNote ? 'The Bank’s operations team will follow up.' : 'Optional, up to 500 characters'}>
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <FormError error={error} />
      </div>
    </Dialog>
  );
}
