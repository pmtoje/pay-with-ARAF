'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Button, Field, OtpInput, Textarea, cn, formatDate, formatDateTime, formatNaira } from '@araf/ui';
import { errorCode, retryAfter, safeHref } from '@/lib/api';
import { docLabel, milestones, type Milestone } from '@/lib/journey';
import type { OtpSent } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { CheckIcon, ErrorNotice, MerchantLink, ResendButton, Row, StepCard, Why, useCountdown } from '../ui';

const TONE: Record<string, 'info' | 'gold' | 'success' | 'danger' | 'neutral'> = { progress: 'info', action: 'gold', success: 'success', negative: 'danger', neutral: 'neutral' };

export function TrackingStep() {
  const { view, summary } = useCheckout();
  const s = view.state;
  let action: ReactNode = null;
  if (s === 'ADDITIONAL_INFORMATION_REQUIRED') action = <InformationRequest question={view.information_request?.question ?? null} />;
  else if (s === 'DOCUMENTATION_PENDING') action = <DocumentSigning />;
  else if (s === 'MANDATE_PENDING') action = <MandateSetup />;
  else if (s === 'VENDOR_PAYMENT_CONFIRMED') action = <SaleAgreement />;
  else if (s === 'GOODS_DISPATCHED') action = <DeliveryConfirm />;

  const done = s === 'COMPLETED' || s === 'GOODS_DELIVERED';
  const notApproved = ['ARAF_SUBMITTED', 'ARAF_UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(s);

  return (
    <div className="space-y-5">
      <StepCard
        eyebrow="Track your application"
        title={view.status.label}
        description={
          <>
            {view.status.description}
            {notApproved && s !== 'ADDITIONAL_INFORMATION_REQUIRED' && ' We will notify you as soon as there is a decision.'}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[view.status.tone] ?? 'neutral'}>{view.status.label}</Badge>
          <span className="text-xs text-subtle">Updates automatically</span>
        </div>
        {s === 'EXCEPTION' && <Alert tone="info" title="We’re resolving an issue">{view.exception?.message ?? 'We are resolving an issue with your application. No action is needed from you — we will contact you if anything is needed.'}</Alert>}
        {s !== 'EXCEPTION' && view.exception?.message && <Alert tone="warning">{view.exception.message}</Alert>}
        {view.equity?.required && view.equity.status !== 'DUE_AFTER_APPROVAL' && <EquityPayment />}
        {action}
        {done && (
          <Alert tone="success" title="Enjoy your purchase">
            Your item has been delivered. Repayments of {view.offer ? formatNaira(view.offer.monthly_repayment) : 'the agreed amount'} are collected by direct debit according to your schedule.
          </Alert>
        )}
      </StepCard>

      <section className="rounded-lg border border-border bg-surface px-5 py-5 sm:px-7" aria-labelledby="progress-title">
        <h2 id="progress-title" className="mb-4 text-sm font-semibold text-fg">
          Progress
        </h2>
        <Milestones items={milestones(view)} />
      </section>

      {view.offer && <AgreedTerms />}
      {(view.documents ?? []).length > 0 && s !== 'DOCUMENTATION_PENDING' && <DocumentsList />}

      <div className="flex flex-col gap-3 sm:flex-row">
        <MerchantLink href={summary.return_url}>Back to {summary.partner.name}</MerchantLink>
      </div>
    </div>
  );
}

function Milestones({ items }: { items: Milestone[] }) {
  return (
    <ol className="space-y-0">
      {items.map((m, i) => (
        <li key={m.id} className="relative flex gap-3 pb-4 last:pb-0" aria-current={m.state === 'current' || m.state === 'attention' ? 'step' : undefined}>
          {i < items.length - 1 && <span className={cn('absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px', m.state === 'done' ? 'bg-gold' : 'bg-border')} aria-hidden="true" />}
          <span
            className={cn(
              'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
              m.state === 'done' && 'border-gold bg-gold text-white dark:text-[#0c0c0d]',
              m.state === 'current' && 'border-gold bg-surface',
              m.state === 'attention' && 'border-gold bg-gold-soft',
              m.state === 'upcoming' && 'border-border bg-surface',
            )}
            aria-hidden="true"
          >
            {m.state === 'done' ? <CheckIcon className="h-3.5 w-3.5" /> : m.state !== 'upcoming' ? <span className="h-2 w-2 rounded-full bg-gold" /> : null}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={cn('text-sm font-medium', m.state === 'upcoming' ? 'text-subtle' : 'text-fg')}>
              {m.title}
              <span className="sr-only">{m.state === 'done' ? ' — complete' : m.state === 'upcoming' ? ' — upcoming' : m.state === 'attention' ? ' — action needed' : ' — in progress'}</span>
              {m.state === 'attention' && <span className="ml-2 rounded-sm bg-gold-soft px-1.5 py-0.5 text-2xs font-semibold text-gold-strong">Action needed</span>}
            </p>
            {m.state !== 'upcoming' && m.state !== 'done' && <p className="text-xs text-muted">{m.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Equity is paid to the merchant, not the Bank. The Bank pays the vendor only after the merchant confirms receipt. */
function EquityPayment() {
  const { view, summary } = useCheckout();
  const eq = view.equity!;
  if (eq.status === 'CONFIRMED') {
    return (
      <Alert tone="success" title="Equity received">
        {summary.partner.name} confirmed your equity of {formatNaira(eq.amount)}{eq.payment_reference ? ` (receipt ${eq.payment_reference})` : ''}. The Bank finances the remaining {formatNaira(eq.financed_amount ?? 0)}.
      </Alert>
    );
  }
  return (
    <Alert tone="gold" title={`Pay your equity of ${formatNaira(eq.amount)} to ${summary.partner.name}`}>
      <p>Your financing is approved. Pay your agreed equity directly to {summary.partner.name}. Once they confirm it, the Bank pays the vendor the financed {formatNaira(eq.financed_amount ?? 0)}.</p>
      {eq.pay_url && (
        <div className="mt-3">
          <MerchantLink href={eq.pay_url} variant="primary" reason="equity">
            Pay {formatNaira(eq.amount)} equity at {summary.partner.name}
          </MerchantLink>
        </div>
      )}
    </Alert>
  );
}

function AgreedTerms() {
  const { view } = useCheckout();
  const o = view.offer!;
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-5 text-sm font-semibold text-fg sm:px-7 [&::-webkit-details-marker]:hidden">
        Your financing terms
        <span className="text-xs font-normal text-muted group-open:hidden">
          {formatNaira(o.monthly_repayment)} × {o.tenor_months}
        </span>
      </summary>
      <div className="border-t border-border px-5 pb-4 sm:px-7">
        <dl className="divide-y divide-border">
          <Row label="Item price" value={formatNaira(o.purchase_amount)} />
          {o.contribution > 0 && <Row label="Your equity (paid to the merchant)" value={formatNaira(o.contribution)} />}
          <Row label="Amount financed" value={formatNaira(o.financing_amount)} />
          <Row label={`Profit markup (${o.annual_profit_rate_percent}% p.a. × ${o.tenor_months} months)`} value={formatNaira(o.profit)} />
          <Row label="Deferred sale price" value={formatNaira(o.deferred_sale_price)} strong />
          <Row label="Monthly repayment" value={`${formatNaira(o.monthly_repayment)} × ${o.tenor_months}`} />
          {o.schedule[0] && <Row label="First instalment due" value={formatDate(o.schedule[0].due_date)} />}
          <Row label="Repayment account" value={view.account ? <span className="font-mono">{view.account.account_number}</span> : '—'} />
        </dl>
      </div>
    </details>
  );
}

function DocLinks({ types }: { types?: string[] }) {
  const { view, base } = useCheckout();
  const docs = (view.documents ?? []).filter((d) => !types || types.includes(d.type));
  if (!docs.length) return null;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{docLabel(d.type)}</p>
            <p className="text-xs text-muted">
              Version {d.version} · {d.status === 'SIGNED' ? `Signed ${formatDateTime(d.signed_at)}` : 'Awaiting your signature'}
            </p>
          </div>
          <a href={`${base}/documents/${encodeURIComponent(d.id)}.pdf`} target="_blank" rel="noopener" className="inline-flex h-11 items-center rounded-md border border-border-strong px-4 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            Read<span className="sr-only"> {docLabel(d.type)}</span> (PDF)
          </a>
        </li>
      ))}
    </ul>
  );
}

function DocumentsList() {
  return (
    <section className="rounded-lg border border-border bg-surface px-5 py-5 sm:px-7" aria-labelledby="docs-title">
      <h2 id="docs-title" className="mb-3 text-sm font-semibold text-fg">
        Your documents
      </h2>
      <DocLinks />
    </section>
  );
}

/** Request a one-time code, then confirm an action with it. */
function OtpConfirm({ purpose, endpoint, cta, confirmLabel, onPreconditions }: { purpose: 'DOCUMENT_SIGNING' | 'SALE_CONTRACT'; endpoint: string; cta: string; confirmLabel: string; onPreconditions?: (e: unknown) => boolean }) {
  const { api, base, notifyOtpSent } = useCheckout();
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState<{ to: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useCountdown(0);
  const last = useRef('');

  const request = () =>
    run(
      'otp',
      async () => {
        const r = await api.post<OtpSent>(`${base}/documents/otp`, { purpose });
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

  const confirm = (value = code) => {
    if (!/^\d{6}$/.test(value)) return;
    void run('sign', () => api.post(`${base}/${endpoint}`, { code: value }), {
      onError: (e) => {
        if (errorCode(e) === 'OTP_INVALID') setCode('');
        return onPreconditions?.(e) ?? false;
      },
    });
  };

  useEffect(() => {
    if (code.length === 6 && code !== last.current && !busy) {
      last.current = code;
      confirm(code);
    }
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sent)
    return (
      <div className="space-y-3">
        <ErrorNotice error={error} />
        <Button size="lg" block loading={busy === 'otp'} onClick={() => void request()}>
          {cta}
        </Button>
      </div>
    );
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); confirm(); }}>
      <p className="text-sm text-muted" role="status" aria-live="polite">
        {sent.to ? <>Enter the code sent to <span className="font-medium text-fg">{sent.to}</span>.</> : 'Enter the code we recently sent to your BVN-linked phone.'}
      </p>
      <OtpInput value={code} onChange={setCode} disabled={busy === 'sign'} label="6-digit signing code" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResendButton cooldown={cooldown} busy={busy === 'otp'} onResend={() => void request()} />
        <Button type="submit" size="lg" loading={busy === 'sign'} disabled={code.length !== 6}>
          {confirmLabel}
        </Button>
      </div>
      <ErrorNotice error={error} />
    </form>
  );
}

function ActionBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-md border border-gold/50 bg-gold-soft/30 px-4 py-4">
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children}
    </div>
  );
}

