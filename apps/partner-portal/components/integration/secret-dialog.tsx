'use client';

import { useState, type ReactNode } from 'react';
import { Alert, Button, Checkbox, CopyButton, Dialog } from '@araf/ui';

/** Shows a newly issued secret exactly once. The user must acknowledge before closing. */
export function SecretDialog({ open, title, secret, warning, details, onClose }: { open: boolean; title: string; secret: string; warning?: string; details?: ReactNode; onClose: () => void }) {
  const [ack, setAck] = useState(false);
  const close = () => {
    setAck(false);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={() => ack && close()}
      title={title}
      size="lg"
      footer={
        <Button onClick={close} disabled={!ack}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning" title="Copy this secret now">
          {warning ?? 'Store it in your server-side secret manager. It will not be shown again.'} Never put it in browser or mobile app code, and never share it in chat or email.
        </Alert>
        <div className="rounded-md border border-border-strong bg-surface-2 p-4">
          <p className="break-all font-mono text-sm font-semibold text-fg" data-testid="one-time-secret">
            {secret}
          </p>
          <div className="mt-3">
            <CopyButton value={secret} label="Copy secret" />
          </div>
        </div>
        {details}
        <Checkbox label="I have stored this secret securely" checked={ack} onChange={(e) => setAck(e.target.checked)} />
      </div>
    </Dialog>
  );
}
