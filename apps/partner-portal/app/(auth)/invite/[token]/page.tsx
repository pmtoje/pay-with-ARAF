'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, CopyButton, Field, Input, KeyValue, LoadingBlock, OtpInput, Stepper, TotpQr } from '@araf/ui';
import { api, isApiError } from '@/lib/api';
import { FormError } from '@/components/common';
import { ROLE_LABEL } from '@/lib/session';
import { AuthFrame } from '../../auth-frame';

interface InvitationInfo {
  email: string;
  full_name: string;
  type: 'PARTNER' | 'STAFF';
  partner_name: string | null;
  roles: string[];
}

const STEPS = [
  { id: 'password', label: 'Set password' },
  { id: 'mfa', label: 'Authenticator' },
  { id: 'done', label: 'Activated' },
];

function policy(pw: string): string[] {
  const out: string[] = [];
  if (pw.length < 12) out.push('At least 12 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) out.push('Upper-case, lower-case letters and numbers');
  return out;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [enrol, setEnrol] = useState<{ totp_secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<InvitationInfo>(`/api/auth/invitations/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(setLoadError);
  }, [token]);

  if (loadError) {
    return (
      <AuthFrame title="Invitation unavailable">
        <Alert tone="danger" title={isApiError(loadError, 'NOT_FOUND') ? 'This invitation link is invalid, expired or already used.' : 'We could not load this invitation.'}>
          Ask your partner administrator to send a new invitation. Invitations are valid for 7 days.
        </Alert>
        <Link href="/login" className="mt-4 inline-block text-sm font-medium text-gold-strong underline-offset-4 hover:underline">
          Go to sign in
        </Link>
      </AuthFrame>
    );
  }
  if (!info) {
    return (
      <AuthFrame title="Accept your invitation">
        <LoadingBlock rows={4} label="Loading invitation" />
      </AuthFrame>
    );
  }
  if (info.type !== 'PARTNER') {
    return (
      <AuthFrame title="Wrong portal">
        <Alert tone="warning">This invitation is for the Bank administration portal, not the Partner portal.</Alert>
      </AuthFrame>
    );
  }

  const problems = policy(password);
  const mismatch = touched && confirm.length > 0 && confirm !== password;

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problems.length || confirm !== password) return;
    setBusy(true);
    setError(null);
    try {
      setEnrol(await api.post<{ totp_secret: string; otpauth_uri: string }>(`/api/auth/invitations/${encodeURIComponent(token)}/accept`, { password }));
      setStep(1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/auth/invitations/${encodeURIComponent(token)}/activate`, { code });
      setStep(2);
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={`Join ${info.partner_name ?? 'your team'} on Pay with ARAF`} description="Set a password and enrol an authenticator app. Both are required to sign in.">
      <div className="mb-6">
        <Stepper steps={STEPS} current={step} />
      </div>
      {step === 0 && (
        <form onSubmit={accept} className="space-y-4" noValidate>
          <div className="rounded-md bg-surface-2 px-4 py-3">
            <KeyValue
              columns={1}
              items={[
                { label: 'Name', value: info.full_name },
                { label: 'Email', value: info.email },
                { label: 'Role', value: info.roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') },
              ]}
            />
          </div>
          <input type="email" autoComplete="username" value={info.email} readOnly hidden />
          <Field label="New password" required hint="At least 12 characters with upper-case, lower-case letters and numbers." error={touched && problems.length ? problems.join(' · ') : null}>
            {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="new-password" value={password} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <Field label="Confirm password" required error={mismatch ? 'Passwords do not match' : null}>
            {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="new-password" value={confirm} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setConfirm(e.target.value)} onBlur={() => setTouched(true)} />}
          </Field>
          <FormError error={error} />
          <Button type="submit" block size="lg" loading={busy}>
            Set password and continue
          </Button>
        </form>
      )}
      {step === 1 && enrol && (
        <form onSubmit={activate} className="space-y-5">
          <div className="space-y-3">
            <p className="text-sm text-fg">
              Scan the QR code with an authenticator app (e.g. Google Authenticator, Microsoft Authenticator, Authy), then enter the 6-digit code it shows.
            </p>
            <TotpQr uri={enrol.otpauth_uri} />
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Can’t scan? Enter this key in the app</p>
              <p className="mt-1 break-all font-mono text-base font-semibold tracking-wider text-fg">{enrol.totp_secret.replace(/(.{4})/g, '$1 ').trim()}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton value={enrol.totp_secret} label="Copy key" />
                <CopyButton value={enrol.otpauth_uri} label="Copy otpauth URI" />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted">Show otpauth URI</summary>
                <p className="mt-1 break-all font-mono text-2xs text-muted">{enrol.otpauth_uri}</p>
              </details>
            </div>
            <Alert tone="warning">Keep this key private. It is shown only during enrolment.</Alert>
          </div>
          <OtpInput value={code} onChange={setCode} disabled={busy} label="Authenticator code" />
          <FormError error={error} />
          <Button type="submit" block size="lg" loading={busy} disabled={code.length !== 6}>
            Activate account
          </Button>
        </form>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <Alert tone="success" title="Your account is active">
            Sign in with your email, password and authenticator. The code you just used cannot be reused, so wait for the next code before signing in.
          </Alert>
          <Link href="/login?activated=1" className="inline-flex h-12 w-full items-center justify-center rounded-md bg-ink px-6 text-base font-medium text-ink-contrast hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2">
            Continue to sign in
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
