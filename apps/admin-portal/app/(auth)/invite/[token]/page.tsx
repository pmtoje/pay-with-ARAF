'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, ApiError, Badge, Button, Card, CopyButton, Field, Input, LoadingBlock, OtpInput, Stepper, cn, TotpQr } from '@araf/ui';
import { authApi } from '@/lib/api';
import { roleLabel } from '@/lib/labels';
import { ErrorAlert } from '@/components/common';
import { Icon } from '@/components/icons';

interface InviteInfo { email: string; full_name: string; type: 'STAFF' | 'PARTNER'; partner_name: string | null; roles: string[] }

const RULES: Array<{ id: string; label: string; test: (p: string) => boolean }> = [
  { id: 'len', label: 'At least 12 characters', test: (p) => p.length >= 12 && p.length <= 128 },
  { id: 'upper', label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { id: 'digit', label: 'A number', test: (p) => /\d/.test(p) },
];

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState<{ totp_secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    document.title = 'Accept invitation · Pay with ARAF admin';
    authApi.get<InviteInfo>(`/api/auth/invitations/${encodeURIComponent(token)}`).then(setInfo).catch(setLoadError);
  }, [token]);

  const allOk = RULES.every((r) => r.test(password));
  const matches = password.length > 0 && password === confirm;

  const accept = async (e: FormEvent) => {
    e.preventDefault();
    if (!allOk || !matches) return;
    setBusy(true);
    setError(null);
    try {
      setTotp(await authApi.post(`/api/auth/invitations/${encodeURIComponent(token)}/accept`, { password }));
      setStep(1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.post(`/api/auth/invitations/${encodeURIComponent(token)}/activate`, { code: value });
      setStep(2);
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    const notFound = loadError instanceof ApiError && loadError.status === 404;
    return (
      <Card className="p-6 sm:p-8">
        <h1 className="text-xl font-semibold">Invitation unavailable</h1>
        <p className="mt-2 text-sm text-muted">
          {notFound ? 'This invitation link is invalid, has expired or has already been used. Ask your user manager to send a new invitation.' : 'We could not load this invitation.'}
        </p>
        {!notFound && <ErrorAlert error={loadError} className="mt-4" />}
        <Link href="/login" className="mt-6 inline-flex text-sm font-medium text-gold-strong hover:underline">Go to sign in</Link>
      </Card>
    );
  }
  if (!info) return <Card><LoadingBlock rows={5} label="Loading invitation" /></Card>;

  return (
    <Card className="p-6 sm:p-8">
      <Stepper steps={[{ id: 'pw', label: 'Set password' }, { id: 'mfa', label: 'Authenticator' }, { id: 'done', label: 'Activated' }]} current={step} />
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-gold-strong">{info.type === 'STAFF' ? 'Staff invitation' : `Partner invitation · ${info.partner_name ?? ''}`}</p>

      {step === 0 && (
        <>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Welcome, {info.full_name}</h1>
          <p className="mt-1 text-sm text-muted">Set a password for <span className="font-medium text-fg">{info.email}</span>.</p>
          <div className="mt-3 flex flex-wrap gap-1">{info.roles.map((r) => <Badge key={r} tone="gold">{roleLabel(r)}</Badge>)}</div>
          {info.type !== 'STAFF' && (
            <Alert tone="warning" className="mt-4">This is a partner invitation. After activation, sign in at the partner portal, not here.</Alert>
          )}
          <form className="mt-5 space-y-4" onSubmit={accept} noValidate>
            <Field label="New password" required>
              {(ids) => <Input id={ids.id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="pw-rules" />}
            </Field>
            <ul id="pw-rules" className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
              {RULES.map((r) => {
                const ok = r.test(password);
                return (
                  <li key={r.id} className={cn('flex items-center gap-1.5', ok ? 'text-success' : 'text-muted')}>
                    {ok ? Icon.check('h-3.5 w-3.5') : <span className="inline-block h-3.5 w-3.5 rounded-full border border-border-strong" aria-hidden="true" />}
                    <span>{r.label}<span className="sr-only">{ok ? ' — met' : ' — not met'}</span></span>
                  </li>
                );
              })}
            </ul>
            <Field label="Confirm password" required error={confirm && !matches ? 'Passwords do not match.' : null}>
              {(ids) => <Input id={ids.id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={ids.invalid} aria-describedby={ids.describedBy} />}
            </Field>
            <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Password not accepted" /> : null}</div>
            <Button type="submit" block size="lg" loading={busy} disabled={!allOk || !matches}>Set password</Button>
          </form>
        </>
      )}

      {step === 1 && totp && (
        <>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Set up two-factor authentication</h1>
          <p className="mt-1 text-sm text-muted">Scan the QR code with your authenticator app, then enter the 6-digit code it shows.</p>
          <div className="mt-5 space-y-3">
            <TotpQr uri={totp.otpauth_uri} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Can’t scan? Enter this key in the app</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider">{totp.totp_secret.match(/.{1,4}/g)?.join(' ')}</code>
                <CopyButton value={totp.totp_secret} />
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted">Show setup URI (otpauth)</summary>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-2xs">{totp.otpauth_uri}</code>
                <CopyButton value={totp.otpauth_uri} />
              </div>
            </details>
            <Alert tone="warning">The secret is shown only once. Do not share it or store it with your password.</Alert>
          </div>
          <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void activate(); }}>
            <OtpInput value={code} disabled={busy} label="Authenticator code" onChange={(v) => { setCode(v); if (v.length === 6) void activate(v); }} />
            <div aria-live="assertive">{error ? <ErrorAlert error={error} title="Code not accepted" /> : null}</div>
            <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6}>Activate account</Button>
          </form>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">Your account is active</h1>
          <p className="mt-1 text-sm text-muted">Sign in with your email, new password and an authenticator code.</p>
          <Link href={info.type === 'STAFF' ? '/login?reason=ACTIVATED' : '/login'} className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-md bg-ink px-6 text-base font-medium text-ink-contrast hover:opacity-90">
            Continue to sign in
          </Link>
        </>
      )}
    </Card>
  );
}
