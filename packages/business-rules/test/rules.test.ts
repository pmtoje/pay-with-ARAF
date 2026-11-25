import { describe, expect, it } from 'vitest';
import {
  PROPOSED_SANDBOX_POLICY as P,
  ageInYears,
  assessSalary,
  availableMonthlyCapacity,
  canTransition,
  classifyScore,
  compareEligibilityToCart,
  computeEligibility,
  dedupeCredits,
  deriveCustomerStatus,
  deriveMerchantStatus,
  evaluateReleaseGate,
  evaluateVendorPaymentPreconditions,
  exposureAmountFor,
  formatNaira,
  isOfferAffordable,
  isWithinRatio,
  markupBpsForTenor,
  maxAffordableFinancing,
  parseDecimal,
  parsePolicyRules,
  priceDeferredSale,
  remainingExposure,
  requiredMonths,
  resolveExistingObligations,
  validateCart,
  APPLICATION_STATES,
  PRE_RELEASE_CONDITIONS,
  UnsupportedTenorError,
  type ReleaseGateInput,
  type StatementCredit,
} from '../src';

const N = (naira: number) => BigInt(naira) * 100n; // naira → kobo

describe('credit score classification (spec §64)', () => {
  it.each([
    [279, 'INVALID_RESPONSE'],
    [280, 'POOR'],
    [529, 'POOR'],
    [530, 'FAIR'],
    [619, 'FAIR'],
    [620, 'GOOD'],
    [800, 'GOOD'],
    [801, 'INVALID_RESPONSE'],
  ])('score %i → %s', (score, expected) => {
    const c = classifyScore(score, P);
    expect(c.kind === 'BAND' ? c.band : c.kind).toBe(expected);
  });

  it('maps bands to actions', () => {
    expect(classifyScore(300, P)).toMatchObject({ action: 'DECLINE' });
    expect(classifyScore(560, P)).toMatchObject({ action: 'ENHANCED_REVIEW' });
    expect(classifyScore(700, P)).toMatchObject({ action: 'PROCEED' });
  });

  it('never coerces a missing score to zero / poor', () => {
    expect(classifyScore(null, P)).toEqual({ kind: 'NO_SCORE', action: 'MANUAL_REVIEW' });
    expect(classifyScore(undefined, P)).toEqual({ kind: 'NO_SCORE', action: 'MANUAL_REVIEW' });
  });

  it('treats malformed scores as invalid responses, not poor credit', () => {
    expect(classifyScore('650', P).kind).toBe('INVALID_RESPONSE');
    expect(classifyScore(650.5, P).kind).toBe('INVALID_RESPONSE');
    expect(classifyScore(NaN, P).kind).toBe('INVALID_RESPONSE');
    expect(classifyScore(0, P).kind).toBe('INVALID_RESPONSE');
  });
});

describe('policy validation', () => {
  it('accepts the proposed sandbox policy', () => {
    expect(() => parsePolicyRules(P)).not.toThrow();
  });
  it('rejects gaps in score bands', () => {
    const bad = { ...P, scoreBands: [P.scoreBands[0], P.scoreBands[2]] };
    expect(() => parsePolicyRules(bad)).toThrow(/contiguous/);
  });
  it('rejects approved tenors with no markup tier', () => {
    expect(() => parsePolicyRules({ ...P, approvedTenorsMonths: [12, 36] })).toThrow(/no markup tier/);
  });
});

describe('affordability ratio boundaries (exact decimals)', () => {
  const income = 100_000_000n; // ₦1,000,000 → ratios measured in kobo
  it('33.299% is within limit', () => expect(isWithinRatio(33_299_000n, income, P)).toBe(true));
  it('33.300% is within limit', () => expect(isWithinRatio(33_300_000n, income, P)).toBe(true));
  it('33.301% is above limit', () => expect(isWithinRatio(33_301_000n, income, P)).toBe(false));
  it('33.3000001% is above limit (no float rounding)', () => expect(isWithinRatio(33_300_001n, income, P)).toBe(false));
  it('zero income is never within limit', () => expect(isWithinRatio(0n, 0n, P)).toBe(false));
  it('negative income is never within limit', () => expect(isWithinRatio(1n, -5n, P)).toBe(false));
});

