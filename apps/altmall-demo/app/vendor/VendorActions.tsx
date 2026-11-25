'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Alert, Button, Dialog, Field, Input, Textarea } from '@araf/ui';
import { cancelOrder, deliverOrder, dispatchOrder, refreshOrder, setFailureCounter, type ActionResult } from './actions';

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = async (key: string, fn: () => Promise<ActionResult>) => {
    setBusy(key);
    setResult(null);
    try {
      const r = await fn();
      setResult(r);
      router.refresh();
      return r;
    } catch {
      const r = { ok: false as const, message: 'Something went wrong. Please try again.' };
      setResult(r);
      return r;
    } finally {
      setBusy(null);
    }
  };
  return { busy, result, run, setResult };
}

export function OrderRowActions({ reference, canDispatch, canDeliver, canCancel, blockedReason }: { reference: string; canDispatch: boolean; canDeliver: boolean; canCancel: boolean; blockedReason: string | null }) {
  const { busy, result, run, setResult } = useRun();
  const [dialog, setDialog] = useState<null | 'dispatch' | 'deliver' | 'cancel'>(null);
  const [carrier, setCarrier] = useState('AltMall Logistics');
  const [tracking, setTracking] = useState(`TRK-${reference.slice(-6)}`);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const blockedId = useId();

  const submitDialog = async (key: string, fn: () => Promise<ActionResult>) => {
    setDialogError(null);
    const r = await run(key, fn);
    if (r.ok) setDialog(null);
    else {
      setDialogError(r.message);
      setResult(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 lg:items-end">
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {canDeliver ? (
          <Button onClick={() => setDialog('deliver')}>Confirm delivery</Button>
        ) : !canDispatch && !blockedReason ? null : (
          <Button onClick={() => setDialog('dispatch')} disabled={!canDispatch} aria-describedby={!canDispatch && blockedReason ? blockedId : undefined}>
            Confirm dispatch
          </Button>
        )}
        <Button variant="secondary" loading={busy === 'refresh'} onClick={() => run('refresh', () => refreshOrder(reference))}>
          Refresh status
        </Button>
        {canCancel && (
          <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')}>
            Cancel order
          </Button>
        )}
      </div>
      {!canDispatch && !canDeliver && blockedReason && (
        <p id={blockedId} className="max-w-xs text-xs text-muted lg:text-right">
          {blockedReason}
        </p>
      )}
      <div aria-live="polite">
        {result && (
          <p className={`max-w-sm text-sm lg:text-right ${result.ok ? 'text-success' : 'text-danger'}`} role={result.ok ? 'status' : 'alert'}>
            {result.message}
          </p>
        )}
      </div>

      <Dialog
        open={dialog === 'dispatch'}
        onClose={() => setDialog(null)}
        title={`Confirm dispatch · ${reference}`}
        description="We re-check the release authorisation with Pay with ARAF before recording dispatch."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button loading={busy === 'dispatch'} onClick={() => submitDialog('dispatch', () => dispatchOrder(reference, carrier, tracking))}>
              Confirm dispatch
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <Field label="Carrier" required>
            {({ id, describedBy, invalid }) => <Input id={id} value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}
          </Field>
          <Field label="Tracking reference" required>
            {({ id, describedBy, invalid }) => <Input id={id} value={tracking} onChange={(e) => setTracking(e.target.value)} className="font-mono" aria-describedby={describedBy} aria-invalid={invalid} />}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'deliver'}
        onClose={() => setDialog(null)}
        title={`Confirm delivery · ${reference}`}
        description="Confirm that the shopper has received the goods. This completes the order in Pay with ARAF."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button loading={busy === 'deliver'} onClick={() => submitDialog('deliver', () => deliverOrder(reference))}>
              Confirm delivery
            </Button>
          </>
        }
      >
        {dialogError ? <Alert tone="danger">{dialogError}</Alert> : <p className="text-sm text-muted">Only confirm once the delivery has actually been handed over.</p>}
      </Dialog>

      <Dialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={`Cancel order · ${reference}`}
        description="Before the vendor is paid, the financing application is cancelled. After payment, cancellation becomes a controlled reversal managed by the Bank and release is suspended."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep order
            </Button>
            <Button variant="danger" loading={busy === 'cancel'} onClick={() => submitDialog('cancel', () => cancelOrder(reference, reason))}>
              Cancel order
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <Field label="Reason" required hint="Shared with The Alternative Bank (3–500 characters).">
            {({ id, describedBy, invalid }) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} placeholder="e.g. Item out of stock" />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

export function RefreshOrderButton({ reference }: { reference: string }) {
  const { busy, result, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" loading={busy === 'r'} onClick={() => run('r', () => refreshOrder(reference))}>
        Refresh status from ARAF
      </Button>
      {result && (
        <span className={`text-xs ${result.ok ? 'text-success' : 'text-danger'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </span>
      )}
    </span>
  );
}

export function FailureSimulator({ current }: { current: number }) {
  const { busy, result, run } = useRun();
  const [n, setN] = useState(String(current > 0 ? current : 3));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Simulate endpoint failure for next N deliveries" className="w-full sm:w-auto">
          {({ id, describedBy }) => <Input id={id} type="number" min={0} max={20} value={n} onChange={(e) => setN(e.target.value)} className="w-28" aria-describedby={describedBy} />}
        </Field>
        <Button loading={busy === 'set'} onClick={() => run('set', () => setFailureCounter(Number(n)))}>
          Apply
        </Button>
        {current > 0 && (
          <Button variant="secondary" loading={busy === 'clear'} onClick={() => run('clear', () => setFailureCounter(0))}>
            Stop failing
          </Button>
        )}
      </div>
      <div aria-live="polite">
        {result && (
          <p className={`text-sm ${result.ok ? 'text-success' : 'text-danger'}`} role={result.ok ? 'status' : 'alert'}>
            {result.message}
          </p>
        )}
      </div>
    </div>
  );
}
