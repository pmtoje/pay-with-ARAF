'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Field, Input, formatNaira } from '@araf/ui';
import type { OfferOptions } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { ErrorNotice, Row, StepCard, Why } from '../ui';

const toKobo = (naira: string) => {
  const clean = naira.replace(/[,\s₦]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [w, f = ''] = clean.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
};
const toNairaInput = (kobo: number) => (kobo % 100 === 0 ? (kobo / 100).toLocaleString('en-NG') : (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 }));

/**
 * Equity (down payment) screen. The customer may pay part of the price directly to the merchant;
 * the Bank finances only the remainder, and the profit markup is charged on the financed amount only.
 */
export function EquityStep({ data, onDone }: { data: OfferOptions; onDone: () => void }) {
  const { api, base, summary } = useCheckout();
  const { busy, error, run } = useAction();
  const eq = data.equity;
  const [mode, setMode] = useState<'none' | 'equity'>(eq.required || eq.amount > 0 ? 'equity' : 'none');
  const [text, setText] = useState(eq.amount > 0 ? toNairaInput(eq.amount) : eq.min > 0 ? toNairaInput(eq.min) : '');
  const merchant = summary.partner.name;

  const amount = mode === 'none' ? 0 : toKobo(text);
  const problem = useMemo(() => {
    if (mode === 'none') return null;
    if (amount === null || text.trim() === '') return 'Enter an amount in naira.';
    if (amount <= 0) return 'Enter an amount above ₦0, or choose not to pay equity.';
    if (amount < eq.min) return `Your equity must be at least ${formatNaira(eq.min)} for this purchase.`;
    if (amount > eq.max) return `Your equity can be at most ${formatNaira(eq.max)} — the Bank must still finance part of the price.`;
    return null;
  }, [amount, eq.max, eq.min, mode, text]);

  const financed = amount === null ? null : data.purchase_amount - amount;
  const illustrative = financed !== null && !problem ? Math.round((financed * data.annual_profit_rate_percent) / 100) : null;

  return (
    <StepCard
      eyebrow="Step 4 · Your equity"
      title="Would you like to pay part of the price yourself?"
      description={
        eq.required
          ? `You’re eligible to finance up to ${formatNaira(data.max_eligible_amount ?? 0)}. To buy this item, pay the difference as equity to ${merchant}.`
          : `You can finance the full price, or pay some of it now as equity to ${merchant} and finance only the rest.`
      }
    >
      <fieldset className="space-y-3">
        <legend className="sr-only">Equity</legend>
        {!eq.required && (
          <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${mode === 'none' ? 'border-gold bg-gold-soft/40' : 'border-border-strong hover:bg-surface-2'}`}>
            <input type="radio" name="equity" className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-gold))]" checked={mode === 'none'} onChange={() => setMode('none')} />
            <span>
              <span className="block text-sm font-semibold text-fg">No equity — finance the full {formatNaira(data.purchase_amount)}</span>
              <span className="mt-0.5 block text-xs text-muted">Nothing to pay upfront.</span>
            </span>
          </label>
        )}
        <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${mode === 'equity' ? 'border-gold bg-gold-soft/40' : 'border-border-strong hover:bg-surface-2'}`}>
          <input type="radio" name="equity" className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-gold))]" checked={mode === 'equity'} onChange={() => setMode('equity')} />
          <span>
            <span className="block text-sm font-semibold text-fg">{eq.required ? 'Pay equity to ' + merchant : 'Pay some equity to ' + merchant}</span>
            <span className="mt-0.5 block text-xs text-muted">
              Lowers the amount financed — the profit markup is charged only on what the Bank finances.
            </span>
          </span>
        </label>
      </fieldset>

      {mode === 'equity' && (
        <Field
          label="Equity amount (₦)"
          required
          error={text.trim() !== '' ? problem : null}
          hint={eq.min > 0 ? `Between ${formatNaira(eq.min)} and ${formatNaira(eq.max)}.` : `Up to ${formatNaira(eq.max)}.`}
        >
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2,000,000" />
          )}
        </Field>
      )}

      <dl className="divide-y divide-border rounded-md border border-border px-4">
        <Row label="Item price" value={formatNaira(data.purchase_amount)} />
        <Row label={`Your equity (paid to ${merchant})`} value={amount !== null && !problem ? formatNaira(amount) : '—'} />
        <Row label="Amount the Bank finances" value={financed !== null && !problem ? formatNaira(financed) : '—'} strong />
        <Row label={`Profit rate (${data.annual_profit_rate_percent}% per annum)`} value={illustrative !== null ? `${formatNaira(illustrative)} per year on the financed amount` : '—'} />
      </dl>

      {mode === 'equity' && (
        <Alert tone="info" title="How you pay your equity">
          You pay your equity directly to {merchant}, not to the Bank, after the Bank approves your financing. {merchant} confirms receipt, and only then does the Bank pay the vendor the financed amount.
        </Alert>
      )}
      <Why>
        Equity reduces the base amount financed. Example: a ₦5,000,000 item with ₦2,000,000 equity — the Bank finances ₦3,000,000, and the profit markup is calculated on ₦3,000,000 only.
      </Why>
      <ErrorNotice error={error} />
      <Button
        size="lg"
        block
        disabled={!!problem || amount === null}
        loading={busy === 'equity'}
        onClick={() =>
          void run('equity', async () => {
            const v = await api.post(`${base}/equity`, { amount: amount ?? 0 });
            onDone();
            return v;
          })
        }
      >
        {mode === 'none' || amount === 0 ? `Finance the full ${formatNaira(data.purchase_amount)}` : `Continue — finance ${financed !== null && !problem ? formatNaira(financed) : ''}`}
      </Button>
    </StepCard>
  );
}
