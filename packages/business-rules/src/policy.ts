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

/** Absolute ceiling on tenor: Pay with ARAF financing can never exceed 24 months. */
export const ABSOLUTE_MAX_TENOR_MONTHS = 24;

export const creditPolicyRulesSchema = z
  .object({
    scoreRange: z.object({ min: z.number().int(), max: z.number().int() }),
    scoreBands: z.array(scoreBandSchema).min(1),
    thinFileTreatment: z.enum(['DECLINE', 'MANUAL_REVIEW']),
    /** Salary earners: total monthly obligations ÷ recognised monthly salary must not exceed this. */
    maxRepaymentToIncomeRatio: decimalString,
    /** Business owners: total monthly obligations ÷ average monthly turnover must not exceed this. */
    maxRepaymentToTurnoverRatio: decimalString,
    obligationsSource: z.enum(['BUREAU', 'STATEMENT', 'MAX']),
    singleObligorLimitKobo: koboString,
    exposureBasis: z.enum(['FINANCING_AMOUNT', 'DEFERRED_SALE_PRICE']),
    approvedTenorsMonths: z.array(z.number().int().positive()).min(1),
    /** Longest tenor the policy allows (never above ABSOLUTE_MAX_TENOR_MONTHS). */
    maxTenorMonths: z.number().int().positive().max(ABSOLUTE_MAX_TENOR_MONTHS),
    /**
     * Default profit rate PER ANNUM in basis points (2500 = 25% p.a.), used when a financing
     * product does not set its own rate. Each partner product carries its own approved rate.
     */
    defaultAnnualProfitRateBps: z.number().int().min(0).max(10_000),
    statementMonths: z.object({ SALARY_EARNER: z.number().int().positive(), BUSINESS_OWNER: z.number().int().positive() }),
    businessOwnerManualReview: z.boolean(),
    /** Customer equity: the customer may pay part of the price to the merchant; only the remainder is financed. */
    customerEquityEnabled: z.boolean(),
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
    for (const t of rules.approvedTenorsMonths) {
      if (t > rules.maxTenorMonths) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Approved tenor ${t} exceeds the maximum tenor of ${rules.maxTenorMonths} months` });
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
  maxRepaymentToTurnoverRatio: '0.10',
  obligationsSource: 'MAX',
  singleObligorLimitKobo: '500000000', // ₦5,000,000
  exposureBasis: 'FINANCING_AMOUNT',
  approvedTenorsMonths: [3, 6, 9, 12, 18, 24],
  maxTenorMonths: 24,
  defaultAnnualProfitRateBps: 2500, // 25% per annum
  statementMonths: { SALARY_EARNER: 6, BUSINESS_OWNER: 12 },
  businessOwnerManualReview: false,
  customerEquityEnabled: true,
  minimumFinancingKobo: '2000000', // ₦20,000 (sandbox assumption)
  offerValidityMinutes: 60 * 24,
  assessmentValidityDays: 30,
  minimumAgeYears: 18,
  maximumAgeYears: 65,
  enhancedReviewRequiresChecker: true,
  businessOwnerContactWindowHours: { min: 24, max: 48 },
  pdfMaxBytes: 5 * 1024 * 1024,
};

/**
 * Policy versions are immutable records. Versions stored before per-annum pricing (which used
 * `markupTiers` of 25% / 50% total and `partialFinancingEnabled`) are read with the equivalent
 * per-annum fields so in-flight applications remain readable; their accepted offers keep the
 * amounts priced at the time.
 */
function upgradeLegacyRules(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const r = { ...(input as Record<string, unknown>) };
  if ('markupTiers' in r && !('defaultAnnualProfitRateBps' in r)) {
    const tiers = r.markupTiers as Array<{ maxTenorMonths: number; markupBps: number }>;
    const first = [...tiers].sort((a, b) => a.maxTenorMonths - b.maxTenorMonths)[0];
    r.defaultAnnualProfitRateBps = Math.round((first.markupBps * 12) / first.maxTenorMonths);
    r.maxTenorMonths = Math.min(ABSOLUTE_MAX_TENOR_MONTHS, Math.max(...tiers.map((t) => t.maxTenorMonths)));
    delete r.markupTiers;
  }
  if (!('maxRepaymentToTurnoverRatio' in r)) r.maxRepaymentToTurnoverRatio = '0.10';
  if ('partialFinancingEnabled' in r && !('customerEquityEnabled' in r)) {
    r.customerEquityEnabled = r.partialFinancingEnabled;
    delete r.partialFinancingEnabled;
  }
  return r;
}

export function parsePolicyRules(input: unknown): CreditPolicyRules {
  return creditPolicyRulesSchema.parse(upgradeLegacyRules(input));
}
