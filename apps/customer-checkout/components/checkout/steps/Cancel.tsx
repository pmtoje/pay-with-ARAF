'use client';

import { useState } from 'react';
import { Button, Dialog } from '@araf/ui';
import { CANCELLABLE } from '@/lib/journey';
import { useAction, useCheckout } from '../context';
import { ErrorNotice } from '../ui';

export function CancelApplication() {
  const { api, base, view, summary } = useCheckout();
  const { busy, error, setError, run } = useAction();
  const [open, setOpen] = useState(false);
  if (!CANCELLABLE.has(view.state)) return null;
  const close = () => {
    setOpen(false);
    setError(null);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center text-xs font-medium text-muted underline underline-offset-2 hover:text-fg">
        Cancel application
      </button>
      <Dialog
        open={open}
        onClose={close}
        size="sm"
        title="Cancel this application?"
        description={`Your financing application will be closed and ${summary.partner.name} will be told it was cancelled. You can choose another payment method at the merchant.`}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={!!busy}>
              Keep my application
            </Button>
            <Button
              variant="danger"
              loading={busy === 'cancel'}
              onClick={() =>
                void run('cancel', async () => {
                  const v = await api.post(`${base}/cancel`);
                  setOpen(false);
                  return v;
                })
              }
            >
              Cancel application
            </Button>
          </>
        }
      >
        <ErrorNotice error={error} />
        {!error && <p className="text-sm text-muted">This cannot be undone.</p>}
      </Dialog>
    </>
  );
}
