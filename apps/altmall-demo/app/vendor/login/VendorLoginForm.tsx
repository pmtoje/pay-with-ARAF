'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@araf/ui';
import { vendorLogin } from '../actions';

export function VendorLoginForm() {
  const [state, action, pending] = useActionState(vendorLogin, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Console password" required>
        {({ id, describedBy, invalid }) => <Input id={id} name="password" type="password" autoComplete="current-password" aria-describedby={describedBy} aria-invalid={invalid} required />}
      </Field>
      <Button type="submit" size="lg" block loading={pending}>
        Open console
      </Button>
    </form>
  );
}
