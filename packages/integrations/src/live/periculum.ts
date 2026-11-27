import { ProviderError, type AnalysisSource, type CallContext, type NormalizedAnalysis, type StatementAnalysisProvider } from '../interfaces';

/**
 * Periculum Insights — bank statement analysis, per Periculum's published API reference
 * (insights-periculum.readme.io). The same API the Bank's ARAF application already uses.
 *
 *   Token        POST {authUrl}  form: client_id, client_secret, grant_type=client_credentials
 *   Submit PDF   PUT  {base}/statements                  multipart: File, Password, statementType (CONSUMER | BUSINESS)
 *   Analytics    GET  {base}/statements/{statementKey}   processingStatus + cashFlowAnalysis, incomeAnalysis,
 *                                                        behavioralAnalysis, spendAnalysis, transactionPatternAnalysis
 *   Transactions GET  {base}/statements/{statementKey}/transactions   [{ date, amount, type, description, balance }]
 *
 * processingStatus: UPLOADED | PROCESSING | PROCESSED | FAILED | INSUFFIENT BALANCE (sic) | NO BALANCE |
 * NO TRANSACTIONS | NOT ENOUGH TRANSACTIONS | ALTERED.
 *
 * Mapping to the Bank's rules (the Bank, not Periculum, decides):
 *  - Salary: credits matching Periculum's own `incomeAnalysis.salaryTransactions` (same date and amount) are SALARY;
 *    credits matching `transactionPatternAnalysis.selfTransferInflowTransactions` are SELF_TRANSFER; all others OTHER.
 *  - Existing obligations: `behavioralAnalysis.averageMonthlyLoanRepaymentAmount` (debt repayments, not living costs).
 *  - Averages: `cashFlowAnalysis.averageMonthlyCredits / averageMonthlyDebits / averageMonthlyBalance`.
 *  - Amounts are naira in Periculum's responses and are converted to kobo.
 *  - The statement counts as reliable only when parsing confidence is reported and high; otherwise a missing
 *    salary month goes to review, never to an automatic decline.
 *
 * Only PDF statements are sent. Periculum's JSON analytics endpoint (POST /statements/analytics) does not document
 * its body, so transaction-list sources (AltBank / Mono) are refused here until Periculum confirms that format.
 */
export interface PericulumOptions {
  baseUrl: string;
  authUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const P = 'Periculum';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** Naira (as returned) → kobo. */
export const toKobo = (naira: number | null): bigint => (naira === null ? 0n : BigInt(Math.round(naira * 100)));
const yes = (v: unknown) => v === true || (typeof v === 'string' && /^(yes|true)$/i.test(v.trim()));

export class PericulumHttpProvider implements StatementAnalysisProvider {
  readonly name = 'Periculum Insights (live)';
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly opts: PericulumOptions) {}