function InformationRequest({ question }: { question: string | null }) {
  const { api, base } = useCheckout();
  const { busy, error, run } = useAction();
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const tooShort = note.trim().length < 3;
  return (
    <ActionBox title="Our team needs more information">
      {question ? (
        <div className="rounded-md border border-border bg-surface px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">The Bank asks</p>
          <p className="mt-1 text-sm text-fg">{question}</p>
        </div>
      ) : null}
      <p className="text-sm text-muted">{question ? 'Reply below' : 'Please answer the question you received from our team, or share any details that help us complete your review'}. Don’t include passwords, PINs or full card numbers.</p>
      {sent && <Alert tone="success">Thank you — we’ve sent your information to our team.</Alert>}
      <Field label="Your response" hint="Up to 1,000 characters.">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <ErrorNotice error={error} />
      <Button
        size="lg"
        block
        disabled={tooShort}
        loading={busy === 'info'}
        onClick={() =>
          void run('info', async () => {
            const v = await api.post(`${base}/information`, { note: note.trim() });
            setNote('');
            setSent(true);
            return v;
          })
        }
      >
        Send to the Bank
      </Button>
    </ActionBox>
  );
}

function DocumentSigning() {
  return (
    <ActionBox title="Review and sign your documents">
      <p className="text-sm text-muted">Your financing has been approved. Please read each document, then sign them together with a one-time code sent to your phone.</p>
      <DocLinks types={['PROMISE_TO_PURCHASE', 'OFFER_LETTER']} />
      <OtpConfirm purpose="DOCUMENT_SIGNING" endpoint="documents/sign" cta="Send code to sign my promise to purchase and offer letter" confirmLabel="Sign my documents" />
      <Why>Signing the promise to purchase asks the Bank to buy the item for you. The sale to you happens later, only after the Bank owns the item.</Why>
    </ActionBox>
  );
}

