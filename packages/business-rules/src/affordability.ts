import { maxK, minK, mulFloor, parseDecimal, rational, rationalLte, type Kobo, type Rational } from './money';
import type { CreditPolicyRules } from './policy';
import { isApprovedTenor, markupFactor, markupBpsForTenor, priceDeferredSale } from './pricing';

/**
 * Affordability rules (salary earners).
 *
 * Source terminology: the SWR calls this ratio "DSCR". Its formula is actually a
 * repayment-to-income ratio, so internally we use `repaymentToIncomeRatio`.
 *
 *   Total Monthly Obligations = Existing Monthly Obligations + Proposed Monthly Repayment
 *   Repayment-to-Income Ratio = Total Monthly Obligations / Recognised Monthly Income  (≤ 33.3%)
 *   Available Capacity        = MAX(0, floor(Income × 0.333) − Existing Obligations)
 *   Max Affordable Financing  = Capacity × Tenor / Markup Factor  (then verified against the
 *                               actual largest instalment, so rounding can never breach capacity)
 */

export function maxRatio(policy: CreditPolicyRules): Rational {
  return parseDecimal(policy.maxRepaymentToIncomeRatio);
}

export function repaymentToIncomeRatio(totalMonthlyObligations: Kobo, recognisedMonthlyIncome: Kobo): Rational | null {
  if (recognisedMonthlyIncome <= 0n) return null;
  return rational(totalMonthlyObligations, recognisedMonthlyIncome);
}

/** True when obligations / income ≤ max ratio (exact). Zero or negative income is never within limit. */
export function isWithinRatio(totalMonthlyObligations: Kobo, recognisedMonthlyIncome: Kobo, policy: CreditPolicyRules): boolean {
  const ratio = repaymentToIncomeRatio(totalMonthlyObligations, recognisedMonthlyIncome);
  if (!ratio) return false;
  return rationalLte(ratio, maxRatio(policy));
}

export function availableMonthlyCapacity(recognisedMonthlyIncome: Kobo, existingMonthlyObligations: Kobo, policy: CreditPolicyRules): Kobo {
  if (recognisedMonthlyIncome <= 0n) return 0n;
  if (existingMonthlyObligations < 0n) throw new RangeError('Existing obligations cannot be negative');
  const ceiling = mulFloor(recognisedMonthlyIncome, maxRatio(policy));
  return maxK(0n, ceiling - existingMonthlyObligations);
}

export function resolveExistingObligations(bureau: Kobo | null, statement: Kobo | null, policy: CreditPolicyRules): Kobo {
  const b = bureau ?? 0n;
  const s = statement ?? 0n;
  switch (policy.obligationsSource) {
    case 'BUREAU':
      return b;
    case 'STATEMENT':
      return s;
    case 'MAX':
      return maxK(b, s);
  }
}

/**
 * Largest financing amount for a tenor such that the largest instalment ≤ capacity.
 * Starts from the closed-form bound and binary-searches downward for exactness.
 */
export function maxAffordableFinancing(capacity: Kobo, tenorMonths: number, policy: CreditPolicyRules): Kobo {
  if (capacity <= 0n) return 0n;
  const factor = markupFactor(markupBpsForTenor(tenorMonths, policy));
  // capacity × tenor / factor  ==  capacity × tenor × den / num
  const bound = (capacity * BigInt(tenorMonths) * factor.den) / factor.num;
  let lo = 0n;
  let hi = bound + 10n; // profit rounding can admit a few kobo beyond the floored closed form
  const markupBps = markupBpsForTenor(tenorMonths, policy);
  const tenor = BigInt(tenorMonths);
  // ceil(DSP / tenor) is monotonic non-decreasing in the financing amount → exact binary search.
  const regular = (f: Kobo) => {
    const dsp = f + (f * BigInt(markupBps) * 2n + 10_000n) / 20_000n; // round-half-up profit
    return (dsp + tenor - 1n) / tenor;
  };
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (regular(mid) <= capacity) lo = mid;
    else hi = mid - 1n;
  }
  // Guard the degenerate tiny-amount schedule shape.
  while (lo > 0n && priceDeferredSale(lo, tenorMonths, policy).maxInstalment > capacity) lo -= 1n;
  return lo;
}

