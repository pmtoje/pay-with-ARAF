import { randomUUID } from 'node:crypto';
import { ProviderError, type CallContext, type CreditAssessmentProvider, type CreditAssessmentResponse } from '../interfaces';

/**
 * SeedFi Loan Engine — Seed Score, per SeedFi API documentation v2.0 (April 2026). This is the same
 * contract the Bank's ARAF application already uses (pmtoje/ARAF, src/server/altphones/integrations.ts):
 *
 *   POST {base}/scoring/api/v1/seed-score/calculate      header X-API-Key
 *   body: customer_id, first_name, last_name, bvn, date_of_birth (YYYY-MM-DD), phone_number (0XXXXXXXXXX),
 *         gender ("male" | "female"), optional loan_duration_in_month
 *   response: { credit_score: { overall_seedfi_score, reviewed_seedfi_score, user_has_credit_history,
 *               payment_history, depth_of_credit, open_credit, demographics, validity_date?, is_dummy_data? } }
 *             (possibly wrapped as { status, data })
 *
 * Seed Scores run from 280 (highest risk) to 800 (lowest risk). The decision uses the REVIEWED score
 * (SeedFi lowers it for adverse behaviour), rounded DOWN to a whole number so rounding can never move a
 * customer into a better band. A customer SeedFi reports as having no credit history is returned with
 * no score, so the Bank's thin-file policy applies (never treated as a zero or a pass).
 *
 * SeedFi does not return bureau monthly obligations or outstanding exposure; those come from the
 * statement analysis and the Bank's own exposure records. Anything unexpected is INVALID_RESPONSE —
 * never a pass.
 */
export const SEED_SCORE_MIN = 280;
export const SEED_SCORE_MAX = 800;

export interface SeedfiOptions {
  baseUrl: string;
  apiKey: string;
  assessPath?: string;
  timeoutMs?: number;
  /** Production: refuse SeedFi staging responses marked is_dummy_data. */
  rejectDummyData: boolean;
  fetchImpl?: typeof fetch;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN);
const inRange = (n: number) => Number.isFinite(n) && n >= SEED_SCORE_MIN && n <= SEED_SCORE_MAX;

/** SeedFi expects the local 11-digit form (0XXXXXXXXXX). */
export function seedfiPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (/^\+234\d{10}$/.test(digits)) return `0${digits.slice(4)}`;
  if (/^234\d{10}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0\d{10}$/.test(digits)) return digits;
  throw new ProviderError('SeedFi', 'REJECTED', 'The BVN-linked phone number is not a Nigerian mobile number.');
}

export interface ParsedSeedScore {
  reviewedScore: number;
  overallScore: number;
  hasCreditHistory: boolean | null;
  validUntil: string | null;
  isDummyData: boolean;
  components: Record<string, unknown>;
}

/** Validate a Seed Score response; anything unexpected is an INVALID_RESPONSE, never a pass. */
export function parseSeedScore(body: unknown): ParsedSeedScore {
  const top = obj(body);
  const data = obj(top.data ?? top);
  const cs = obj(data.credit_score ?? data);
  const overall = num(cs.overall_seedfi_score);
  const reviewed = Number.isFinite(num(cs.reviewed_seedfi_score)) ? num(cs.reviewed_seedfi_score) : overall;
  if (!inRange(overall) || !inRange(reviewed)) throw new ProviderError('SeedFi', 'INVALID_RESPONSE', 'No valid Seed Score (280–800) in the response.');
  const components: Record<string, unknown> = {};
  for (const k of ['payment_history', 'depth_of_credit', 'open_credit', 'demographics']) if (cs[k] && typeof cs[k] === 'object') components[k] = cs[k];
  const validity = cs.validity_date ?? data.validity_date;
  return {
    reviewedScore: reviewed,
    overallScore: overall,
    hasCreditHistory: typeof cs.user_has_credit_history === 'boolean' ? cs.user_has_credit_history : null,
    validUntil: typeof validity === 'string' ? validity.slice(0, 10) : null,
    isDummyData: cs.is_dummy_data === true || data.is_dummy_data === true,
    components,
  };
}

export class SeedfiHttpProvider implements CreditAssessmentProvider {
  readonly name = 'SeedFi Seed Score (live)';
  constructor(private readonly opts: SeedfiOptions) {}

  async assess(
    input: { bvn: string; firstName: string; lastName: string; dateOfBirth: string; phone?: string; gender?: 'male' | 'female'; customerId?: string; tenorMonths?: number },
    ctx: CallContext,
  ): Promise<CreditAssessmentResponse> {
    if (!input.phone) throw new ProviderError('SeedFi', 'REJECTED', 'SeedFi requires the BVN-linked phone number.');
    if (input.gender !== 'male' && input.gender !== 'female') throw new ProviderError('SeedFi', 'REJECTED', 'SeedFi requires the gender on the BVN record.');
    const customerId = input.customerId ?? `pwa-${randomUUID()}`;
    const body: Record<string, unknown> = {
      customer_id: customerId,
      first_name: input.firstName,
      last_name: input.lastName,
      bvn: input.bvn,
      date_of_birth: input.dateOfBirth,
      phone_number: seedfiPhone(input.phone),
      gender: input.gender,
    };
    if (input.tenorMonths) body.loan_duration_in_month = input.tenorMonths;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl.replace(/\/$/, '')}${this.opts.assessPath ?? '/scoring/api/v1/seed-score/calculate'}`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-Key': this.opts.apiKey, 'X-Correlation-Id': ctx.correlationId },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ProviderError('SeedFi', (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError('SeedFi', 'AUTHENTICATION_FAILED');
    if (res.status === 404) throw new ProviderError('SeedFi', 'NOT_FOUND');
    if (res.status >= 500 || res.status === 429) throw new ProviderError('SeedFi', 'UNAVAILABLE', `HTTP ${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ProviderError('SeedFi', 'INVALID_RESPONSE');
    }
    if (!res.ok) throw new ProviderError('SeedFi', 'REJECTED', `HTTP ${res.status}`);
    const s = parseSeedScore(json);
    if (s.isDummyData && this.opts.rejectDummyData) throw new ProviderError('SeedFi', 'INVALID_RESPONSE', 'SeedFi returned test (dummy) data for a production record.');
    return {
      // SeedFi returns no separate reference; the request's customer id identifies the score.
      providerReference: customerId,
      score: s.hasCreditHistory === false ? null : Math.floor(s.reviewedScore),
      hasCreditHistory: s.hasCreditHistory !== false,
      bureauMonthlyObligations: null,
      outstandingExposure: null,
      delinquencyIndicators: [],
    };
  }
}
