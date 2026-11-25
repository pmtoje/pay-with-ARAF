import type { NormalizedAnalysis, RawStatement, StatementTransaction } from '../interfaces';
import type { SandboxIdentity } from './scenarios';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const K = (naira: number) => BigInt(Math.round(naira)) * 100n;

function ym(date: Date): [number, number] {
  return [date.getUTCFullYear(), date.getUTCMonth()];
}

function iso(y: number, m: number, d: number): string {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * Generate a deterministic synthetic statement for a sandbox identity.
 * The 12-entry profile arrays are aligned so the last element is the most recent complete month.
 */
export function generateStatement(identity: SandboxIdentity, asOf: Date, months: number, historyMonths = 12): RawStatement {
  const holder = `${identity.firstName} ${identity.lastName}`.toUpperCase();
  const p = identity.statement;
  const covered = Math.min(months, historyMonths, 12);
  const txs: StatementTransaction[] = [];
  const [ay, am] = ym(asOf);
  const startOffset = covered; // months back from current month
  for (let back = covered; back >= 1; back--) {
    const d = new Date(Date.UTC(ay, am - back, 1));
    const [y, m] = ym(d);
    const idx = 12 - back; // index into 12-month profile arrays
    const tag = `${identity.bvn.slice(-4)}-${y}${String(m + 1).padStart(2, '0')}`;
    const mon = MONTHS[m];
    if (p.kind === 'SALARY') {
      const amt = p.monthlySalaryNaira?.[idx] ?? null;
      if (amt !== null) {
        if (p.uncertainMonths?.includes(idx)) {
          txs.push({ id: `${tag}-S`, date: iso(y, m, 27), amount: K(amt), narration: `TRANSFER ${p.employer?.slice(0, 10)} REF${y}${m}`, counterpartyName: p.employer });
        } else if (p.splitMonths?.includes(idx)) {
          txs.push({ id: `${tag}-S1`, date: iso(y, m, 15), amount: K(amt / 2), narration: `SALARY ${p.employer} ${mon} PART 1`, counterpartyName: p.employer });
          txs.push({ id: `${tag}-S2`, date: iso(y, m, 28), amount: K(amt / 2), narration: `SALARY ${p.employer} ${mon} PART 2`, counterpartyName: p.employer });
        } else {
          txs.push({ id: `${tag}-S`, date: iso(y, m, 26), amount: K(amt), narration: `SALARY ${p.employer} ${mon}`, counterpartyName: p.employer });
        }
      }
    } else {
      const rev = p.monthlyRevenueNaira?.[idx] ?? 0;
      for (let w = 0; w < 4; w++) {
        txs.push({ id: `${tag}-R${w}`, date: iso(y, m, 3 + w * 7), amount: K(rev / 4), narration: w % 2 ? 'POS SETTLEMENT' : 'TRF FROM CUSTOMER', counterpartyName: 'VARIOUS' });
      }
      txs.push({ id: `${tag}-OPEX`, date: iso(y, m, 20), amount: -K(rev * 0.62), narration: 'SUPPLIER PAYMENT', counterpartyName: 'SUPPLIERS' });
    }
    if (p.otherMonthlyInflowNaira > 0) {
      txs.push({ id: `${tag}-SELF`, date: iso(y, m, 9), amount: K(p.otherMonthlyInflowNaira * 0.6), narration: `TRF FROM ${holder}`, counterpartyName: holder });
      txs.push({ id: `${tag}-OTH`, date: iso(y, m, 12), amount: K(p.otherMonthlyInflowNaira * 0.4), narration: 'POS REVERSAL', counterpartyName: 'ACQUIRER' });
    }
    if (p.monthlyObligationsNaira > 0) {
      txs.push({ id: `${tag}-OBL`, date: iso(y, m, 2), amount: -K(p.monthlyObligationsNaira), narration: 'LOAN REPAYMENT QUICKCREDIT', counterpartyName: 'QUICKCREDIT MFB' });
    }
    txs.push({ id: `${tag}-SPEND`, date: iso(y, m, 18), amount: -K(((p.monthlySalaryNaira?.[idx] ?? p.monthlyRevenueNaira?.[idx] ?? 100_000) || 100_000) * 0.35), narration: 'POS PURCHASE', counterpartyName: 'MERCHANTS' });
  }
  const start = new Date(Date.UTC(ay, am - startOffset, 1)).toISOString().slice(0, 10);
  const end = new Date(asOf.getTime() - 86_400_000).toISOString().slice(0, 10);
  return { accountName: holder, periodStart: covered > 0 ? start : end, periodEnd: end, transactions: txs };
}

/** Simulated Periculum-style classification and aggregation. */
export function analyseStatement(stmt: RawStatement, reference: string, identity: SandboxIdentity | undefined): NormalizedAnalysis {
  const holder = stmt.accountName.toUpperCase();
  const credits = stmt.transactions
    .filter((t) => t.amount > 0n)
    .map((t) => {
      const n = t.narration.toUpperCase();
      const classification: NormalizedAnalysis['credits'][number]['classification'] = n.startsWith('SALARY')
        ? 'SALARY'
        : n.startsWith('TRANSFER') && t.counterpartyName === identity?.statement.employer
          ? 'POSSIBLE_SALARY'
          : (t.counterpartyName ?? '').toUpperCase() === holder
            ? 'SELF_TRANSFER'
            : 'OTHER';
      return { id: t.id, date: t.date, amount: t.amount, narration: t.narration, classification, counterpartyName: t.counterpartyName };
    });
  const months = new Set(stmt.transactions.map((t) => t.date.slice(0, 7))).size || 1;
  const inflow = stmt.transactions.filter((t) => t.amount > 0n).reduce((s, t) => s + t.amount, 0n);
  const outflow = stmt.transactions.filter((t) => t.amount < 0n).reduce((s, t) => s - t.amount, 0n);
  const obligations = stmt.transactions.filter((t) => t.narration.includes('LOAN REPAYMENT'));
  const obligationMonths = new Set(obligations.map((t) => t.date.slice(0, 7))).size || 1;
  const recurring = obligations.length ? obligations.reduce((s, t) => s - t.amount, 0n) / BigInt(obligationMonths) : 0n;
  const isBusiness = identity?.statement.kind === 'BUSINESS';
  const revenue = isBusiness
    ? credits.filter((c) => c.classification === 'OTHER').reduce((s, c) => s + c.amount, 0n) / BigInt(months)
    : null;
  return {
    analysisReference: reference,
    periodStart: stmt.periodStart,
    periodEnd: stmt.periodEnd,
    accountHolderName: stmt.accountName,
    reliable: true,
    statementQuality: 'GOOD',
    confidence: 'HIGH',
    averageMonthlyInflow: inflow / BigInt(months),
    averageMonthlyOutflow: outflow / BigInt(months),
    averageBalance: K(identity?.statement.averageBalanceNaira ?? 100_000),
    recurringObligations: recurring,
    existingFinancingRepayments: recurring,
    businessRevenueMonthly: revenue,
    cashFlowConsistency: isBusiness ? 'VARIABLE' : 'STABLE',
    stressIndicators: recurring * 3n > inflow / BigInt(months) ? ['HIGH_DEBT_SERVICE'] : [],
    credits,
    providerRecommendedAmount: null,
  };
}