describe('available capacity', () => {
  it('matches the specification example (₦480,000 salary, ₦50,000 obligations → ₦109,840)', () => {
    expect(availableMonthlyCapacity(N(480_000), N(50_000), P)).toBe(N(109_840));
  });
  it('zero obligations gives the full ratio of income', () => {
    expect(availableMonthlyCapacity(N(300_000), 0n, P)).toBe(N(99_900));
  });
  it('obligations exceeding capacity give zero, never negative', () => {
    expect(availableMonthlyCapacity(N(100_000), N(80_000), P)).toBe(0n);
  });
  it('zero and negative income give zero', () => {
    expect(availableMonthlyCapacity(0n, 0n, P)).toBe(0n);
    expect(availableMonthlyCapacity(-1n, 0n, P)).toBe(0n);
  });
  it('rejects negative obligations', () => {
    expect(() => availableMonthlyCapacity(N(100_000), -1n, P)).toThrow();
  });
  it('resolves obligations from bureau / statement per policy', () => {
    expect(resolveExistingObligations(N(10), N(20), P)).toBe(N(20));
    expect(resolveExistingObligations(null, N(20), { ...P, obligationsSource: 'BUREAU' })).toBe(0n);
  });
});

describe('markup and tenor (spec §28, §64)', () => {
  it('12 months = 25% total markup', () => expect(markupBpsForTenor(12, P)).toBe(2500));
  it('13 months = 50% total markup', () => expect(markupBpsForTenor(13, P)).toBe(5000));
  it('24 months = 50% total markup', () => expect(markupBpsForTenor(24, P)).toBe(5000));
  it('25 months is unsupported under the initial policy', () => {
    expect(() => markupBpsForTenor(25, P)).toThrow(UnsupportedTenorError);
  });
  it('rejects zero / fractional tenors', () => {
    expect(() => markupBpsForTenor(0, P)).toThrow(UnsupportedTenorError);
    expect(() => markupBpsForTenor(1.5, P)).toThrow(UnsupportedTenorError);
  });
  it('prices a deferred sale exactly: DSP = F × 1.25 for 12 months', () => {
    const p = priceDeferredSale(N(450_000), 12, P);
    expect(p.deferredSalePrice).toBe(N(562_500));
    expect(p.profitAmount).toBe(N(112_500));
    expect(p.monthlyRepayment).toBe(N(46_875));
  });
  it('prices a deferred sale exactly: DSP = F × 1.50 for 18 months', () => {
    expect(priceDeferredSale(N(1_000_000), 18, P).deferredSalePrice).toBe(N(1_500_000));
  });
  it('schedule reconciles exactly to DSP with a final-instalment adjustment', () => {
    for (const [f, t] of [
      [100_001n, 12],
      [3_333_337n, 9],
      [99_999_999n, 24],
      [7n, 3],
      [45_000_000n, 6],
    ] as const) {
      const p = priceDeferredSale(f, t, P);
      const sum = p.instalments.reduce((s, i) => s + i.amount, 0n);
      expect(sum).toBe(p.deferredSalePrice);
      expect(p.instalments).toHaveLength(t);
      const last = p.instalments[t - 1].amount;
      expect(last > 0n).toBe(true);
      if (p.deferredSalePrice >= BigInt(t * t)) {
        expect(last <= p.monthlyRepayment).toBe(true);
        expect(p.monthlyRepayment - last < BigInt(t)).toBe(true);
        expect(p.maxInstalment).toBe(p.monthlyRepayment);
      }
    }
  });
});

describe('maximum affordable financing', () => {
  it('matches the specification example (₦1,054,464 for 12 months)', () => {
    expect(maxAffordableFinancing(N(109_840), 12, P)).toBe(N(1_054_464));
  });
  it('the result never produces an instalment above capacity, and +1 kobo would', () => {
    for (const cap of [1n, 99n, 12_345n, 10_984_000n, 7_777_777n]) {
      for (const t of P.approvedTenorsMonths) {
        const max = maxAffordableFinancing(cap, t, P);
        expect(priceDeferredSale(max, t, P).maxInstalment <= cap).toBe(true);
        if (cap > 1000n) expect(priceDeferredSale(max + 1n, t, P).maxInstalment > cap).toBe(true);
      }
    }
  });
  it('zero capacity gives zero', () => expect(maxAffordableFinancing(0n, 12, P)).toBe(0n));
});

