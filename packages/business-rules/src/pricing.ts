import { floorDiv, mulRoundHalfUp, rational, type Kobo, type Rational } from './money';
import type { CreditPolicyRules } from './policy';

/**
 * Murabaha-style deferred sale pricing.
 *
 * The markup in the SWR is a TOTAL markup over the tenor (25% for up to 12 months,
 * 50% for 13–24 months). It is a profit markup on a sale, not an interest rate.
 *
 *   Profit             = round_half_up(Financing × markupBps / 10_000)
 *   Deferred Sale Price = Financing + Profit
 *   Instalments        = ceil(DSP / tenor) for the first (tenor − 1) months; the final
 *                        instalment is adjusted down so the schedule reconciles exactly to
 *                        the deferred sale price. The regular instalment is therefore the
 *                        largest, and it grows monotonically with the financing amount,
 *                        which keeps affordability searches exact.
 *                        (Degenerate tiny amounts where that would make the final instalment
 *                        non-positive fall back to floor-based instalments.)
 */

export class UnsupportedTenorError extends Error {
  constructor(public readonly tenorMonths: number) {
    super(`Tenor of ${tenorMonths} months is not supported by the applicable policy`);
  }
}

export function markupBpsForTenor(tenorMonths: number, policy: CreditPolicyRules): number {
  if (!Number.isInteger(tenorMonths) || tenorMonths <= 0) throw new UnsupportedTenorError(tenorMonths);
  const tier = policy.markupTiers.find((t) => tenorMonths >= t.minTenorMonths && tenorMonths <= t.maxTenorMonths);
  if (!tier) throw new UnsupportedTenorError(tenorMonths);
  return tier.markupBps;
}

export function isApprovedTenor(tenorMonths: number, policy: CreditPolicyRules): boolean {
  return policy.approvedTenorsMonths.includes(tenorMonths);
}

export function markupFactor(markupBps: number): Rational {
  return rational(10_000 + markupBps, 10_000);
}

export interface Instalment {
  number: number;
  amount: Kobo;
}

export interface DeferredSalePricing {
  financingAmount: Kobo;
  tenorMonths: number;
  markupBps: number;
  profitAmount: Kobo;
  deferredSalePrice: Kobo;
  /** The regular (non-final) instalment. */
  monthlyRepayment: Kobo;
  /** The largest instalment in the schedule — used for affordability. */
  maxInstalment: Kobo;
  instalments: Instalment[];
}

export function priceDeferredSale(financingAmount: Kobo, tenorMonths: number, policy: CreditPolicyRules): DeferredSalePricing {
  if (financingAmount < 0n) throw new RangeError('Financing amount cannot be negative');
  const markupBps = markupBpsForTenor(tenorMonths, policy);
  const profitAmount = mulRoundHalfUp(financingAmount, rational(markupBps, 10_000));
  const deferredSalePrice = financingAmount + profitAmount;
  const tenor = BigInt(tenorMonths);
  let base = -floorDiv(-deferredSalePrice, tenor); // ceil
  let finalAmount = deferredSalePrice - base * (tenor - 1n);
  if (finalAmount <= 0n && tenorMonths > 1) {
    base = floorDiv(deferredSalePrice, tenor);
    finalAmount = deferredSalePrice - base * (tenor - 1n);
  }
  const instalments: Instalment[] = [];
  for (let i = 1; i <= tenorMonths; i++) {
    instalments.push({ number: i, amount: i === tenorMonths ? finalAmount : base });
  }
  return {
    financingAmount,
    tenorMonths,
    markupBps,
    profitAmount,
    deferredSalePrice,
    monthlyRepayment: base,
    maxInstalment: finalAmount > base ? finalAmount : base,
    instalments,
  };
}

/** Add calendar months to a date (UTC), clamping to the end of shorter months. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

export function scheduleWithDates(pricing: DeferredSalePricing, firstDueDate: Date) {
  return pricing.instalments.map((i) => ({
    number: i.number,
    amount: i.amount,
    dueDate: addMonths(firstDueDate, i.number - 1).toISOString().slice(0, 10),
  }));
}
