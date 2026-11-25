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
  | { outcome: 'PARTIAL_FINANCING'; financingAmount: Kobo; contributionAmount: Kobo }
  | { outcome: 'CART_REVISION_REQUIRED'; eligibleAmount: Kobo; shortfall: Kobo }
  | { outcome: 'DECLINED'; reason: 'NO_ELIGIBILITY' | 'BELOW_MINIMUM_FINANCING' };

/**
 * Compare maximum eligible financing to the cart (spec §29).
 * Unused eligibility is never offered as cash or as a reusable balance.
 */
export function compareEligibilityToCart(
  eligibleAmount: Kobo,
  cartAmount: Kobo,
  partialFinancingEnabled: boolean,
  minimumFinancing: Kobo,
): CartComparison {
  if (eligibleAmount <= 0n) return { outcome: 'DECLINED', reason: 'NO_ELIGIBILITY' };
  if (eligibleAmount >= cartAmount) {
    return { outcome: 'FULL_FINANCING', financingAmount: cartAmount, contributionAmount: 0n };
  }
  if (eligibleAmount < minimumFinancing) return { outcome: 'DECLINED', reason: 'BELOW_MINIMUM_FINANCING' };
  if (partialFinancingEnabled) {
    return { outcome: 'PARTIAL_FINANCING', financingAmount: eligibleAmount, contributionAmount: cartAmount - eligibleAmount };
  }
  return { outcome: 'CART_REVISION_REQUIRED', eligibleAmount, shortfall: cartAmount - eligibleAmount };
}
