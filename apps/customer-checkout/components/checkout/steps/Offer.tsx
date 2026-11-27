'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Skeleton, cn, formatDate, formatDateTime, formatNaira } from '@araf/ui';
import { errorCode } from '@/lib/api';
import type { OfferOptions } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { ErrorNotice, MerchantLink, Row, StepCard, Why } from '../ui';
import { EquityStep } from './Equity';

const pct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(2)}%`;

export function OfferStep() {
  const { view } = useCheckout();
  const [comparing, setComparing] = useState(false);
  // The equity screen comes first; once an offer exists, or the merchant sent the agreed equity, it is already chosen.
  const [equityChosen, setEquityChosen] = useState(view.state === 'OFFER_PRESENTED' || !!view.equity?.from_merchant);
  if (view.eligibility?.reasons.includes('CART_REVISION_REQUIRED')) return <CartRevision />;
  if (view.state === 'OFFER_PRESENTED' && view.offer && view.offer.status === 'PRESENTED' && !comparing) return <OfferReview onChange={() => setComparing(true)} />;
  return (
    <TenorComparison
      equityChosen={equityChosen}
      onEquityDone={() => setEquityChosen(true)}
      onChangeEquity={() => setEquityChosen(false)}
      onBack={view.state === 'OFFER_PRESENTED' && view.offer ? () => setComparing(false) : undefined}
      onSelected={() => setComparing(false)}
    />
  );
}

function CartRevision() {
  const { view, summary } = useCheckout();
  const max = view.eligibility?.max_eligible_amount ?? null;
  return (
    <StepCard eyebrow="Step 4 · Review offer" title="Your cart is above your eligible amount" description="Good news — you are eligible for financing, but not for the full value of this cart.">
      <dl className="divide-y divide-border rounded-md border border-border px-4">
        <Row label="Your cart" value={formatNaira(summary.amount)} />
        <Row label="Maximum you can finance" value={max !== null ? formatNaira(max) : '—'} strong />
      </dl>
      <p className="text-sm leading-relaxed text-muted">
        Paying part of the price as equity isn’t available for this purchase. To continue with Pay with ARAF, return to {summary.partner.name} and revise your cart to{max !== null ? ` ${formatNaira(max)} or less` : ' a lower amount'}. Your verification and assessment can be reused while they remain valid, so you won’t have to start over.
      </p>
      <MerchantLink href={summary.cancel_url} variant="primary" block reason="cancel">
        Revise my cart at {summary.partner.name}
      </MerchantLink>
    </StepCard>
  );
}

function TenorComparison({ onBack, onSelected, equityChosen, onEquityDone, onChangeEquity }: { onBack?: () => void; onSelected: () => void; equityChosen: boolean; onEquityDone: () => void; onChangeEquity: () => void }) {
  const { api, base, view, summary } = useCheckout();
  const { busy, error, run } = useAction();
  const [data, setData] = useState<OfferOptions | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tenor, setTenor] = useState<number | null>(view.offer?.tenor_months ?? null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await api.get<OfferOptions>(`${base}/offers`);
      setData(d);
      setTenor((t) => t ?? d.options.filter((o) => o.affordable).sort((a, b) => a.tenor_months - b.tenor_months)[0]?.tenor_months ?? null);
    } catch (e) {
      setLoadError(e);
    }
  }, [api, base]);
  useEffect(() => {
    void load();
  }, [load, equityChosen]);

  const first = view.customer?.first_name;
  if (data && data.equity.enabled && !equityChosen) {
    return (
      <EquityStep
        data={data}
        onDone={() => {
          setData(null);
          setTenor(null);
          onEquityDone();
        }}
      />
    );
  }
  return (
    <StepCard
      eyebrow="Step 4 · Review offer"
      title={first ? `${first}, choose your repayment term` : 'Choose your repayment term'}
      description={`Compare the options — a longer term lowers your monthly repayment, and the total profit markup is higher (${data?.annual_profit_rate_percent ?? 25}% per annum, up to ${data?.max_tenor_months ?? 24} months).`}
    >
      {loadError ? (
        <ErrorNotice error={loadError} action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>} />
      ) : !data ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading options">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <>
          <dl className="divide-y divide-border rounded-md border border-border px-4">
            <Row label="Item price" value={formatNaira(data.purchase_amount)} />
            {data.contribution > 0 && <Row label={`Your equity (paid to ${summary.partner.name})`} value={formatNaira(data.contribution)} />}
            <Row label="Amount the Bank finances" value={formatNaira(data.financing_amount)} strong />
            <Row label="Profit rate" value={`${data.annual_profit_rate_percent}% per annum, on the financed amount`} />
          </dl>
          {data.equity.enabled && (
            <button type="button" onClick={onChangeEquity} className="inline-flex min-h-[44px] items-center self-start text-sm font-medium text-gold-strong underline underline-offset-2">
              {data.contribution > 0 ? 'Change my equity' : 'Pay some equity instead'}
            </button>
          )}
          <fieldset>
            <legend className="sr-only">Repayment term</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.options.map((o) => {
                const checked = tenor === o.tenor_months;
                return (
                  <label
                    key={o.tenor_months}
                    className={cn(
                      'relative flex cursor-pointer flex-col rounded-md border p-4 transition-colors focus-within:ring-2 focus-within:ring-focus',
                      checked ? 'border-gold bg-gold-soft/40' : 'border-border-strong hover:bg-surface-2',
                      !o.affordable && 'cursor-not-allowed border-border bg-surface-2/50 opacity-70 hover:bg-surface-2/50',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2.5">
                        <input type="radio" name="tenor" className="h-4 w-4 accent-[rgb(var(--color-gold))]" checked={checked} disabled={!o.affordable} onChange={() => setTenor(o.tenor_months)} />
                        <span className="text-sm font-semibold text-fg">{o.tenor_months} months</span>
                      </span>
                      <span className="text-right text-xs text-muted">{pct(o.annual_profit_rate_percent)} p.a. · {pct(o.markup_percent_total)} total</span>
                    </span>
                    <span className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-fg">
                      {formatNaira(o.monthly_repayment)}
                      <span className="text-sm font-normal text-muted"> /month</span>
                    </span>
                    <dl className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">Profit markup</dt>
                        <dd className="tabular-nums text-fg">{formatNaira(o.profit)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted">Deferred sale price</dt>
                        <dd className="tabular-nums text-fg">{formatNaira(o.deferred_sale_price)}</dd>
                      </div>
                      {o.final_instalment !== o.monthly_repayment && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-muted">Final instalment</dt>
                          <dd className="tabular-nums text-fg">{formatNaira(o.final_instalment)}</dd>
                        </div>
                      )}
                    </dl>
                    {!o.affordable && <span className="mt-2 text-xs font-medium text-muted">Not available — the monthly repayment exceeds what you can comfortably afford.</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {data.options.every((o) => !o.affordable) && <Alert tone="warning">None of the available terms fit your repayment capacity for this amount.{data.equity.enabled ? ' Paying more equity lowers the amount financed.' : ''}</Alert>}
          <Why>The profit markup is the Bank’s disclosed profit on selling the item to you. It is fixed when you accept and does not change over the term.</Why>
          <ErrorNotice error={error} />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {onBack && (
              <Button variant="secondary" size="lg" onClick={onBack} disabled={!!busy}>
                Back to my offer
              </Button>
            )}
            <Button
              size="lg"
              disabled={!tenor}
              loading={busy === 'select'}
              onClick={() =>
                void run('select', async () => {
                  const v = await api.post(`${base}/offers/select`, { tenor_months: tenor });
                  onSelected();
                  return v;
                })
              }
            >
              {(() => {
                const o = data.options.find((x) => x.tenor_months === tenor);
                return o ? `Get my offer: ${formatNaira(o.monthly_repayment)}/month for ${o.tenor_months} months` : 'Choose a repayment term';
              })()}
            </Button>
          </div>
        </>
      )}
    </StepCard>
  );
}

function useTimeLeft(iso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'expired';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

function OfferReview({ onChange }: { onChange: () => void }) {
  const { api, base, view, summary } = useCheckout();
  const offer = view.offer!;
  const { busy, error, run } = useAction();
  const [accept, setAccept] = useState(false);
  const [share, setShare] = useState(false);
  const [showAll, setShowAll] = useState(offer.schedule.length <= 6);
  const left = useTimeLeft(offer.expires_at);
  const expired = left === 'expired' || errorCode(error) === 'OFFER_EXPIRED';
  const schedule = showAll ? offer.schedule : offer.schedule.slice(0, 3);

  return (
    <StepCard eyebrow="Step 4 · Review offer" title="Your indicative financing offer" description={<>Offer {offer.reference} · valid until {formatDateTime(offer.expires_at)}{left !== 'expired' && <> ({left} left)</>}</>}>
      <Alert tone="gold" title="Indicative — not final approval">
        This offer shows what you’re eligible for today. Final approval follows the Bank’s review, signing of documents, your repayment mandate and the Bank’s purchase of the item.
      </Alert>

      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Monthly repayment</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-fg">{formatNaira(offer.monthly_repayment)}</p>
          </div>
          <p className="text-sm text-muted">for {offer.tenor_months} months</p>
        </div>
        <dl className="divide-y divide-border px-4">
          <Row label="Item price" value={formatNaira(offer.purchase_amount)} />
          {offer.contribution > 0 && <Row label={`Your equity (paid to ${summary.partner.name})`} value={formatNaira(offer.contribution)} />}
          <Row label="Amount financed (Bank’s cost)" value={formatNaira(offer.financing_amount)} />
          <Row label={`Profit markup (${pct(offer.annual_profit_rate_percent)} p.a. × ${offer.tenor_months} months = ${pct(offer.markup_percent_total)})`} value={formatNaira(offer.profit)} />
          {offer.fees > 0 && <Row label="Fees" value={formatNaira(offer.fees)} />}
          <Row label="Deferred sale price (total you repay)" value={formatNaira(offer.deferred_sale_price)} strong />
        </dl>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-fg">Repayment schedule</h2>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Repayment schedule</caption>
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-subtle">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-semibold">#</th>
                <th scope="col" className="px-4 py-2 text-left font-semibold">Due date</th>
                <th scope="col" className="px-4 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((i) => (
                <tr key={i.number} className="border-t border-border">
                  <td className="px-4 py-2 tabular-nums text-muted">{i.number}</td>
                  <td className="px-4 py-2 text-fg">{formatDate(i.due_date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg">{formatNaira(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!showAll && (
            <button type="button" onClick={() => setShowAll(true)} className="flex min-h-[44px] w-full items-center justify-center border-t border-border text-sm font-medium text-gold-strong hover:bg-surface-2">
              Show all {offer.schedule.length} instalments
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <a href={`${base}/offers/${encodeURIComponent(offer.id)}/summary.pdf`} className="inline-flex min-h-[44px] items-center font-medium text-gold-strong underline underline-offset-2" download>
          Download offer summary (PDF)
        </a>
        <button type="button" onClick={onChange} className="inline-flex min-h-[44px] items-center font-medium text-muted underline underline-offset-2 hover:text-fg">
          Choose a different term
        </button>
      </div>

      <div className="space-y-2 rounded-md bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">
        <p>
          <span className="font-semibold text-fg">How Murabaha works:</span> The Alternative Bank buys the item from {summary.partner.name}’s vendor, then sells it to you at the deferred sale price above — the amount financed plus a disclosed, fixed profit markup — which you repay in instalments. This is not interest-based lending.
          {offer.contribution > 0 && <> Your equity of {formatNaira(offer.contribution)} is paid to {summary.partner.name} after approval and is not marked up.</>}
        </p>
        <p>Terms version {offer.terms_version}. Accepting submits your application for the Bank’s review; it is not yet a sale contract.</p>
      </div>

      <div className="space-y-3">
        <Checkbox checked={accept} onChange={(e) => setAccept(e.target.checked)} label="I have read this indicative offer and the terms, and I ask The Alternative Bank to process my financing application." />
        <Checkbox checked={share} onChange={(e) => setShare(e.target.checked)} label={`Share my application status with ${summary.partner.name} (optional)`} description="The merchant will only see progress such as “under review” or “approved” — never your credit score, income or statements." />
      </div>

      {expired ? (
        <Alert tone="warning" title="This offer has expired" action={<Button size="sm" variant="secondary" onClick={onChange}>Get a new offer</Button>}>
          Offers are valid for a limited time. Choose your term again to get an updated offer.
        </Alert>
      ) : (
        <ErrorNotice error={error} />
      )}
      <Button size="lg" block disabled={!accept || expired} loading={busy === 'accept'} onClick={() => void run('accept', () => api.post(`${base}/offers/accept`, { offer_id: offer.id, accept_terms: true, share_status_with_merchant: share }))}>
        {`Accept ${formatNaira(offer.monthly_repayment)}/month × ${offer.tenor_months} and submit to the Bank`}
      </Button>
    </StepCard>
  );
}
