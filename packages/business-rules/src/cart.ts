import type { Kobo } from './money';

export interface CartLine {
  sku: string;
  name: string;
  quantity: number;
  unitAmount: Kobo;
  category: string;
  vendorReference: string;
}

export type CartValidationError =
  | 'EMPTY_CART'
  | 'INVALID_QUANTITY'
  | 'INVALID_UNIT_AMOUNT'
  | 'AMOUNT_MISMATCH'
  | 'CATEGORY_NOT_ELIGIBLE'
  | 'BELOW_PARTNER_MINIMUM'
  | 'ABOVE_PARTNER_MAXIMUM'
  | 'MULTIPLE_VENDORS_NOT_SUPPORTED';

export interface CartRules {
  eligibleCategories: string[];
  minAmount: Kobo;
  maxAmount: Kobo;
  allowMultipleVendors: boolean;
}

/** Server-side cart arithmetic and eligibility validation. The client-declared total is never trusted. */
export function validateCart(lines: CartLine[], declaredAmount: Kobo, rules: CartRules): CartValidationError[] {
  const errors: CartValidationError[] = [];
  if (lines.length === 0) return ['EMPTY_CART'];
  let total = 0n;
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000) errors.push('INVALID_QUANTITY');
    if (l.unitAmount <= 0n) errors.push('INVALID_UNIT_AMOUNT');
    if (!rules.eligibleCategories.includes(l.category)) errors.push('CATEGORY_NOT_ELIGIBLE');
    total += l.unitAmount * BigInt(Math.max(0, Math.trunc(l.quantity)));
  }
  if (total !== declaredAmount) errors.push('AMOUNT_MISMATCH');
  if (declaredAmount < rules.minAmount) errors.push('BELOW_PARTNER_MINIMUM');
  if (declaredAmount > rules.maxAmount) errors.push('ABOVE_PARTNER_MAXIMUM');
  if (!rules.allowMultipleVendors && new Set(lines.map((l) => l.vendorReference)).size > 1) {
    errors.push('MULTIPLE_VENDORS_NOT_SUPPORTED');
  }
  return [...new Set(errors)];
}

export type CartComparison =
  | { outcome: 'FULL_FINANCING'; financingAmount: Kobo; contributionAmount: 0n }
  | { outcome: 'EQUITY_REQUIRED'; financingAmount: Kobo; contributionAmount: Kobo }
  | { outcome: 'CART_REVISION_REQUIRED'; eligibleAmount: Kobo; shortfall: Kobo }
  | { outcome: 'DECLINED'; reason: 'NO_ELIGIBILITY' | 'BELOW_MINIMUM_FINANCING' };

/**
 * Compare maximum eligible financing to the cart (spec §29).
 * When eligibility is below the cart and customer equity is enabled, the customer may pay the
 * shortfall (or more) as equity to the merchant; only the remainder is financed.
 * Unused eligibility is never offered as cash or as a reusable balance.
 */
export function compareEligibilityToCart(
  eligibleAmount: Kobo,
  cartAmount: Kobo,
  customerEquityEnabled: boolean,
  minimumFinancing: Kobo,
): CartComparison {
  if (eligibleAmount <= 0n) return { outcome: 'DECLINED', reason: 'NO_ELIGIBILITY' };
  if (eligibleAmount >= cartAmount) {
    return { outcome: 'FULL_FINANCING', financingAmount: cartAmount, contributionAmount: 0n };
  }
  if (eligibleAmount < minimumFinancing) return { outcome: 'DECLINED', reason: 'BELOW_MINIMUM_FINANCING' };
  if (customerEquityEnabled) {
    return { outcome: 'EQUITY_REQUIRED', financingAmount: eligibleAmount, contributionAmount: cartAmount - eligibleAmount };
  }
  return { outcome: 'CART_REVISION_REQUIRED', eligibleAmount, shortfall: cartAmount - eligibleAmount };
}

export interface EquityBounds {
  /** Smallest equity the customer must pay (the gap between the price and what they are eligible for). */
  minEquity: Kobo;
  /** Largest equity allowed (the financed remainder must still meet the minimum financing amount). */
  maxEquity: Kobo;
  /** False when equity is disabled or no equity amount can produce an eligible financing. */
  available: boolean;
}

/**
 * Customer equity (down payment) paid to the merchant towards the item.
 * Equity reduces the BASE amount: financed = purchase price − equity, and the profit markup is
 * charged only on the financed amount. Example: ₦5,000,000 item, ₦2,000,000 equity → the Bank
 * finances ₦3,000,000 and the markup is on ₦3,000,000.
 */
export function equityBounds(purchaseAmount: Kobo, maxEligibleFinancing: Kobo, minimumFinancing: Kobo, customerEquityEnabled: boolean): EquityBounds {
  const minEquity = purchaseAmount > maxEligibleFinancing ? purchaseAmount - maxEligibleFinancing : 0n;
  const maxEquity = purchaseAmount - minimumFinancing;
  if (!customerEquityEnabled) return { minEquity: 0n, maxEquity: 0n, available: minEquity === 0n };
  return { minEquity, maxEquity: maxEquity < 0n ? 0n : maxEquity, available: maxEquity >= minEquity };
}

export type EquityValidationError = 'EQUITY_DISABLED' | 'EQUITY_BELOW_MINIMUM' | 'EQUITY_ABOVE_MAXIMUM' | 'EQUITY_NEGATIVE';

export function validateEquity(equity: Kobo, bounds: EquityBounds, customerEquityEnabled: boolean): EquityValidationError | null {
  if (equity < 0n) return 'EQUITY_NEGATIVE';
  if (equity > 0n && !customerEquityEnabled) return 'EQUITY_DISABLED';
  if (equity < bounds.minEquity) return 'EQUITY_BELOW_MINIMUM';
  if (equity > 0n && equity > bounds.maxEquity) return 'EQUITY_ABOVE_MAXIMUM';
  return null;
}
