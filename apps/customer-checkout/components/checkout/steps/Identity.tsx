'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, Field, Input, OtpInput, Skeleton } from '@araf/ui';
import { errorCode, retryAfter } from '@/lib/api';
import type { ConsentItem, OtpSent, View } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { SANDBOX_IDENTITY_EVENT } from '../SandboxTools';
import { ErrorNotice, ResendButton, SecurityNote, StepCard, Why, useCountdown } from '../ui';

const SHOWN = ['IDENTITY_VERIFICATION', 'CREDIT_ASSESSMENT', 'APPLICATION_PROCESSING', 'MARKETING'];
const WHY: Record<string, string> = {
  IDENTITY_VERIFICATION: 'Confirms you are who you say you are and protects you from impersonation.',
  CREDIT_ASSESSMENT: 'A preliminary check of your credit report helps us decide whether financing is suitable for you. Your score is never shared with the merchant.',
  APPLICATION_PROCESSING: 'We need to process your details to evaluate this application.',
  MARKETING: 'Entirely optional. It does not affect your application.',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function IdentityStep() {
  const { api, base, notifyOtpSent, summary, refresh } = useCheckout();
  const { busy, error, setError, run } = useAction();
  const [catalogue, setCatalogue] = useState<ConsentItem[] | null>(null);
  const [catalogueError, setCatalogueError] = useState<unknown>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bvn, setBvn] = useState('');
  const [showBvn, setShowBvn] = useState(false);
  const [dob, setDob] = useState('');
  const [touched, setTouched] = useState(false);
  const [otp, setOtp] = useState<{ to: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useCountdown(0);
  const lastAutoSubmit = useRef('');

  const loadConsents = () => {
    setCatalogueError(null);
    api
      .get<{ consents: ConsentItem[] }>(`${base}/consents`)
      .then((r) => setCatalogue(r.consents.filter((c) => SHOWN.includes(c.type))))
      .catch(setCatalogueError);
  };
  useEffect(loadConsents, [api, base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sandbox helper: fill the form from the sandbox tools drawer.
  useEffect(() => {
    const onFill = (e: Event) => {
      const d = (e as CustomEvent<{ bvn: string; date_of_birth: string }>).detail;
      setBvn(d.bvn);
      setDob(d.date_of_birth);
    };
    window.addEventListener(SANDBOX_IDENTITY_EVENT, onFill);
    return () => window.removeEventListener(SANDBOX_IDENTITY_EVENT, onFill);
  }, []);

  const required = (catalogue ?? []).filter((c) => c.required);
  const missingConsent = required.some((c) => !checked[c.type]);
  const bvnError = touched && !/^\d{11}$/.test(bvn) ? 'Enter the 11 digits of your BVN.' : null;
  const dobError = touched && (!dob || dob > todayIso()) ? 'Enter your date of birth.' : null;

  const sendIdentity = () =>
    run(
      'identity',
      async () => {
        const res = await api.post<OtpSent>(`${base}/identity`, { bvn, date_of_birth: dob });
        setOtp({ to: res.otp_sent_to });
        setCode('');
        setCooldown(res.resend_available_in_seconds ?? 60);
        notifyOtpSent();
        return res;
      },
      {
        onError: (e) => {
          // A code was already sent recently (e.g. after a page refresh): continue to entry.
          if (errorCode(e) === 'OTP_RESEND_COOLDOWN') {
            setCooldown(retryAfter(e) ?? 60);
            if (!otp) {
              setOtp({ to: null });
              return true;
            }
          }
          if (errorCode(e) === 'AGE_NOT_ELIGIBLE') {
            void refresh();
          }
          return false;
        },
      },
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (missingConsent || !/^\d{11}$/.test(bvn) || !dob || dob > todayIso()) return;
    void run('identity', async () => {
      const consents = (catalogue ?? []).filter((c) => checked[c.type]).map((c) => c.type);
      await api.post(`${base}/consents`, { consents });
    }).then(() => sendIdentity());
  };

  const verify = (value = code) => {
    if (!/^\d{6}$/.test(value)) return;
    void run('verify', async () => {
      const v = await api.post<View>(`${base}/identity/otp`, { code: value });
      setBvn('');
      return v;
    }, {
      onError: (e) => {
        const c = errorCode(e);
        if (c === 'CREDIT_PROVIDER_UNAVAILABLE' || c === 'CREDIT_INVALID_RESPONSE') {
          // Identity is verified; the eligibility check failed technically. Show the retry step.
          setBvn('');
          void refresh();
          return true;
        }
        if (c === 'OTP_INVALID') setCode('');
        return false;
      },
    });
  };

  useEffect(() => {
    if (code.length === 6 && code !== lastAutoSubmit.current && !busy) {
      lastAutoSubmit.current = code;
      verify(code);
    }
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (otp) {
    return (
      <StepCard
        eyebrow="Step 1 · Verify identity"
        title="Enter your verification code"
        description={
          <span role="status" aria-live="polite">
            {otp.to ? (
              <>
                We sent a 6-digit code to <span className="font-medium text-fg">{otp.to}</span>, the phone number linked to your BVN.
              </>
            ) : (
              'We recently sent a 6-digit code to the phone number linked to your BVN.'
            )}{' '}
            It expires in 5 minutes.
          </span>
        }
        footer={
          <>
            <Button variant="ghost" className="h-11" onClick={() => { setOtp(null); setError(null); }} disabled={!!busy}>
              Change details
            </Button>
            <Button size="lg" onClick={() => verify()} loading={busy === 'verify'} disabled={code.length !== 6 || !!busy}>
              Verify and continue
            </Button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-4">
          <OtpInput value={code} onChange={setCode} disabled={busy === 'verify'} label="6-digit verification code" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ResendButton cooldown={cooldown} busy={busy === 'identity'} onResend={() => void sendIdentity()} />
            <span className="text-xs text-subtle">Didn’t get it? Check the number on your BVN record.</span>
          </div>
        </form>
        {busy === 'verify' && (
          <p className="text-sm text-muted" role="status" aria-live="polite">
            Verifying your code and running a preliminary eligibility check…
          </p>
        )}
        <ErrorNotice error={error} />
        <Why>Only you can receive this code. It proves you control the phone registered to your BVN — we never send it to a number typed at checkout.</Why>
        <SecurityNote />
      </StepCard>
    );
  }

  return (
    <StepCard
      eyebrow="Step 1 · Verify identity"
      title="Let’s confirm it’s you"
      description={`To finance your ${summary.partner.name} purchase, The Alternative Bank needs to verify your identity. It takes about a minute.`}
    >
      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-semibold text-fg">Your permissions</legend>
          {catalogueError ? (
            <ErrorNotice error={catalogueError} action={<Button size="sm" variant="secondary" onClick={loadConsents}>Retry</Button>} />
          ) : !catalogue ? (
            <div className="space-y-3" aria-hidden="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            catalogue.map((c) => (
              <div key={c.type} className="rounded-md border border-border px-3.5 py-3">
                <Checkbox
                  checked={!!checked[c.type]}
                  onChange={(e) => setChecked((p) => ({ ...p, [c.type]: e.target.checked }))}
                  required={c.required}
                  aria-invalid={touched && c.required && !checked[c.type] ? true : undefined}
                  label={
                    <>
                      {c.text}
                      {!c.required && !/optional/i.test(c.text) && <span className="ml-1.5 rounded-sm bg-surface-2 px-1.5 py-0.5 text-2xs font-medium text-muted">Optional</span>}
                    </>
                  }
                  description={WHY[c.type]}
                />
              </div>
            ))
          )}
          {touched && missingConsent && catalogue && (
            <p className="text-xs font-medium text-danger" role="alert">
              Please tick each required permission to continue.
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 text-sm font-semibold text-fg">Your details</legend>
          <Field label="Bank Verification Number (BVN)" required error={bvnError} hint="11 digits. Dial *565*0# from your registered line if you don’t know it.">
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                  type={showBvn ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={11}
                  value={bvn}
                  onChange={(e) => setBvn(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  className="pr-20 font-mono tracking-widest"
                />
                <button type="button" onClick={() => setShowBvn((s) => !s)} className="absolute inset-y-0 right-0 flex min-w-[44px] items-center px-3 text-xs font-medium text-gold-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-pressed={showBvn}>
                  {showBvn ? 'Hide' : 'Show'}
                  <span className="sr-only"> BVN</span>
                </button>
              </div>
            )}
          </Field>
          <Field label="Date of birth" required error={dobError} hint="As registered on your BVN record.">
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} type="date" max={todayIso()} min="1900-01-01" value={dob} onChange={(e) => setDob(e.target.value)} />}
          </Field>
          <Why>Your BVN and date of birth let us confirm your identity with the national BVN service and send a code to the phone number on your BVN record. We never show or share your full BVN.</Why>
        </fieldset>

        <ErrorNotice error={error} />
        <Button type="submit" size="lg" block loading={busy === 'identity'} disabled={!catalogue}>
          Send verification code
        </Button>
        <SecurityNote />
      </form>
    </StepCard>
  );
}
