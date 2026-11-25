'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Alert, Button, Field, Input } from '@araf/ui';
import { login, signup, type AuthState } from '@/app/actions/auth';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Email address" required error={state.fields?.email}>
        {({ id, describedBy, invalid }) => <Input id={id} name="email" type="email" autoComplete="email" defaultValue={state.values?.email} aria-describedby={describedBy} aria-invalid={invalid} required />}
      </Field>
      <Field label="Password" required error={state.fields?.password}>
        {({ id, describedBy, invalid }) => <Input id={id} name="password" type="password" autoComplete="current-password" aria-describedby={describedBy} aria-invalid={invalid} required />}
      </Field>
      <Button type="submit" size="lg" block loading={pending}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted">
        New to AltMall?{' '}
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="link">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <Field label="Full name" required error={state.fields?.name}>
        {({ id, describedBy, invalid }) => <Input id={id} name="name" autoComplete="name" defaultValue={state.values?.name} aria-describedby={describedBy} aria-invalid={invalid} required />}
      </Field>
      <Field label="Email address" required error={state.fields?.email}>
        {({ id, describedBy, invalid }) => <Input id={id} name="email" type="email" autoComplete="email" defaultValue={state.values?.email} aria-describedby={describedBy} aria-invalid={invalid} required />}
      </Field>
      <Field label="Mobile number" hint="Optional. Used for delivery updates, e.g. 0803 123 4567." error={state.fields?.phone}>
        {({ id, describedBy, invalid }) => <Input id={id} name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={state.values?.phone} aria-describedby={describedBy} aria-invalid={invalid} />}
      </Field>
      <Field label="Password" required hint="At least 10 characters, including a letter and a number." error={state.fields?.password}>
        {({ id, describedBy, invalid }) => <Input id={id} name="password" type="password" autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} required />}
      </Field>
      <Button type="submit" size="lg" block loading={pending}>
        Create account
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{' '}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="link">
          Sign in
        </Link>
      </p>
    </form>
  );
}