function MandateSetup() {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  const failed = view.mandate?.status === 'FAILED';
  const awaiting = view.mandate?.status === 'AWAITING_AUTHORIZATION';
  return (
    <ActionBox title={failed ? 'Your repayment mandate wasn’t activated' : 'Authorise your repayment mandate'}>
      <p className="text-sm text-muted">
        {failed
          ? 'You can try again — you’ll be taken to Remita to authorise the direct debit.'
          : awaiting
            ? 'We’re waiting for your authorisation. If you closed the Remita page, continue below.'
            : `Repayments of ${view.offer ? formatNaira(view.offer.monthly_repayment) : 'your instalments'} will be collected monthly by direct debit${view.account ? ` from ${view.account.account_number}` : ''}. You’ll authorise this securely with Remita.`}
      </p>
      <ErrorNotice error={error} />
      <Button
        size="lg"
        block
        loading={busy === 'mandate'}
        onClick={() =>
          void run('mandate', async () => {
            const r = await api.post<{ authorization_url: string }>(`${base}/mandate/start`);
            const url = safeHref(r.authorization_url);
            if (!url) throw new Error('The mandate link is not valid. Please try again.');
            window.location.assign(url);
            await new Promise((resolve) => setTimeout(resolve, 10_000));
          })
        }
      >
        {`${failed ? 'Try again: authorise' : awaiting ? 'Continue: authorise' : 'Authorise'} ${view.offer ? formatNaira(view.offer.monthly_repayment) : 'your'} monthly direct debit with Remita`}
      </Button>
      {awaiting && (
        <Button variant="ghost" block loading={busy === 'verify'} onClick={() => void run('verify', () => api.post(`${base}/mandate/verify`))}>
          I’ve authorised it — check my mandate now
        </Button>
      )}
    </ActionBox>
  );
}

