import type { CreditPolicyRules } from './policy';

export type ScoreClassification =
  | { kind: 'BAND'; band: 'POOR' | 'FAIR' | 'GOOD'; action: 'DECLINE' | 'ENHANCED_REVIEW' | 'PROCEED'; score: number }
  | { kind: 'NO_SCORE'; action: 'DECLINE' | 'MANUAL_REVIEW' }
  | { kind: 'INVALID_RESPONSE'; reason: string };

/**
 * Classify a provider credit score.
 *
 * - A missing score (null/undefined) is a thin-file case: it is NEVER coerced to zero.
 *   Its treatment comes from the policy (`thinFileTreatment`).
 * - Scores outside the provider's documented range, or non-integers, are invalid responses
 *   and must be handled as technical failures — never as poor credit.
 */
export function classifyScore(score: unknown, policy: CreditPolicyRules): ScoreClassification {
  if (score === null || score === undefined) {
    return { kind: 'NO_SCORE', action: policy.thinFileTreatment };
  }
  if (typeof score !== 'number' || !Number.isInteger(score)) {
    return { kind: 'INVALID_RESPONSE', reason: 'SCORE_NOT_INTEGER' };
  }
  if (score < policy.scoreRange.min || score > policy.scoreRange.max) {
    return { kind: 'INVALID_RESPONSE', reason: 'SCORE_OUT_OF_RANGE' };
  }
  const band = policy.scoreBands.find((b) => score >= b.min && score <= b.max);
  if (!band) return { kind: 'INVALID_RESPONSE', reason: 'SCORE_NOT_IN_ANY_BAND' };
  return { kind: 'BAND', band: band.band, action: band.action, score };
}

/** Customer-facing outcome — never reveals the raw score. */
export function customerCreditMessage(c: ScoreClassification): string {
  if (c.kind === 'INVALID_RESPONSE') {
    return 'We could not complete your eligibility check right now. Please try again shortly.';
  }
  if (c.kind === 'NO_SCORE') {
    return c.action === 'DECLINE'
      ? 'We are unable to offer financing for this purchase based on our current credit eligibility requirements.'
      : 'We need a little more information to assess your eligibility.';
  }
  switch (c.action) {
    case 'DECLINE':
      return 'We are unable to offer financing for this purchase based on our current credit eligibility requirements.';
    case 'ENHANCED_REVIEW':
      return 'We need a little more information to assess your eligibility.';
    case 'PROCEED':
      return 'Your preliminary eligibility check is complete. Next, we will confirm your account details.';
  }
}

/** Whole-years age at the given date, computed from calendar fields (no floating point). */
export function ageInYears(dateOfBirth: string, at: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!m) throw new RangeError('Date of birth must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dob = new Date(Date.UTC(y, mo - 1, d));
  if (dob.getUTCFullYear() !== y || dob.getUTCMonth() !== mo - 1 || dob.getUTCDate() !== d) {
    throw new RangeError('Invalid calendar date');
  }
  let age = at.getUTCFullYear() - y;
  const beforeBirthday = at.getUTCMonth() < mo - 1 || (at.getUTCMonth() === mo - 1 && at.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isAgeEligible(dateOfBirth: string, at: Date, policy: CreditPolicyRules): boolean {
  const age = ageInYears(dateOfBirth, at);
  return age >= policy.minimumAgeYears && age <= policy.maximumAgeYears;
}

export function isValidBvnFormat(bvn: string): boolean {
  return /^\d{11}$/.test(bvn);
}