export interface ExposureInput {
  existingBankExposure: Kobo;
  /** Sum of other active reservations for the same obligor (excludes this application). */
  otherActiveReservations: Kobo;
}

export function remainingExposure(input: ExposureInput, policy: CreditPolicyRules): Kobo {
  const limit = BigInt(policy.singleObligorLimitKobo);
  return maxK(0n, limit - input.existingBankExposure - input.otherActiveReservations);
}

/** Exposure amount a financing consumes, per the (configurable, to-be-confirmed) exposure basis. */
export function exposureAmountFor(financingAmount: Kobo, tenorMonths: number, policy: CreditPolicyRules): Kobo {
  return policy.exposureBasis === 'FINANCING_AMOUNT'
    ? financingAmount
    : priceDeferredSale(financingAmount, tenorMonths, policy).deferredSalePrice;
}

export interface TenorEligibility {
  tenorMonths: number;
  markupBps: number;
  maxAffordable: Kobo;
  eligibleAmount: Kobo;
  limitingFactor: 'AFFORDABILITY' | 'EXPOSURE' | 'PARTNER_LIMIT' | 'NONE';
}

export interface EligibilityInput {
  recognisedMonthlyIncome: Kobo;
  existingMonthlyObligations: Kobo;
  exposure: ExposureInput;
  partnerMaxAmount: Kobo | null;
  /** Tenors permitted for this partner/product; intersected with policy-approved tenors. */
  permittedTenors?: number[];
}

export interface EligibilityResult {
  capacity: Kobo;
  remainingExposure: Kobo;
  tenors: TenorEligibility[];
  /** Best eligible amount across permitted tenors. */
  maxEligibleAmount: Kobo;
  belowMinimum: boolean;
}

export function computeEligibility(input: EligibilityInput, policy: CreditPolicyRules): EligibilityResult {
  const capacity = availableMonthlyCapacity(input.recognisedMonthlyIncome, input.existingMonthlyObligations, policy);
  const remaining = remainingExposure(input.exposure, policy);
  const tenors = policy.approvedTenorsMonths
    .filter((t) => !input.permittedTenors || input.permittedTenors.includes(t))
    .filter((t) => isApprovedTenor(t, policy))
    .sort((a, b) => a - b);

  const results: TenorEligibility[] = tenors.map((tenorMonths) => {
    const maxAffordable = maxAffordableFinancing(capacity, tenorMonths, policy);
    // Exposure limit is defined on the configured exposure basis; convert to a financing cap.
    const exposureCap =
      policy.exposureBasis === 'FINANCING_AMOUNT'
        ? remaining
        : (remaining * 10_000n) / BigInt(10_000 + markupBpsForTenor(tenorMonths, policy));
    const caps: Array<[Kobo, TenorEligibility['limitingFactor']]> = [
      [maxAffordable, 'AFFORDABILITY'],
      [exposureCap, 'EXPOSURE'],
    ];
    if (input.partnerMaxAmount !== null) caps.push([input.partnerMaxAmount, 'PARTNER_LIMIT']);
    const eligibleAmount = minK(...caps.map((c) => c[0]));
    const limiting = caps.find((c) => c[0] === eligibleAmount)?.[1] ?? 'NONE';
    return { tenorMonths, markupBps: markupBpsForTenor(tenorMonths, policy), maxAffordable, eligibleAmount, limitingFactor: limiting };
  });

  const maxEligibleAmount = results.length ? maxK(...results.map((r) => r.eligibleAmount)) : 0n;
  return {
    capacity,
    remainingExposure: remaining,
    tenors: results,
    maxEligibleAmount,
    belowMinimum: maxEligibleAmount < BigInt(policy.minimumFinancingKobo),
  };
}

/** Re-verify a specific (financing, tenor) choice against capacity and exposure. */
export function isOfferAffordable(
  financingAmount: Kobo,
  tenorMonths: number,
  capacity: Kobo,
  remainingExposureAmount: Kobo,
  policy: CreditPolicyRules,
): boolean {
  if (!isApprovedTenor(tenorMonths, policy)) return false;
  const pricing = priceDeferredSale(financingAmount, tenorMonths, policy);
  if (pricing.maxInstalment > capacity) return false;
  return exposureAmountFor(financingAmount, tenorMonths, policy) <= remainingExposureAmount;
}
