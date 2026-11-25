import { z } from 'zod';

/**
 * Versioned credit policy rules.
 *
 * IMPORTANT: The default policy below encodes the PROPOSED interpretations from the
 * SeedFi Standard Work Request (SWR) and the product specification. It is NOT an approved
 * Bank policy. Every value is configurable via a maker-checker approved policy version
 * and must be confirmed by Credit Risk, Legal and Shariah governance before production.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'Decimal string expected');
const koboString = z.string().regex(/^\d+$/, 'Integer kobo string expected');

export const scoreBandSchema = z.object({
  band: z.enum(['POOR', 'FAIR', 'GOOD']),
  min: z.number().int(),
  max: z.number().int(),
  action: z.enum(['DECLINE', 'ENHANCED_REVIEW', 'PROCEED']),
});

export const markupTierSchema = z.object({
  minTenorMonths: z.number().int().positive(),
  maxTenorMonths: z.number().int().positive(),
  /** Total markup over the tenor in basis points (2500 = 25% total, not per month). */
  markupBps: z.number().int().nonnegative(),
});

export const creditPolicyRulesSchema = z
  .object({
    scoreRange: z.object({ min: z.number().int(), max: z.number().int() }),
    scoreBands: z.array(scoreBandSchema).min(1),
    thinFileTreatment: z.enum(['DECLINE', 'MANUAL_REVIEW']),
    maxRepaymentToIncomeRatio: decimalString,
    obligationsSource: z.enum(['BUREAU', 'STATEMENT', 'MAX']),
    singleObligorLimitKobo: koboString,
    exposureBasis: z.enum(['FINANCING_AMOUNT', 'DEFERRED_SALE_PRICE']),
    approvedTenorsMonths: z.array(z.number().int().positive()).min(1),
    markupTiers: z.array(markupTierSchema).min(1),
    statementMonths: z.object({ SALARY_EARNER: z.number().int().positive(), BUSINESS_OWNER: z.number().int().positive() }),
    businessOwnerManualReview: z.boolean(),
    partialFinancingEnabled: z.boolean(),
    minimumFinancingKobo: koboString,
    offerValidityMinutes: z.number().int().positive(),
    assessmentValidityDays: z.number().int().positive(),
    minimumAgeYears: z.number().int().positive(),
    maximumAgeYears: z.number().int().positive(),
    enhancedReviewRequiresChecker: z.boolean(),
    businessOwnerContactWindowHours: z.object({ min: z.number().int(), max: z.number().int() }),
    pdfMaxBytes: z.number().int().positive(),
  })
  .superRefine((rules, ctx) => {
    const sorted = [...rules.scoreBands].sort((a, b) => a.min - b.min);
    let expected = rules.scoreRange.min;
    for (const band of sorted) {
      if (band.min !== expected) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Score bands must be contiguous; expected band starting at ${expected}` });
        return;
      }
      if (band.max < band.min) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Band max below min' });
      expected = band.max + 1;
    }
    if (expected - 1 !== rules.scoreRange.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Score bands must cover the full score range' });
    }
    const tiers = [...rules.markupTiers].sort((a, b) => a.minTenorMonths - b.minTenorMonths);
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i].minTenorMonths <= tiers[i - 1].maxTenorMonths) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Markup tiers overlap' });
      }
    }
    for (const t of rules.approvedTenorsMonths) {
      if (!tiers.some((tier) => t >= tier.minTenorMonths && t <= tier.maxTenorMonths)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Approved tenor ${t} has no markup tier` });
      }
    }
    if (rules.minimumAgeYears >= rules.maximumAgeYears) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Minimum age must be below maximum age' });
    }
  });

export type CreditPolicyRules = z.infer<typeof creditPolicyRulesSchema>;

/** PROPOSED sandbox policy derived from the SeedFi SWR. Not an approved Bank policy. */
export const PROPOSED_SANDBOX_POLICY: CreditPolicyRules = {
  scoreRange: { min: 280, max: 800 },
  scoreBands: [
    { band: 'POOR', min: 280, max: 529, action: 'DECLINE' },
    { band: 'FAIR', min: 530, max: 619, action: 'ENHANCED_REVIEW' },
    { band: 'GOOD', min: 620, max: 800, action: 'PROCEED' },
  ],
  thinFileTreatment: 'MANUAL_REVIEW',
  maxRepaymentToIncomeRatio: '0.333',
  obligationsSource: 'MAX',
  singleObligorLimitKobo: '500000000', // ₦5,000,000
  exposureBasis: 'FINANCING_AMOUNT',
  approvedTenorsMonths: [3, 6, 9, 12, 18, 24],
  markupTiers: [
    { minTenorMonths: 1, maxTenorMonths: 12, markupBps: 2500 },
    { minTenorMonths: 13, maxTenorMonths: 24, markupBps: 5000 },
  ],
  statementMonths: { SALARY_EARNER: 6, BUSINESS_OWNER: 12 },
  businessOwnerManualReview: true,
  partialFinancingEnabled: false,
  minimumFinancingKobo: '2000000', // ₦20,000 (sandbox assumption)
  offerValidityMinutes: 60 * 24,
  assessmentValidityDays: 30,
  minimumAgeYears: 18,
  maximumAgeYears: 65,
  enhancedReviewRequiresChecker: true,
  businessOwnerContactWindowHours: { min: 24, max: 48 },
  pdfMaxBytes: 5 * 1024 * 1024,
};

export function parsePolicyRules(input: unknown): CreditPolicyRules {
  return creditPolicyRulesSchema.parse(input);
}
