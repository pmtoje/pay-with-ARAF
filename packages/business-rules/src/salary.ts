import { minK, type Kobo } from './money';

/**
 * Salary consolidation and recognised-income rules (salary earners).
 *
 * Source rule (SWR): assess six months; recognised salary is the lowest verified consolidated
 * monthly salary; a confirmed missing salary month leads to decline. Data problems
 * (technical failure, incomplete coverage, uncertain classification) must route to correction
 * or review rather than automatic decline.
 */

export type TxClassification = 'SALARY' | 'POSSIBLE_SALARY' | 'SELF_TRANSFER' | 'OTHER';

export interface StatementCredit {
  id: string;
  /** ISO date YYYY-MM-DD */
  date: string;
  amount: Kobo;
  narration: string;
  classification: TxClassification;
  counterpartyName?: string;
}

export interface StatementCoverage {
  /** ISO date YYYY-MM-DD inclusive */
  periodStart: string;
  /** ISO date YYYY-MM-DD inclusive */
  periodEnd: string;
  /** Provider/bank attestation that the statement is complete and reliable. */
  reliable: boolean;
}

export type MonthStatus = 'VERIFIED' | 'MISSING' | 'UNCERTAIN' | 'NOT_COVERED';

export interface MonthSalary {
  month: string; // YYYY-MM
  status: MonthStatus;
  consolidated: Kobo;
  transactionIds: string[];
}

export type SalaryOutcome =
  | { kind: 'RECOGNISED'; recognisedMonthlySalary: Kobo; months: MonthSalary[] }
  | { kind: 'DECLINE_MISSING_SALARY'; months: MonthSalary[] }
  | { kind: 'REVIEW_REQUIRED'; reasons: string[]; months: MonthSalary[] };

/** The N most recent complete calendar months before `asOf` (oldest first), as YYYY-MM. */
export function requiredMonths(asOf: Date, count: number): string[] {
  const out: string[] = [];
  let y = asOf.getUTCFullYear();
  let m = asOf.getUTCMonth(); // current month index; we start with the previous month
  for (let i = 0; i < count; i++) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    out.unshift(`${y}-${String(m + 1).padStart(2, '0')}`);
  }
  return out;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

export function monthFullyCovered(month: string, coverage: StatementCoverage): boolean {
  return coverage.periodStart <= `${month}-01` && coverage.periodEnd >= lastDayOfMonth(month);
}

function normaliseName(s: string | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
}

/**
 * De-duplicate credits: identical provider IDs, and exact duplicates of
 * (date, amount, narration) which are a common artefact of statement merges.
 */
export function dedupeCredits(credits: StatementCredit[]): StatementCredit[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const out: StatementCredit[] = [];
  for (const c of credits) {
    const key = `${c.date}|${c.amount}|${c.narration.trim().toUpperCase()}`;
    if (seenIds.has(c.id) || seenKeys.has(key)) continue;
    seenIds.add(c.id);
    seenKeys.add(key);
    out.push(c);
  }
  return out;
}

export function consolidateSalary(
  credits: StatementCredit[],
  coverage: StatementCoverage,
  months: string[],
  accountHolderName?: string,
): MonthSalary[] {
  const holder = normaliseName(accountHolderName);
  const clean = dedupeCredits(credits).filter((c) => c.amount > 0n);
  return months.map((month) => {
    if (!monthFullyCovered(month, coverage)) {
      return { month, status: 'NOT_COVERED', consolidated: 0n, transactionIds: [] };
    }
    const inMonth = clean.filter((c) => c.date.startsWith(month));
    const salary = inMonth.filter(
      (c) =>
        c.classification === 'SALARY' &&
        // Never treat a transfer from the account holder to themselves as salary.
        !(holder && normaliseName(c.counterpartyName) === holder),
    );
    if (salary.length > 0) {
      const consolidated = salary.reduce((s, c) => s + c.amount, 0n);
      return { month, status: consolidated > 0n ? 'VERIFIED' : 'MISSING', consolidated, transactionIds: salary.map((c) => c.id) };
    }
    if (inMonth.some((c) => c.classification === 'POSSIBLE_SALARY')) {
      return { month, status: 'UNCERTAIN', consolidated: 0n, transactionIds: [] };
    }
    return { month, status: 'MISSING', consolidated: 0n, transactionIds: [] };
  });
}

export function assessSalary(
  credits: StatementCredit[],
  coverage: StatementCoverage,
  months: string[],
  accountHolderName?: string,
): SalaryOutcome {
  const monthResults = consolidateSalary(credits, coverage, months, accountHolderName);
  const reasons: string[] = [];
  if (!coverage.reliable) reasons.push('STATEMENT_NOT_RELIABLE');
  if (monthResults.some((m) => m.status === 'NOT_COVERED')) reasons.push('INSUFFICIENT_STATEMENT_COVERAGE');
  if (monthResults.some((m) => m.status === 'UNCERTAIN')) reasons.push('UNCERTAIN_SALARY_CLASSIFICATION');

  const missing = monthResults.some((m) => m.status === 'MISSING');
  // A decline for missing salary is only safe when the statement is complete and reliable.
  if (missing && reasons.length === 0) return { kind: 'DECLINE_MISSING_SALARY', months: monthResults };
  if (reasons.length > 0) return { kind: 'REVIEW_REQUIRED', reasons, months: monthResults };

  const recognised = minK(...monthResults.map((m) => m.consolidated));
  return { kind: 'RECOGNISED', recognisedMonthlySalary: recognised, months: monthResults };
}
