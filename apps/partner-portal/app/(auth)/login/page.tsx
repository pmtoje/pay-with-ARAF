'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, Input, OtpInput } from '@araf/ui';
import { api, isApiError } from '@/lib/api';
import { FormError } from '@/components/common';
import { AuthFrame } from '../auth-frame';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [next, setNext] = useState('/');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const n = q.get('next');
    // Only same-origin relative paths (prevents open redirects).
    if (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login')) setNext(n);
    if (q.get('signed_out')) setNotice('You have been signed out.');
    if (q.get('activated')) setNotice('Your account is active. Sign in with your password and a fresh authenticator code.');
  }, []);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/partner/login', { email: email.trim(), password });
      setStep('mfa');
      setNotice(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/partner/mfa', { code });
      router.replace(next);
    } catch (err) {
      setError(err);
      setCode('');
      // The pre-MFA session is gone (expired / revoked): restart.
      if (isApiError(err, 'UNAUTHENTICATED') || isApiError(err, 'SESSION_EXPIRED')) setStep('password');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (step === 'mfa' && code.length === 6 && !busy) void submitCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <AuthFrame
      title={step === 'password' ? 'Sign in to the Partner portal' : 'Two-step verification'}
      description={step === 'password' ? 'For merchant staff of approved Pay with ARAF partners.' : 'Enter the 6-digit code from your authenticator app.'}
      footer="Access is restricted to invited partner staff. Every action is audited."
    >
      {notice && (
        <Alert tone="info" className="mb-4">
          {notice}
        </Alert>
      )}
      {step === 'password' ? (
        <form onSubmit={submitPassword} className="space-y-4" noValidate>
          <Field label="Work email" required>
            {({ id }) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Password" required>
            {({ id }) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <FormError error={error} />
          {isApiError(error, 'MFA_REQUIRED') && <p className="text-sm text-muted">Finish enrolment from the invitation link sent to your email before signing in.</p>}
          <Button type="submit" block size="lg" loading={busy} disabled={!email || !password}>
            Continue
          </Button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-5">
          <OtpInput value={code} onChange={setCode} disabled={busy} label="Authenticator code" />
          <FormError error={error} />
          <p className="text-xs text-muted">Each code can be used once. If a code is rejected, wait for the next one to appear.</p>
          <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6}>
            Verify and sign in
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
            onClick={() => {
              setStep('password');
              setCode('');
              setError(null);
            }}
          >
            Use a different account
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
