import { Alert, Timeline, formatDateTime } from '@araf/ui';
import { cn } from '@/lib/cn';
import { syncOrderFromAraf, type OrderRow } from '@/lib/orders';
import { ARAF_OPEN, MILESTONES, PAYMENT_METHOD_LABEL, SHOPPER_ACTION, TERMINAL_NEGATIVE, milestoneIndex, statusCopy } from '@/lib/statuses';
import { PayWithArafMark } from '@/components/brand';
import { AutoRefresh, PayAnotherWay, RefreshButton, RetryAraf } from './OrderActions';

const toneBox: Record<string, string> = {
  gold: 'border-gold/40 bg-gold-soft/40',
  success: 'border-success/30 bg-success-soft/50',
  danger: 'border-danger/30 bg-danger-soft/50',
  warning: 'border-warning/30 bg-warning-soft/50',
  info: 'border-info/30 bg-info-soft/40',
  neutral: 'border-border bg-surface-2/50',
};

export async function ArafStatusPanel({ order: initial, fromAraf }: { order: OrderRow; fromAraf: boolean }) {
  const { order, remote, error } = await syncOrderFromAraf(initial);
  const status = order.araf_status;
  const copy = statusCopy(status);
  const paidElsewhere = order.payment_method !== 'araf';
  const terminal = status ? TERMINAL_NEGATIVE.includes(status) : false;
  const idx = milestoneIndex(status);
  const timeline = remote?.application?.timeline ?? [];
  const fulfilment = remote?.application?.fulfilment ?? [];
  const pollable = !paidElsewhere && !!status && (ARAF_OPEN.includes(status) || status === 'READY_FOR_RELEASE' || status === 'DISPATCHED');

  return (
    <section className="rounded-lg border border-border bg-surface" aria-labelledby="araf-h">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <PayWithArafMark size="sm" />
          <span className="text-xs text-muted">Financing by The Alternative Bank</span>
        </div>
        <RefreshButton />
      </div>

      <div className="space-y-6 p-5">
        {fromAraf && !error && (
          <p className="text-sm text-muted" role="status">
            Welcome back. We confirmed this status directly with Pay with ARAF — returning from the Pay with ARAF page is never treated as proof of approval or payment.
          </p>
        )}
        {error && (
          <Alert tone="warning" title="We couldn’t reach Pay with ARAF just now">
            Showing the last status we received{order.araf_last_synced_at ? ` (${formatDateTime(order.araf_last_synced_at)})` : ''}. Try refreshing in a moment.
          </Alert>
        )}

        <div className={cn('rounded-lg border p-5', toneBox[paidElsewhere ? 'success' : copy.tone])} aria-live="polite">
          <h2 id="araf-h" className="text-xl font-semibold tracking-tight text-fg">
            {paidElsewhere ? `Paid by ${PAYMENT_METHOD_LABEL[order.payment_method]}` : copy.label}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {paidElsewhere ? 'Pay with ARAF financing didn’t complete for this order, so you paid another way. Your order is confirmed.' : copy.shopper}
          </p>
          {order.cancel_reason && <p className="mt-2 text-sm text-fg">AltMall cancelled this order: {order.cancel_reason}. Nothing further is needed from you.</p>}
          {!paidElsewhere && order.araf_checkout_url && status && SHOPPER_ACTION.includes(status) && (
            <a href={order.araf_checkout_url} className="btn-araf mt-4">
              Continue your application
            </a>
          )}
          {!paidElsewhere && order.araf_checkout_url && status && ARAF_OPEN.includes(status) && !SHOPPER_ACTION.includes(status) && (
            <a href={order.araf_checkout_url} className="btn-outline mt-4 h-11 text-sm">
              View in Pay with ARAF
            </a>
          )}
          {!paidElsewhere && !status && order.status === 'FINANCING_FAILED' && (
            <p className="mt-2 text-sm text-warning">Pay with ARAF couldn’t be started for this order.</p>
          )}
        </div>

        {!paidElsewhere && !order.cancel_reason && (terminal || (!status && order.status === 'FINANCING_FAILED')) && (
          <div className="space-y-4">
            <PayAnotherWay reference={order.reference} />
            {(status === 'EXPIRED' || status === 'CANCELLED' || !status) && <RetryAraf reference={order.reference} />}
          </div>
        )}

        {!paidElsewhere && !terminal && status && (
          <div>
            <h3 className="text-sm font-semibold text-fg">Progress</h3>
            <ol className="mt-3 grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-8" aria-label="Financing progress">
              {MILESTONES.map((m, i) => {
                const state = i < idx ? 'done' : i === idx ? 'current' : 'todo';
                return (
                  <li key={m.key} className="min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
                    <span className={cn('block h-1.5 rounded-full', state === 'todo' ? 'bg-border' : status === 'ON_HOLD' ? 'bg-warning' : 'bg-mall')} />
                    <span className={cn('mt-1.5 block text-2xs leading-tight sm:text-xs', state === 'todo' ? 'text-subtle' : 'font-medium text-fg')}>
                      <span className="sr-only">{state === 'done' ? 'Done: ' : state === 'current' ? 'Current: ' : 'Upcoming: '}</span>
                      {m.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {timeline.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-fg">History from Pay with ARAF</h3>
            <div className="mt-3 pl-2">
              <Timeline
                items={[...timeline].reverse().map((t) => {
                  const c = statusCopy(t.status);
                  const f = t.status === 'DISPATCHED' ? fulfilment.find((x) => x.status === 'DISPATCHED' || x.status === 'COLLECTED') : null;
                  return {
                    title: c.label,
                    meta: formatDateTime(t.at),
                    description: f?.tracking_reference ? `Tracking reference ${f.tracking_reference}` : undefined,
                    tone: c.tone === 'danger' ? 'danger' : c.tone === 'warning' ? 'warning' : c.tone === 'success' ? 'success' : undefined,
                  };
                })}
              />
            </div>
          </div>
        )}

        <dl className="grid grid-cols-1 gap-3 border-t border-border pt-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-subtle">Application reference</dt>
            <dd className="mt-0.5 font-mono text-fg">{order.araf_application_reference ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-subtle">Last confirmed with Pay with ARAF</dt>
            <dd className="mt-0.5 text-fg">{order.araf_last_synced_at ? formatDateTime(order.araf_last_synced_at) : '—'}</dd>
          </div>
        </dl>
      </div>
      {pollable && <AutoRefresh intervalMs={fromAraf ? 4000 : 10000} />}
    </section>
  );
}
