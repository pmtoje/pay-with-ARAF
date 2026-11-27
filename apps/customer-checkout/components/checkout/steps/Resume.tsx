'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, OtpInput } from '@araf/ui';
import { errorCode, retryAfter } from '@/lib/api';
import type { OtpSent, View } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { ErrorNotice, LockIcon, ResendButton, SecurityNote, StepCard, Why, useCountdown } from '../ui';

/** Re-verification for a new browser or after inactivity. Progress is kept on the server. */
export function ResumeStep() {
  const { api, base, view, notifyOtpSent, setFlash } = useCheckout();
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState<{ to: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useCountdown(0);
  const last = useRef('');

  const send = () =>
    run(
      'send',
      async () => {
        const r = await api.post<OtpSent>(`${base}/resume`);
        setSent({ to: r.otp_sent_to });
        setCooldown(60);
        setCode('');
        notifyOtpSent();
      },
      {
        onError: (e) => {
          if (errorCode(e) === 'OTP_RESEND_COOLDOWN') {
            setCooldown(retryAfter(e) ?? 60);
            if (!sent) {
              setSent({ to: null });
              return true;
            }
          }
          return false;
        },
      },
    );

  const verify = (value = code) => {
    if (!/^\d{6}$/.test(value)) return;
    void run('verify', async () => {
      const v = await api.post<View>(`${base}/resume/verify`, { code: value });
      setFlash(null);
      return v;
    }, { onError: (e) => { if (errorCode(e) === 'OTP_INVALID') setCode(''); return false; } });
  };

  useEffect(() => {
    if (code.length === 6 && code !== last.current && !busy) {
      last.current = code;
      verify(code);
    }
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <StepCard
      eyebrow="Welcome back"
      title="Confirm it’s you to continue"
      description={
        <>
          Your application <span className="font-mono text-fg">{view.application_reference}</span> is saved — currently: <span className="font-medium text-fg">{view.status.label.toLowerCase()}</span>. For your security we need a one-time code because you opened this checkout in a new browser or were inactive for a few minutes.
        </>
      }
    >
      {!sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md bg-surface-2 px-4 py-3 text-sm text-muted">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" />
            <span>We’ll send a 6-digit code to the email on your application. Nothing you’ve completed will be lost.</span>
          </div>
          <ErrorNotice error={error} />
          <Button size="lg" block loading={busy === 'send'} onClick={() => void send()}>
            Send a code to my email
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="text-sm text-muted" role="status" aria-live="polite">
            {sent.to ? <>Code sent to <span className="font-medium text-fg">{sent.to}</span>.</> : 'A code was sent recently to the phone linked to your BVN.'} It expires in 5 minutes.
          </p>
          <OtpInput value={code} onChange={setCode} disabled={busy === 'verify'} label="6-digit verification code" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ResendButton cooldown={cooldown} busy={busy === 'send'} onResend={() => void send()} />
            <Button type="submit" size="lg" loading={busy === 'verify'} disabled={code.length !== 6}>
              Verify code and continue my application
            </Button>
          </div>
          <ErrorNotice error={error} />
        </form>
      )}
      <Why>Re-verifying stops anyone else who opens this link from seeing or changing your application.</Why>
      <SecurityNote />
    </StepCard>
  );
}