describe('single obligor exposure (spec §27, §64)', () => {
  const limit = BigInt(P.singleObligorLimitKobo);
  it('below limit leaves the remainder', () => {
    expect(remainingExposure({ existingBankExposure: N(1_000_000), otherActiveReservations: 0n }, P)).toBe(limit - N(1_000_000));
  });
  it('exactly at limit leaves zero', () => {
    expect(remainingExposure({ existingBankExposure: limit, otherActiveReservations: 0n }, P)).toBe(0n);
  });
  it('above limit leaves zero, never negative', () => {
    expect(remainingExposure({ existingBankExposure: limit + 1n, otherActiveReservations: 0n }, P)).toBe(0n);
  });
  it('counts concurrent reservations', () => {
    expect(remainingExposure({ existingBankExposure: N(3_000_000), otherActiveReservations: N(1_500_000) }, P)).toBe(N(500_000));
  });
  it('eligibility is capped by remaining exposure', () => {
    const r = computeEligibility(
      {
        recognisedMonthlyIncome: N(5_000_000),
        existingMonthlyObligations: 0n,
        exposure: { existingBankExposure: N(4_800_000), otherActiveReservations: 0n },
        partnerMaxAmount: null,
      },
      P,
    );
    expect(r.maxEligibleAmount).toBe(N(200_000));
    expect(r.tenors.every((t) => t.limitingFactor === 'EXPOSURE')).toBe(true);
  });
  it('offer affordable exactly at remaining exposure and not 1 kobo above', () => {
    const cap = N(1_000_000);
    expect(isOfferAffordable(N(200_000), 12, cap, N(200_000), P)).toBe(true);
    expect(isOfferAffordable(N(200_000) + 1n, 12, cap, N(200_000), P)).toBe(false);
  });
  it('supports deferred-sale-price exposure basis', () => {
    expect(exposureAmountFor(N(100_000), 12, { ...P, exposureBasis: 'DEFERRED_SALE_PRICE' })).toBe(N(125_000));
  });
  it('unapproved tenors are never affordable', () => {
    expect(isOfferAffordable(N(1), 7, N(1_000_000), N(1_000_000), P)).toBe(false);
  });
});

