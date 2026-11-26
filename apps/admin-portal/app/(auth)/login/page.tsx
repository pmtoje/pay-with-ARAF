'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, ApiError, Button, Card, Field, Input, OtpInput } from '@araf/ui';
import { authApi } from '@/lib/api';
import { useQueryParam } from '@/lib/hooks';
import { ErrorAlert } from '@/components/common';

const SSO_ERRORS: Record<string, string> = {
  DOMAIN: 'Only Bank staff accounts (@altbank.ng) can sign in here.',
  NOT_PROVISIONED: 'Your ARAF sign-in worked, but you do not have a Pay with ARAF admin account yet. Ask an administrator to give you a role.',
  DENIED: 'Your account is not active in Pay with ARAF.',
  STATE: 'The sign-in link expired. Please try again.',
  EXCHANGE: 'ARAF could not confirm your sign-in. Please try again.',
  UNAVAILABLE: 'ARAF is not reachable right now. Please try again shortly.',
  DISABLED: 'Sign in with ARAF is not enabled.',
};

const REASONS: Record<string, { tone: 'info' | 'warning'; text: string }> = {
  SESSION_EXPIRED: { tone: 'warning', text: 'Your session expired. Sign in again to continue where you left off.' },
  UNAUTHENTICATED: { tone: 'warning', text: 'Your session has ended. Sign in again to continue.' },
  MFA_REQUIRED: { tone: 'info', text: 'Complete two-factor verification to continue.' },
  SIGNED_OUT: { tone: 'info', text: 'You have signed out.' },
  ACTIVATED: { tone: 'info', text: 'Your account is active. Sign in with your new password and authenticator code.' },
};

function safeNext(n: string | null): string {
  if (!n || !n.startsWith('/') || n.startsWith('//') || n.startsWith('/login')) return '/';
  return n;
}

export default function LoginPage() {
  const router = useRouter();
  const next = useQueryParam('next');
  const reason = useQueryParam('reason');
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ssoError = useQueryParam('sso_error');
  const [sso, setSso] = useState<{ enabled: boolean; email_domains: string[] } | null>(null);

  useEffect(() => {
    document.title = 'Sign in · Pay with ARAF admin';
    fetch('/api/auth/admin/sso/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(setSso).catch(() => setSso(null));
  }, []);

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.post('/api/auth/admin/login', { email: email.trim(), password });
      setStep('mfa');
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.post('/api/auth/admin/mfa', { code: value });
      router.replace(safeNext(next));
    } catch (err) {
      setError(err);
      setCode('');
      if (err instanceof ApiError && ['SESSION_EXPIRED', 'UNAUTHENTICATED'].includes(err.code)) setStep('credentials');
    } finally {
      setBusy(false);
    }
  };

  const notice = reason ? REASONS[reason] : undefined;

  return (
    <Card className="p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">Bank administration</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{step === 'credentials' ? 'Sign in' : 'Two-factor verification'}</h1>
      <p className="mt-1 text-sm text-muted">
        {step === 'credentials' ? 'Use your Alternative Bank staff account.' : 'Enter the 6-digit code from your authenticator app.'}
      </p>

      {notice && step === 'credentials' && <Alert tone={notice.tone} className="mt-5">{notice.text}</Alert>}
      <div aria-live="assertive" className="mt-5 empty:hidden">
        {error ? <ErrorAlert error={error} title={step === 'mfa' ? 'Verification failed' : 'Sign-in failed'} /> : null}
      </div>

      {ssoError && step === 'credentials' && <Alert tone="warning" className="mt-5">{SSO_ERRORS[ssoError] ?? 'Sign in with ARAF did not complete.'}</Alert>}
      {step === 'credentials' && sso?.enabled && (
        <div className="mt-5 space-y-3">
          <a href="/api/auth/admin/sso/start" className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-ink-contrast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            Sign in with ARAF (@{sso.email_domains[0] ?? 'altbank.ng'})
          </a>
          <p className="text-center text-xs text-muted">Uses your AltBank Retail Asset Factory account and email code.</p>
          <div className="flex items-center gap-3 text-xs text-subtle"><span className="h-px flex-1 bg-border" />or sign in with a Pay with ARAF account<span className="h-px flex-1 bg-border" /></div>
        </div>
      )}
      {step === 'credentials' ? (
        <form className="mt-5 space-y-4" onSubmit={submitCredentials} noValidate>
          <Field label="Work email" required>
            {(ids) => <Input id={ids.id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={ids.describedBy} />}
          </Field>
          <Field label="Password" required>
            {(ids) => <Input id={ids.id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={ids.describedBy} />}
          </Field>
          <Button type="submit" block size="lg" loading={busy} disabled={!email || !password}>Continue</Button>
        </form>
      ) : (
        <form
          className="mt-5 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          <OtpInput
            value={code}
            disabled={busy}
            label="Authenticator code"
            onChange={(v) => {
              setCode(v);
              if (v.length === 6) void submitCode(v);
            }}
          />
          <p className="text-xs text-muted">Codes refresh every 30 seconds and can be used once. If a code is rejected, wait for the next one.</p>
          <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6}>Verify and sign in</Button>
          <button type="button" className="w-full text-center text-sm text-muted hover:text-fg" onClick={() => { setStep('credentials'); setError(null); }}>
            Use a different account
          </button>
        </form>
      )}
    </Card>
  );
}