function SaleAgreement() {
  const { view } = useCheckout();
  const [notReady, setNotReady] = useState(false);
  const doc = (view.documents ?? []).find((d) => d.type === 'SALE_AGREEMENT');
  if (!doc || doc.status === 'SIGNED' || notReady)
    return (
      <Alert tone="info" title={doc?.status === 'SIGNED' ? 'Sale agreement signed' : 'The Bank has purchased your item'}>
        {doc?.status === 'SIGNED'
          ? 'Thank you. We’re authorising the vendor to release your item.'
          : 'The Bank is completing the acquisition of your item. We’ll notify you when the sale agreement is ready for you to sign.'}
      </Alert>
    );
  return (
    <ActionBox title="Sign your Murabaha sale agreement">
      <p className="text-sm text-muted">The Bank now owns your item and is ready to sell it to you at the agreed deferred sale price. Please read the agreement, then sign it with a one-time code.</p>
      <DocLinks types={['SALE_AGREEMENT']} />
      <OtpConfirm
        purpose="SALE_CONTRACT"
        endpoint="sale-contract/sign"
        cta={`Send code to sign the sale agreement (${view.offer ? formatNaira(view.offer.deferred_sale_price) : 'deferred sale price'})`}
        confirmLabel={`Sign and buy for ${view.offer ? formatNaira(view.offer.deferred_sale_price) : 'the agreed price'}`}
        onPreconditions={(e) => {
          if (errorCode(e) === 'PRECONDITIONS_NOT_MET') {
            setNotReady(true);
            return true;
          }
          return false;
        }}
      />
    </ActionBox>
  );
}

function DeliveryConfirm() {
  const { api, base, view } = useCheckout();
  const { busy, error, run } = useAction();
  const shipped = [...(view.fulfilment ?? [])].reverse().find((f) => f.tracking_reference || f.carrier);
  return (
    <ActionBox title="Your item is on its way">
      {shipped ? (
        <dl className="divide-y divide-border rounded-md border border-border bg-surface px-4">
          {shipped.carrier && <Row label="Carrier" value={shipped.carrier} />}
          {shipped.tracking_reference && <Row label="Tracking reference" value={<span className="font-mono">{shipped.tracking_reference}</span>} />}
          <Row label="Dispatched" value={formatDateTime(shipped.at)} />
        </dl>
      ) : (
        <p className="text-sm text-muted">The vendor has dispatched your item.</p>
      )}
      <ErrorNotice error={error} />
      <Button size="lg" block loading={busy === 'deliver'} onClick={() => void run('deliver', () => api.post(`${base}/delivery/confirm`))}>
        Confirm I received it
      </Button>
      <p className="text-xs text-muted">Only confirm once the item is in your hands and in good condition.</p>
    </ActionBox>
  );
}

export function EndedStep() {
  const { view, summary } = useCheckout();
  const s = view.state;
  if (s === 'DECLINED')
    return (
      <StepCard eyebrow="Pay with ARAF" title="We can’t offer financing for this purchase" description="We are unable to offer financing for this purchase based on our current credit eligibility requirements.">
        <p className="text-sm leading-relaxed text-muted">
          Thank you for considering Pay with ARAF. You can return to {summary.partner.name} and choose another payment method to complete your order. This decision applies to this application only.
        </p>
        <MerchantLink href={summary.cancel_url} variant="primary" block reason="cancel">
          Choose another payment method
        </MerchantLink>
      </StepCard>
    );
  return (
    <StepCard
      eyebrow="Pay with ARAF"
      title={s === 'CANCELLED' ? 'Application cancelled' : 'This application has expired'}
      description={s === 'CANCELLED' ? 'Your financing application has been cancelled. Nothing further is needed from you.' : 'This application expired before it was completed. Please start again from the merchant.'}
    >
      <MerchantLink href={summary.cancel_url} variant="primary" block reason="cancel">
        Back to {summary.partner.name}
      </MerchantLink>
    </StepCard>
  );
}
