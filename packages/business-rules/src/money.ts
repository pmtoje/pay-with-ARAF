/**
 * Exact money arithmetic.
 *
 * All monetary values are integer minor units (kobo) represented as `bigint`.
 * Floating point is never used for financial calculations. Ratios are exact
 * rationals (numerator / denominator) so that boundary comparisons such as
 * 33.300% vs 33.301% are exact.
 */

export type Kobo = bigint;

export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

export const ZERO: Kobo = 0n;

export function rational(num: bigint | number, den: bigint | number): Rational {
  const n = BigInt(num);
  const d = BigInt(den);
  if (d === 0n) throw new RangeError('Rational denominator cannot be zero');
  return d < 0n ? { num: -n, den: -d } : { num: n, den: d };
}

/**
 * Parse a decimal string such as "0.333" or "33.3" (with `percent=true`) into an exact rational.
 * Rejects exponent notation and anything that is not a plain decimal.
 */
export function parseDecimal(value: string, percent = false): Rational {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new RangeError(`Invalid decimal: ${value}`);
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = unsigned.split('.');
  let num = BigInt(whole + frac);
  let den = 10n ** BigInt(frac.length);
  if (percent) den *= 100n;
  if (negative) num = -num;
  return rational(num, den);
}

/** a <= b for rationals, exact. */
export function rationalLte(a: Rational, b: Rational): boolean {
  return a.num * b.den <= b.num * a.den;
}

export function rationalCompare(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.num * b.den;
  const r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/** floor(amount * r) for non-negative amount and rational. */
export function mulFloor(amount: Kobo, r: Rational): Kobo {
  return floorDiv(amount * r.num, r.den);
}

/** Round-half-up of amount * r (for non-negative values). */
export function mulRoundHalfUp(amount: Kobo, r: Rational): Kobo {
  const n = amount * r.num;
  const q = floorDiv(n, r.den);
  const rem = n - q * r.den;
  return rem * 2n >= r.den ? q + 1n : q;
}

export function floorDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('Division by zero');
  const q = a / b;
  // bigint division truncates toward zero; adjust for negative results.
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

export function minK(...values: Kobo[]): Kobo {
  return values.reduce((m, v) => (v < m ? v : m));
}

export function maxK(...values: Kobo[]): Kobo {
  return values.reduce((m, v) => (v > m ? v : m));
}

export function sumK(values: Kobo[]): Kobo {
  return values.reduce((s, v) => s + v, 0n);
}

/** Convert a bigint kobo value to a JSON-safe number, refusing unsafe magnitudes. */
export function koboToNumber(value: Kobo): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Monetary value exceeds safe integer range');
  }
  return Number(value);
}

/** Accept a number or string of integer kobo from untrusted input. */
export function toKobo(value: number | string | bigint): Kobo {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('Monetary values must be integer kobo');
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new RangeError('Monetary values must be integer kobo');
  return BigInt(value);
}

/** Human-readable NGN formatting from kobo, without floating point. */
export function formatNaira(value: Kobo, withSymbol = true): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const naira = abs / 100n;
  const kobo = abs % 100n;
  const nairaStr = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = `${withSymbol ? '₦' : ''}${nairaStr}.${kobo.toString().padStart(2, '0')}`;
  return negative ? `-${out}` : out;
}

/** Format a rational as a percentage string with the given decimals (display only, truncating). */
export function formatPercent(r: Rational, decimals = 3): string {
  const scale = 10n ** BigInt(decimals);
  const scaled = floorDiv(r.num * 100n * scale, r.den);
  const whole = floorDiv(scaled, scale);
  const frac = scaled - whole * scale;
  return decimals > 0 ? `${whole}.${frac.toString().padStart(decimals, '0')}%` : `${whole}%`;
}