describe('salary assessment (spec §25)', () => {
  const asOf = new Date('2026-11-25T10:00:00Z');
  const months = requiredMonths(asOf, 6);
  const coverage = { periodStart: '2026-05-01', periodEnd: '2026-11-20', reliable: true };
  const salary = (id: string, date: string, naira: number, extra: Partial<StatementCredit> = {}): StatementCredit => ({
    id,
    date,
    amount: N(naira),
    narration: 'SALARY ACME LTD',
    classification: 'SALARY',
    counterpartyName: 'ACME LTD',
    ...extra,
  });
  const example = [
    salary('1', '2026-05-28', 500_000),
    salary('2', '2026-06-27', 500_000),
    salary('3', '2026-07-28', 520_000),
    salary('4', '2026-08-28', 480_000),
    salary('5', '2026-09-26', 500_000),
    salary('6', '2026-10-28', 550_000),
  ];

  it('derives the six most recent complete months', () => {
    expect(months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(requiredMonths(new Date('2026-02-10T00:00:00Z'), 3)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('recognises the lowest verified monthly salary (spec example → ₦480,000)', () => {
    const r = assessSalary(example, coverage, months);
    expect(r.kind).toBe('RECOGNISED');
    if (r.kind === 'RECOGNISED') expect(r.recognisedMonthlySalary).toBe(N(480_000));
  });

  it('consolidates legitimately split salary payments', () => {
    const split = [...example.filter((c) => c.id !== '4'), salary('4a', '2026-08-15', 240_000), salary('4b', '2026-08-28', 260_000, { narration: 'SALARY BAL' })];
    const r = assessSalary(split, coverage, months);
    expect(r.kind === 'RECOGNISED' && r.recognisedMonthlySalary).toBe(N(500_000));
  });

  it('does not double count duplicate transactions', () => {
    const dup = [...example, { ...example[3] }, { ...example[3], id: 'dup-x' }];
    expect(dedupeCredits(dup)).toHaveLength(6);
    const r = assessSalary(dup, coverage, months);
    expect(r.kind === 'RECOGNISED' && r.recognisedMonthlySalary).toBe(N(480_000));
  });

  it('declines when a complete reliable statement confirms a missing salary month', () => {
    const r = assessSalary(example.filter((c) => c.id !== '3'), coverage, months);
    expect(r.kind).toBe('DECLINE_MISSING_SALARY');
  });

  it('treats zero salary as missing', () => {
    const r = assessSalary([...example.filter((c) => c.id !== '3'), { ...salary('3', '2026-07-28', 0) }], coverage, months);
    expect(r.kind).toBe('DECLINE_MISSING_SALARY');
  });

  it('routes insufficient statement history to review, not decline', () => {
    const r = assessSalary(example.slice(2), { ...coverage, periodStart: '2026-07-01' }, months);
    expect(r).toMatchObject({ kind: 'REVIEW_REQUIRED', reasons: ['INSUFFICIENT_STATEMENT_COVERAGE'] });
  });

  it('routes uncertain salary classification to review', () => {
    const r = assessSalary(
      [...example.filter((c) => c.id !== '2'), salary('2', '2026-06-27', 500_000, { classification: 'POSSIBLE_SALARY' })],
      coverage,
      months,
    );
    expect(r).toMatchObject({ kind: 'REVIEW_REQUIRED', reasons: ['UNCERTAIN_SALARY_CLASSIFICATION'] });
  });

  it('routes unreliable statements to review even when a month is missing', () => {
    const r = assessSalary(example.slice(1), { ...coverage, reliable: false }, months);
    expect(r.kind).toBe('REVIEW_REQUIRED');
  });

  it('never treats self-transfers or other deposits as salary', () => {
    const selfTx = salary('s', '2026-07-10', 900_000, { counterpartyName: 'ADA OBI', narration: 'TRF FROM ADA OBI' });
    const other = salary('o', '2026-07-11', 900_000, { classification: 'OTHER', narration: 'POS REFUND' });
    const r = assessSalary([...example.filter((c) => c.id !== '3'), selfTx, other], coverage, months, 'Ada Obi');
    expect(r.kind).toBe('DECLINE_MISSING_SALARY');
  });
});

describe('cart validation and comparison (spec §12, §29)', () => {
  const rules = { eligibleCategories: ['electronics'], minAmount: N(20_000), maxAmount: N(5_000_000), allowMultipleVendors: false };
  const line = { sku: 'A', name: 'Phone', quantity: 1, unitAmount: N(450_000), category: 'electronics', vendorReference: 'V1' };
  it('accepts correct arithmetic', () => expect(validateCart([line], N(450_000), rules)).toEqual([]));
  it('rejects amount manipulation', () => expect(validateCart([line], N(1_000), rules)).toContain('AMOUNT_MISMATCH'));
  it('rejects invalid quantity', () => expect(validateCart([{ ...line, quantity: 0 }], 0n, rules)).toContain('INVALID_QUANTITY'));
  it('rejects ineligible categories', () => expect(validateCart([{ ...line, category: 'alcohol' }], N(450_000), rules)).toContain('CATEGORY_NOT_ELIGIBLE'));
  it('rejects mixed vendors when not supported', () =>
    expect(validateCart([line, { ...line, sku: 'B', vendorReference: 'V2' }], N(900_000), rules)).toContain('MULTIPLE_VENDORS_NOT_SUPPORTED'));

  it('Scenario A: eligible ₦1,000,000 vs cart ₦450,000 → finance the cart', () => {
    expect(compareEligibilityToCart(N(1_000_000), N(450_000), false, N(20_000))).toEqual({
      outcome: 'FULL_FINANCING',
      financingAmount: N(450_000),
      contributionAmount: 0n,
    });
  });
  it('Scenario B: eligible equals cart → full financing', () => {
    expect(compareEligibilityToCart(N(450_000), N(450_000), false, N(20_000)).outcome).toBe('FULL_FINANCING');
  });
  it('Scenario C (partial enabled): contribution of the shortfall', () => {
    expect(compareEligibilityToCart(N(300_000), N(450_000), true, N(20_000))).toEqual({
      outcome: 'PARTIAL_FINANCING',
      financingAmount: N(300_000),
      contributionAmount: N(150_000),
    });
  });
  it('Scenario C (partial disabled, default): cart revision required', () => {
    expect(compareEligibilityToCart(N(300_000), N(450_000), false, N(20_000))).toMatchObject({ outcome: 'CART_REVISION_REQUIRED', shortfall: N(150_000) });
  });
  it('Scenario D: zero eligibility declines', () => {
    expect(compareEligibilityToCart(0n, N(450_000), true, N(20_000))).toEqual({ outcome: 'DECLINED', reason: 'NO_ELIGIBILITY' });
  });
});

describe('goods release gate (spec §37, §64)', () => {
  const allConditions = PRE_RELEASE_CONDITIONS.map((code) => ({ code, satisfied: true }));
  const base: ReleaseGateInput = {
    payment: { status: 'CONFIRMED', confirmedByAuthoritativeSource: true, amount: N(450_000), beneficiaryAccountId: 'acct-1' },
    expectedVendorPaymentAmount: N(450_000),
    approvedBeneficiaryAccountId: 'acct-1',
    requiredConditions: allConditions,
    contribution: { required: false, verified: false },
    activeHolds: [],
    orderValid: true,
    financingApproved: true,
  };
  const blocked = (i: ReleaseGateInput) => evaluateReleaseGate(i).authorized === false;

  it('eligibility only: blocked', () => expect(blocked({ ...base, financingApproved: false, payment: null })).toBe(true));
  it('financing approved (no payment): blocked', () => expect(blocked({ ...base, payment: null })).toBe(true));
  it('financing booked (no payment): blocked', () => expect(blocked({ ...base, payment: null })).toBe(true));
  for (const status of ['INITIATED', 'PROCESSING', 'FAILED', 'UNKNOWN', 'REVERSED', 'RECONCILIATION_REQUIRED', 'PENDING_APPROVAL'] as const) {
    it(`payment ${status}: blocked`, () => expect(blocked({ ...base, payment: { ...base.payment!, status } })).toBe(true));
  }
  it('payment confirmed but not from the authoritative source: blocked', () =>
    expect(blocked({ ...base, payment: { ...base.payment!, confirmedByAuthoritativeSource: false } })).toBe(true));
  it('payment confirmed but contractual condition missing: blocked', () => {
    const r = evaluateReleaseGate({ ...base, requiredConditions: allConditions.map((c) => (c.code === 'SALE_CONTRACT_EXECUTED' ? { ...c, satisfied: false } : c)) });
    expect(r.authorized).toBe(false);
    expect(r.pendingConditions).toEqual(['SALE_CONTRACT_EXECUTED']);
  });
  it('amount mismatch: blocked', () => expect(blocked({ ...base, payment: { ...base.payment!, amount: N(449_999) } })).toBe(true));
  it('beneficiary mismatch: blocked', () => expect(blocked({ ...base, payment: { ...base.payment!, beneficiaryAccountId: 'acct-2' } })).toBe(true));
  it('contribution not verified: blocked', () => expect(blocked({ ...base, contribution: { required: true, verified: false } })).toBe(true));
  it('active cancellation hold: blocked', () => expect(blocked({ ...base, activeHolds: ['CANCELLATION_REQUESTED'] })).toBe(true));
  it('invalid order: blocked', () => expect(blocked({ ...base, orderValid: false })).toBe(true));
  it('payment confirmed and all conditions satisfied: authorized', () => {
    expect(evaluateReleaseGate(base)).toEqual({ authorized: true, blockers: [], pendingConditions: [] });
  });
});

describe('vendor payment preconditions', () => {
  const ok = {
    financingApproved: true,
    bookingConfirmed: true,
    bookingRequiredBeforePayment: true,
    beneficiaryVerified: true,
    invoiceApproved: true,
    orderValid: true,
    prePaymentConditions: [{ code: 'MANDATE_ACTIVE', satisfied: true }],
    contribution: { required: false, verified: false },
    existingLivePaymentInstruction: false,
    activeHolds: [],
  };
  it('allows when every precondition holds', () => expect(evaluateVendorPaymentPreconditions(ok)).toEqual([]));
  it('blocks duplicate payment instructions', () =>
    expect(evaluateVendorPaymentPreconditions({ ...ok, existingLivePaymentInstruction: true })).toContain('DUPLICATE_PAYMENT_INSTRUCTION'));
  it('blocks without confirmed booking when booking precedes payment', () =>
    expect(evaluateVendorPaymentPreconditions({ ...ok, bookingConfirmed: false })).toContain('BOOKING_NOT_CONFIRMED'));
});

describe('state machine', () => {
  it('prevents skipping mandatory steps', () => {
    expect(canTransition('APPLICATION', 'IDENTITY_PENDING', 'ELIGIBLE')).toBe(false);
    expect(canTransition('APPLICATION', 'OFFER_PRESENTED', 'FINANCING_APPROVED')).toBe(false);
    expect(canTransition('APPLICATION', 'FINANCING_BOOKED', 'RELEASE_AUTHORIZED')).toBe(false);
    expect(canTransition('APPLICATION', 'VENDOR_PAYMENT_PENDING', 'RELEASE_AUTHORIZED')).toBe(false);
  });
  it('allows the happy path end to end', () => {
    const path = [
      'CREATED', 'IDENTITY_PENDING', 'IDENTITY_VERIFIED', 'CREDIT_CHECK_PENDING', 'CREDIT_CHECK_COMPLETED',
      'ACCOUNT_VERIFICATION_PENDING', 'ACCOUNT_VERIFIED', 'STATEMENT_PENDING', 'STATEMENT_RECEIVED',
      'STATEMENT_VALIDATION_PENDING', 'STATEMENT_ANALYSIS_PENDING', 'STATEMENT_ANALYSIS_COMPLETED', 'ELIGIBLE',
      'OFFER_PRESENTED', 'OFFER_ACCEPTED', 'ARAF_SUBMISSION_PENDING', 'ARAF_SUBMITTED', 'ARAF_UNDER_REVIEW',
      'FINANCING_APPROVED', 'DOCUMENTATION_PENDING', 'MANDATE_PENDING', 'BOOKING_PENDING', 'FINANCING_BOOKED',
      'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED', 'RELEASE_AUTHORIZED', 'GOODS_DISPATCHED',
      'GOODS_DELIVERED', 'COMPLETED',
    ];
    for (let i = 1; i < path.length; i++) expect(canTransition('APPLICATION', path[i - 1], path[i])).toBe(true);
  });
  it('terminal states have no exits', () => {
    for (const s of ['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED']) {
      expect(APPLICATION_STATES.filter((t) => canTransition('APPLICATION', s, t))).toEqual([]);
    }
  });
  it('payment UNKNOWN cannot be retried as a new initiation', () => {
    expect(canTransition('PAYMENT', 'UNKNOWN', 'INITIATED')).toBe(false);
    expect(canTransition('PAYMENT', 'FAILED', 'INITIATED')).toBe(false);
  });
  it('derives statuses for every application state without leaking approval early', () => {
    for (const s of APPLICATION_STATES) {
      expect(deriveCustomerStatus(s).label).toBeTruthy();
      expect(deriveMerchantStatus(s)).toBeTruthy();
    }
    expect(deriveCustomerStatus('OFFER_PRESENTED').description).toMatch(/indicative/i);
    expect(deriveCustomerStatus('ARAF_SUBMITTED').description).toMatch(/not yet approved/i);
    expect(deriveMerchantStatus('VENDOR_PAYMENT_CONFIRMED')).not.toBe('READY_FOR_RELEASE');
  });
});

describe('helpers', () => {
  it('formats naira without floating point', () => {
    expect(formatNaira(45_000_000n)).toBe('₦450,000.00');
    expect(formatNaira(1n)).toBe('₦0.01');
  });
  it('parses decimals exactly', () => expect(parseDecimal('33.3', true)).toEqual({ num: 333n, den: 1000n }));
  it('computes age by calendar date', () => {
    expect(ageInYears('2008-11-25', new Date('2026-11-25T00:00:00Z'))).toBe(18);
    expect(ageInYears('2008-11-26', new Date('2026-11-25T00:00:00Z'))).toBe(17);
    expect(() => ageInYears('2001-02-30', new Date())).toThrow();
  });
});
