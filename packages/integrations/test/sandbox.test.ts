import { describe, expect, it } from 'vitest';
import { assessSalary, requiredMonths, PROPOSED_SANDBOX_POLICY as P, availableMonthlyCapacity, maxAffordableFinancing } from '@araf/business-rules';
import { analyseStatement, findSandboxIdentity, generateStatement, SANDBOX_IDENTITIES, liveProviders, IntegrationNotConfiguredError } from '../src';

const asOf = new Date('2026-11-25T09:00:00Z');
const run = (bvn: string) => {
  const id = findSandboxIdentity(bvn)!;
  const stmt = generateStatement(id, asOf, 6, id.altBankHistoryMonths);
  const a = analyseStatement(stmt, 'ref', id);
  return assessSalary(a.credits, { periodStart: a.periodStart, periodEnd: a.periodEnd, reliable: a.reliable }, requiredMonths(asOf, 6), a.accountHolderName);
};

describe('sandbox simulator → Bank salary rules', () => {
  it('reproduces the specification example end to end (₦480,000 → ₦1,054,464)', () => {
    const r = run('22200000001');
    expect(r.kind).toBe('RECOGNISED');
    if (r.kind !== 'RECOGNISED') return;
    expect(r.recognisedMonthlySalary).toBe(48_000_000n);
    const cap = availableMonthlyCapacity(r.recognisedMonthlySalary, 5_000_000n, P);
    expect(maxAffordableFinancing(cap, 12, P, { annualProfitRateBps: 2500 })).toBe(105_446_400n);
  });
  it('missing salary month → decline', () => expect(run('22200000011').kind).toBe('DECLINE_MISSING_SALARY'));
  it('uncertain salary → review', () => expect(run('22200000015').kind).toBe('REVIEW_REQUIRED'));
  it('split salary consolidated', () => {
    const r = run('22200000016');
    expect(r.kind === 'RECOGNISED' && r.recognisedMonthlySalary).toBe(60_000_000n);
  });
  it('self transfers are never salary', () => {
    const id = findSandboxIdentity('22200000001')!;
    const a = analyseStatement(generateStatement(id, asOf, 6), 'r', id);
    expect(a.credits.filter((c) => c.narration.startsWith('TRF FROM')).every((c) => c.classification === 'SELF_TRANSFER')).toBe(true);
  });
  it('identities use the reserved synthetic BVN range', () => {
    for (const i of SANDBOX_IDENTITIES) expect(i.bvn).toMatch(/^222000000\d{2}$/);
  });
  it('live adapters fail closed', async () => {
    const live = liveProviders();
    expect(() => live.payments.initiate({} as never, { correlationId: 'x' })).toThrow(IntegrationNotConfiguredError);
    expect(() => live.credit.assess({} as never, { correlationId: 'x' })).toThrow(IntegrationNotConfiguredError);
  });
});
