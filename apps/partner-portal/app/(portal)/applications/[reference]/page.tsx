'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Alert, Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, KeyValue, LoadingBlock, PageHeader, Select, StatusBadge, Textarea, Timeline, formatDateTime, formatNaira, humanize, statusTone } from '@araf/ui';
import { api, useApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { MERCHANT_STATUS_LABEL, type ApplicationDetail } from '@/lib/types';
import { ErrorState, FormError, Mono, SimulatedBadge, useToast } from '@/components/common';
import { RequirePermission } from '@/components/gate';
import { ReleaseVerdict } from '@/components/release-verdict';

const RETURN_TYPES = [
  { value: 'FULL_RETURN', label: 'Full return' },
  { value: 'PARTIAL_RETURN', label: 'Partial return' },
  { value: 'DAMAGED', label: 'Damaged item' },
  { value: 'INCORRECT_PRODUCT', label: 'Incorrect product' },
  { value: 'NON_DELIVERY', label: 'Non-delivery' },
];

/** Statuses from which a merchant may still ask to cancel (the API makes the final decision). */
const CANCELLABLE = ['CUSTOMER_ACTION_REQUIRED', 'IN_PROGRESS', 'UNDER_REVIEW', 'ELIGIBLE', 'SUBMITTED', 'APPROVED', 'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED', 'READY_FOR_RELEASE', 'ON_HOLD'];
/** API: return requests require RELEASE_AUTHORIZED, GOODS_DISPATCHED, GOODS_DELIVERED or COMPLETED. */
const RETURNABLE = ['READY_FOR_RELEASE', 'DISPATCHED', 'DELIVERED', 'COMPLETED'];
const PAID = ['VENDOR_PAYMENT_CONFIRMED', 'READY_FOR_RELEASE', 'VENDOR_PAYMENT_PENDING', 'ON_HOLD'];

export default function ApplicationDetailPage() {
  return (
    <RequirePermission perm="p.application.read">
      <DetailInner />
    </RequirePermission>
  );
}

function DetailInner() {
  const { reference } = useParams<{ reference: string }>();
  const ref = decodeURIComponent(reference);
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<ApplicationDetail>(`/api/partner-portal/applications/${encodeURIComponent(ref)}`);
  const [dialog, setDialog] = useState<'cancel' | 'return' | null>(null);
  const { toast, toastNode } = useToast();

  if (error) {
    return (
      <>
        <BackLink />
        <Card>
          <ErrorState error={error} onRetry={reload} title="Application could not be loaded" />
        </Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <BackLink />
        <Card>
          <LoadingBlock rows={8} label="Loading application" />
        </Card>
      </>
    );
  }

  const paymentConfirmed = data.vendor_payment?.status === 'CONFIRMED';
  const canCancel = can('p.refund.request') && CANCELLABLE.includes(data.status);
  const canReturn = can('p.refund.request') && RETURNABLE.includes(data.status);

  const timeline = [
    ...data.timeline.map((t) => ({ at: t.at, title: MERCHANT_STATUS_LABEL[t.status] ?? humanize(t.status), tone: statusTone(t.status), description: undefined as string | undefined })),
    ...data.fulfilment.map((f) => ({ at: f.at, title: `Fulfilment: ${humanize(f.status)}`, tone: statusTone(f.status), description: f.tracking_reference ? `Tracking ${f.tracking_reference}` : undefined })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <>
      <BackLink />
      <PageHeader
        eyebrow="Application"
        title={<span className="font-mono">{data.reference}</span>}
        description={<>Order <Mono>{data.merchant_order_reference}</Mono></>}
        actions={
          <>
            <StatusBadge status={data.status} label={MERCHANT_STATUS_LABEL[data.status]} />
            {!data.livemode && <Badge tone="warning">Sandbox</Badge>}
            <Button variant="secondary" size="sm" onClick={reload} loading={loading}>
              Refresh
            </Button>
          </>
        }
      />
      {toastNode}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Goods release" description="The only authority to hand over goods. Verify server-side with GET /api/v1/releases/{reference}." />
            <div className="space-y-4 px-5 py-5">
              <ReleaseVerdict status={data.release.status} />
              <KeyValue
                columns={3}
                items={[
                  { label: 'Release reference', value: data.release.reference ?? '—', mono: true },
                  { label: 'Release status', value: data.release.status ? humanize(data.release.status) : 'Not issued' },
                  { label: 'Authorised', value: data.release.authorized ? 'Yes' : 'No' },
                  { label: 'Authorised at', value: formatDateTime(data.release.authorized_at ?? null) },
                ]}
              />
              {data.status === 'READY_FOR_RELEASE' && can('p.fulfilment.manage') && (
                <Link href="/release" className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-ink-contrast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  Manage dispatch in the release queue →
                </Link>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Order & amounts" />
            <div className="px-5 py-5">
              <KeyValue
                columns={3}
                items={[
                  { label: 'Merchant status', value: <StatusBadge status={data.status} label={MERCHANT_STATUS_LABEL[data.status]} /> },
                  { label: 'Order reference', value: data.merchant_order_reference, mono: true },
                  { label: 'Checkout session', value: data.checkout_session_id, mono: true },
                  { label: 'Purchase amount', value: <span className="tabular-nums">{formatNaira(data.purchase_amount)}</span> },
                  { label: 'Customer contribution', value: <span className="tabular-nums">{formatNaira(data.customer_contribution)}</span> },
                  { label: 'Currency', value: data.currency },
                  { label: 'Created', value: formatDateTime(data.created_at) },
                  { label: 'Last updated', value: formatDateTime(data.updated_at) },
                  { label: 'Environment', value: data.livemode ? 'Production' : 'Sandbox' },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Vendor payment" description="Paid by the Bank to the vendor's verified settlement account. Payment alone does not authorise release." />
            <div className="px-5 py-5">
              {data.vendor_payment ? (
                <KeyValue
                  columns={3}
                  items={[
                    { label: 'Payment reference', value: data.vendor_payment.reference, mono: true },
                    { label: 'Status', value: <span className="inline-flex items-center gap-2"><StatusBadge status={data.vendor_payment.status} /><SimulatedBadge simulated={data.vendor_payment.simulated} /></span> },
                    { label: 'Amount', value: <span className="tabular-nums">{formatNaira(data.vendor_payment.amount)}</span> },
                    { label: 'Confirmed at', value: formatDateTime(data.vendor_payment.confirmed_at) },
                  ]}
                />
              ) : (
                <p className="text-sm text-muted">No vendor payment yet. Payment is made only after financing is approved and booked.</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {(canCancel || canReturn) && (
            <Card>
              <CardHeader title="Order actions" />
              <div className="space-y-3 px-5 py-5">
                {canCancel && (
                  <div>
                    <Button variant="secondary" block onClick={() => setDialog('cancel')}>
                      Cancel order
                    </Button>
                    {(paymentConfirmed || PAID.includes(data.status)) && <p className="mt-1.5 text-xs text-muted">The vendor has been or is being paid — cancelling becomes a reversal request reviewed by the Bank.</p>}
                  </div>
                )}
                {canReturn && (
                  <Button variant="secondary" block onClick={() => setDialog('return')}>
                    Request return
                  </Button>
                )}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Timeline" description="Merchant-visible status history" />
            <div className="px-6 py-5">
              {timeline.length ? <Timeline items={timeline.map((t) => ({ title: t.title, meta: formatDateTime(t.at), tone: t.tone, description: t.description }))} /> : <EmptyState title="No history yet" />}
            </div>
          </Card>
          <Card>
            <CardHeader title="Fulfilment" />
            <div className="px-5 py-4">
              {data.fulfilment.length === 0 ? (
                <p className="text-sm text-muted">No fulfilment recorded.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.fulfilment.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span>
                        <StatusBadge status={f.status} />
                        {f.tracking_reference && <Mono className="ml-2 text-muted">{f.tracking_reference}</Mono>}
                      </span>
                      <span className="text-xs text-subtle">{formatDateTime(f.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

      <CancelDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        orderRef={data.merchant_order_reference}
        paid={paymentConfirmed || PAID.includes(data.status)}
        onDone={(res) => {
          setDialog(null);
          toast(res.requires_reversal ? 'Cancellation requested — the Bank will review the reversal. Release is suspended.' : 'Order cancelled.');
          reload();
        }}
      />
      <ReturnDialog
        open={dialog === 'return'}
        onClose={() => setDialog(null)}
        orderRef={data.merchant_order_reference}
        onDone={() => {
          setDialog(null);
          toast('Return requested. The Bank will review it.');
          reload();
        }}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/applications" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
      ← All applications
    </Link>
  );
}

function CancelDialog({ open, onClose, orderRef, paid, onDone }: { open: boolean; onClose: () => void; orderRef: string; paid: boolean; onDone: (r: { status: string; requires_reversal: boolean }) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tooShort = reason.trim().length < 3;
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Cancel this order?"
      description={<>Order <Mono>{orderRef}</Mono></>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep order
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={tooShort}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onDone(await api.post<{ status: string; requires_reversal: boolean }>(`/api/partner-portal/orders/${encodeURIComponent(orderRef)}/cancel`, { reason: reason.trim() }));
                setReason('');
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {paid ? 'Request cancellation' : 'Cancel order'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {paid ? (
          <Alert tone="warning" title="This becomes a reversal request">
            The Bank has paid (or is paying) the vendor. Cancelling now suspends any release authorisation and opens a reversal request: the vendor must refund the Bank before the cancellation completes. Do not release the goods.
          </Alert>
        ) : (
          <Alert tone="info">Before the vendor is paid, cancellation takes effect immediately and the customer’s financing application is closed.</Alert>
        )}
        <Field label="Reason" required hint="Shared with the Bank's operations team (3–500 characters).">
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <FormError error={error} />
      </div>
    </Dialog>
  );
}

function ReturnDialog({ open, onClose, orderRef, onDone }: { open: boolean; onClose: () => void; orderRef: string; onDone: () => void }) {
  const [type, setType] = useState('FULL_RETURN');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Request a return"
      description={<>Order <Mono>{orderRef}</Mono> · the Bank reviews every return before any refund.</>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.post(`/api/partner-portal/orders/${encodeURIComponent(orderRef)}/return`, { type, reason: reason.trim() });
                setReason('');
                onDone();
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Submit return request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Return type" required>
          {({ id }) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {RETURN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" required hint="3–500 characters.">
          {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <FormError error={error} />
      </div>
    </Dialog>
  );
}