  private base() {
    return this.opts.baseUrl.replace(/\/$/, '');
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 60_000);
    try {
      return await (this.opts.fetchImpl ?? fetch)(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      throw new ProviderError(P, (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  private async accessToken(force = false): Promise<string> {
    // Refresh five minutes before expiry, as Periculum recommends.
    if (!force && this.token && this.token.expiresAt - 5 * 60_000 > Date.now()) return this.token.value;
    const res = await this.fetchWithTimeout(this.opts.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.opts.clientId, client_secret: this.opts.clientSecret, grant_type: 'client_credentials' }).toString(),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new ProviderError(P, 'AUTHENTICATION_FAILED');
    if (!res.ok) throw new ProviderError(P, 'UNAVAILABLE', `token HTTP ${res.status}`);
    const t = obj(await res.json().catch(() => null));
    const value = typeof t.access_token === 'string' ? t.access_token : '';
    const expiresIn = num(t.expires_in) ?? 0;
    if (!value || expiresIn <= 0) throw new ProviderError(P, 'INVALID_RESPONSE', 'token');
    this.token = { value, expiresAt: Date.now() + expiresIn * 1000 };
    return value;
  }

  /** Authenticated call; a 401 refreshes the token once. */
  private async api(path: string, init: RequestInit): Promise<Response> {
    const call = async (tok: string) => this.fetchWithTimeout(`${this.base()}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${tok}` } });
    let res = await call(await this.accessToken());
    if (res.status === 401) res = await call(await this.accessToken(true));
    return res;
  }

  private async readError(res: Response): Promise<never> {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      const b = obj(JSON.parse(text));
      for (const k of ['message', 'error_description', 'error', 'title']) if (typeof b[k] === 'string' && b[k]) message = String(b[k]).slice(0, 300);
    } catch {
      /* not JSON */
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(P, 'AUTHENTICATION_FAILED');
    if (res.status === 404) throw new ProviderError(P, 'NOT_FOUND');
    if (res.status === 429 || res.status >= 500) throw new ProviderError(P, 'UNAVAILABLE', `HTTP ${res.status}`);
    throw new ProviderError(P, 'REJECTED', message || `HTTP ${res.status}`);
  }

  async submit(input: { reference: string; source: AnalysisSource; months: number }, _ctx: CallContext): Promise<{ jobRef: string }> {
    if (input.source.kind !== 'PDF') {
      throw new ProviderError(P, 'REJECTED', 'PDF_REQUIRED: Periculum has not documented the JSON transaction format; send the statement as a PDF.');
    }
    const form = new FormData();
    // A deterministic file name: a re-submission of the same statement is refused by Periculum
    // ("same name has already been analyzed") instead of being analysed and billed twice.
    form.append('File', new Blob([new Uint8Array(input.source.document)], { type: 'application/pdf' }), `${input.reference}-${input.months}m.pdf`);
    form.append('Password', '');
    form.append('statementType', input.months >= 12 ? 'BUSINESS' : 'CONSUMER');
    const res = await this.api('/statements', { method: 'PUT', body: form });
    if (!res.ok) return this.readError(res);
    const body = obj(await res.json().catch(() => null));
    const key = num(body.key);
    if (key === null || !Number.isInteger(key)) throw new ProviderError(P, 'INVALID_RESPONSE', 'no statement key');
    return { jobRef: String(key) };
  }

  async getResult(jobRef: string, _ctx: CallContext) {
    if (!/^\d{1,18}$/.test(jobRef)) throw new ProviderError(P, 'REJECTED', 'invalid statement key');
    const res = await this.api(`/statements/${jobRef}`, { method: 'GET' });
    if (!res.ok) return this.readError(res);
    const a = obj(await res.json().catch(() => null));
    const status = String(a.processingStatus ?? '').trim().toUpperCase();
    if (status === 'UPLOADED' || status === 'PROCESSING' || status === '') return { status: 'PROCESSING' as const };
    if (status !== 'PROCESSED') {
      const code =
        status === 'ALTERED' ? 'STATEMENT_ALTERED'
        : status === 'NO TRANSACTIONS' || status === 'NOT ENOUGH TRANSACTIONS' ? 'NOT_ENOUGH_TRANSACTIONS'
        : status === 'INSUFFIENT BALANCE' || status === 'INSUFFICIENT BALANCE' || status === 'NO BALANCE' ? 'PROVIDER_CREDIT_EXHAUSTED'
        : 'ANALYSIS_FAILED';
      return { status: 'FAILED' as const, code };
    }
    const txRes = await this.api(`/statements/${jobRef}/transactions`, { method: 'GET' });
    if (!txRes.ok) return this.readError(txRes);
    const txs = await txRes.json().catch(() => null);
    if (!Array.isArray(txs)) throw new ProviderError(P, 'INVALID_RESPONSE', 'transactions');
    return { status: 'COMPLETED' as const, analysis: mapPericulumAnalysis(jobRef, a, txs) };
  }
}

/** Map Periculum's documented analytics + transactions onto the Bank's normalised analysis. Exported for tests. */
export function mapPericulumAnalysis(jobRef: string, a: Record<string, unknown>, txs: unknown[]): NormalizedAnalysis {
  const cash = obj(a.cashFlowAnalysis);
  const income = obj(a.incomeAnalysis);
  const behaviour = obj(a.behavioralAnalysis);
  const pattern = obj(a.transactionPatternAnalysis);
  const periodStart = day(a.startDate) ?? day(cash.firstDateInStatement);
  const periodEnd = day(a.endDate) ?? day(cash.lastDateInStatement);
  if (!periodStart || !periodEnd) throw new ProviderError(P, 'INVALID_RESPONSE', 'statement period');

  const key = (d: string | null, amt: number | null) => (d && amt !== null ? `${d}|${Math.round(Math.abs(amt) * 100)}` : '');
  const salary = new Set(arr(income.salaryTransactions).map((s) => key(day(s.date), num(s.amount))).filter(Boolean));
  const selfIn = new Set(arr(pattern.selfTransferInflowTransactions).map((s) => key(day(s.date), num(s.amount))).filter(Boolean));

  const credits: NormalizedAnalysis['credits'] = [];
  txs.map(obj).forEach((t, i) => {
    const amount = num(t.amount);
    const date = day(t.date);
    const type = String(t.type ?? '').toLowerCase();
    if (amount === null || !date || type === 'debit' || type === 'dr') return;
    if (amount <= 0 && type !== 'credit' && type !== 'cr') return;
    const k = key(date, amount);
    credits.push({
      id: `${jobRef}-${i}`,
      date,
      amount: toKobo(Math.abs(amount)),
      narration: String(t.description ?? '').slice(0, 300),
      classification: salary.has(k) ? 'SALARY' : selfIn.has(k) ? 'SELF_TRANSFER' : 'OTHER',
    });
  });

  // Parsing confidence: reported as a fraction or a percentage; a statement is "reliable" only when it is high.
  let confidence = num(a.confidenceOnParsing);
  if (confidence !== null && confidence > 1) confidence = confidence / 100;
  const quality = confidence === null ? 'FAIR' : confidence >= 0.9 ? 'GOOD' : confidence >= 0.75 ? 'FAIR' : 'POOR';

  const monthly = arr(cash.monthlyInflow).map((m) => num(m.amount)).filter((n): n is number => n !== null);
  const mean = monthly.length ? monthly.reduce((s, n) => s + n, 0) / monthly.length : 0;
  const cv = mean > 0 ? Math.sqrt(monthly.reduce((s, n) => s + (n - mean) ** 2, 0) / monthly.length) / mean : 1;

  const stress: string[] = [];
  if (yes(behaviour.gamblingStatus)) stress.push('GAMBLING');
  if ((num(pattern.returnCheque) ?? 0) > 0) stress.push('RETURNED_CHEQUES');
  if (yes(behaviour.accountSweep)) stress.push('ACCOUNT_SWEEP');
  if ((num(pattern.missingTransactions) ?? 0) > 0 || yes(pattern.missingTransactions)) stress.push('MISSING_TRANSACTIONS');

  const loanRepayments = toKobo(num(behaviour.averageMonthlyLoanRepaymentAmount));
  return {
    analysisReference: `PERICULUM-${jobRef}`,
    periodStart,
    periodEnd,
    accountHolderName: String(a.accountName ?? a.clientFullName ?? ''),
    reliable: confidence !== null && confidence >= 0.9,
    statementQuality: quality,
    confidence: confidence === null ? 'MEDIUM' : confidence >= 0.9 ? 'HIGH' : confidence >= 0.75 ? 'MEDIUM' : 'LOW',
    averageMonthlyInflow: toKobo(num(cash.averageMonthlyCredits)),
    averageMonthlyOutflow: toKobo(num(cash.averageMonthlyDebits)),
    averageBalance: toKobo(num(cash.averageMonthlyBalance)),
    recurringObligations: loanRepayments,
    existingFinancingRepayments: loanRepayments,
    businessRevenueMonthly: String(a.statementType ?? '').toUpperCase().startsWith('BUSINESS') ? toKobo(num(cash.averageMonthlyCredits)) : null,
    cashFlowConsistency: cv < 0.25 ? 'STABLE' : cv < 0.6 ? 'VARIABLE' : 'VOLATILE',
    stressIndicators: stress,
    credits,
    providerRecommendedAmount: null,
  };
}
