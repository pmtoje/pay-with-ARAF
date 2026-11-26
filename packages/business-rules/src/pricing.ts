import { floorDiv, mulRoundHalfUp, rational, type Kobo, type Rational } from './money';
import type { CreditPolicyRules } from './policy';

/**
 * Murabaha-style deferred sale pricing.
 *
 * The profit markup is quoted PER ANNUM and set per financing product (each partner's product
 * carries its own approved rate; the proposed default is 25% p.a.). It is a disclosed profit on
 * the sale of the asset, not interest. The markup applies only to the FINANCED amount — the
 * purchase price less any customer equity already paid to the merchant.
 *
 *   Total markup        = annual rate × tenor ÷ 12          (25% p.a. → 12 m = 25%, 24 m = 50%)
 *   Profit              = round_half_up(Financing × annualRateBps × tenor ÷ 120_000)
 *   Deferred Sale Price = Financing + Profit
 *   Instalments         = ceil(DSP / tenor) for the first (tenor − 1) months; the final
 *                         instalment is adjusted down so the schedule reconciles exactly to
 *                         the deferred sale price. The regular instalment is therefore the
 *                         largest, and it grows monotonically with the financing amount,
 *                         which keeps affordability searches exact.
 *                         (Degenerate tiny amounts where that would make the final instalment
 *                         non-positive fall back to floor-based instalments.)
 */

/** The pricing of one financing product (snapshotted onto each application and offer). */
export interface ProductPricing {
  /** Profit rate per annum in basis points (2500 = 25% p.a.). */
  annualProfitRateBps: number;
}

export class UnsupportedTenorError extends Error {
  constructor(public readonly tenorMonths: number) {
    super(`Tenor of ${tenorMonths} months is not supported by the applicable policy`);
  }
}

export class InvalidProfitRateError extends Error {
  constructor(public readonly annualProfitRateBps: number) {
    super(`Annual profit rate of ${annualProfitRateBps} bps is invalid`);
  }
}

function assertTenor(tenorMonths: number, policy: CreditPolicyRules) {
  if (!Number.isInteger(tenorMonths) || tenorMonths <= 0 || tenorMonths > policy.maxTenorMonths) throw new UnsupportedTenorError(tenorMonths);
}

function assertRate(pricing: ProductPricing) {
  const r = pricing.annualProfitRateBps;
  if (!Number.isInteger(r) || r < 0 || r > 10_000) throw new InvalidProfitRateError(r);
}

/** Exact total markup over the tenor as a fraction of the financed amount. */
export function totalMarkup(tenorMonths: number, policy: CreditPolicyRules, pricing: ProductPricing): Rational {
  assertTenor(tenorMonths, policy);
  assertRate(pricing);
  return rational(pricing.annualProfitRateBps * tenorMonths, 120_000);
}

/** Total markup over the tenor in basis points, for display (may be fractional, e.g. 2500 p.a. × 7 m = 1458.33). */
export function totalMarkupBps(tenorMonths: number, policy: CreditPolicyRules, pricing: ProductPricing): number {
  const m = totalMarkup(tenorMonths, policy, pricing);
  return Number((m.num * 1_000_000n) / m.den) / 100;
}

export function isApprovedTenor(tenorMonths: number, policy: CreditPolicyRules): boolean {
  return policy.approvedTenorsMonths.includes(tenorMonths) && tenorMonths <= policy.maxTenorMonths;
}

/** 1 + total markup, exact. */
export function markupFactor(tenorMonths: number, policy: CreditPolicyRules, pricing: ProductPricing): Rational {
  const m = totalMarkup(tenorMonths, policy, pricing);
  return rational(m.den + m.num, m.den);
}

export interface Instalment {
  number: number;
  amount: Kobo;
}

export interface DeferredSalePricing {
  financingAmount: Kobo;
  tenorMonths: number;
  annualProfitRateBps: number;
  /** Total markup over the tenor in bps (display; may be fractional). */
  markupBps: number;
  profitAmount: Kobo;
  deferredSalePrice: Kobo;
  /** The regular (non-final) instalment. */
  monthlyRepayment: Kobo;
  /** The largest instalment in the schedule — used for affordability. */
  maxInstalment: Kobo;
  instalments: Instalment[];
}

export function priceDeferredSale(financingAmount: Kobo, tenorMonths: number, policy: CreditPolicyRules, pricing: ProductPricing): DeferredSalePricing {
  if (financingAmount < 0n) throw new RangeError('Financing amount cannot be negative');
  const profitAmount = mulRoundHalfUp(financingAmount, totalMarkup(tenorMonths, policy, pricing));
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
    annualProfitRateBps: pricing.annualProfitRateBps,
    markupBps: totalMarkupBps(tenorMonths, policy, pricing),
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
