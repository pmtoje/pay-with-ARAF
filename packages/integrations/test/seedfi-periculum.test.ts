import { describe, expect, it } from 'vitest';
import { PericulumHttpProvider, ProviderError, SeedfiHttpProvider, mapPericulumAnalysis, seedfiPhone } from '../src';

const ctx = { correlationId: 'corr-test-0001' } as never;
const person = { bvn: '22212345678', firstName: 'Ada', lastName: 'Obi', dateOfBirth: '1990-04-12', phone: '+2348030000001', gender: 'female' as const, customerId: 'pwa-cust-1' };

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const seedfi = (impl: typeof fetch, rejectDummyData = true) => new SeedfiHttpProvider({ baseUrl: 'https://stg-loan-engine.theseedfi.com', apiKey: 'k'.repeat(20), rejectDummyData, fetchImpl: impl });

describe('SeedFi Seed Score (live adapter, API v2.0)', () => {
  it('sends the documented request and uses the reviewed score, rounded down', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { status: 'success', data: { credit_score: { overall_seedfi_score: 701.4, reviewed_seedfi_score: 655.9, user_has_credit_history: true, payment_history: { on_time: 0.9 } } } } }));
    const r = await seedfi(f.impl).assess(person, ctx);
    expect(f.calls[0].url).toBe('https://stg-loan-engine.theseedfi.com/scoring/api/v1/seed-score/calculate');
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h['X-API-Key']).toBe('k'.repeat(20));
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ customer_id: 'pwa-cust-1', first_name: 'Ada', last_name: 'Obi', bvn: '22212345678', date_of_birth: '1990-04-12', phone_number: '08030000001', gender: 'female' });
    expect(r.score).toBe(655);
    expect(r.providerReference).toBe('pwa-cust-1');
    // SeedFi does not report bureau obligations: they come from the statement analysis.
    expect(r.bureauMonthlyObligations).toBeNull();
  });

  it('returns no score for a customer without credit history (thin-file policy applies)', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { credit_score: { overall_seedfi_score: 520, reviewed_seedfi_score: 520, user_has_credit_history: false } } }));
    const r = await seedfi(f.impl).assess(person, ctx);
    expect(r.score).toBeNull();
    expect(r.hasCreditHistory).toBe(false);
  });

  it('never turns an unexpected answer into a pass', async () => {
    const bad = fakeFetch(() => ({ status: 200, body: { credit_score: { overall_seedfi_score: 950 } } }));
    await expect(seedfi(bad.impl).assess(person, ctx)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const dummy = fakeFetch(() => ({ status: 200, body: { credit_score: { overall_seedfi_score: 700, reviewed_seedfi_score: 700, user_has_credit_history: true, is_dummy_data: true } } }));
    await expect(seedfi(dummy.impl, true).assess(person, ctx)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect((await seedfi(dummy.impl, false).assess(person, ctx)).score).toBe(700);
    const down = fakeFetch(() => ({ status: 503, body: {} }));
    await expect(seedfi(down.impl).assess(person, ctx)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const auth = fakeFetch(() => ({ status: 401, body: {} }));
    await expect(seedfi(auth.impl).assess(person, ctx)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });

  it('requires the BVN-linked phone and gender, and formats Nigerian numbers', async () => {
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    await expect(seedfi(f.impl).assess({ ...person, gender: undefined }, ctx)).rejects.toBeInstanceOf(ProviderError);
    await expect(seedfi(f.impl).assess({ ...person, phone: undefined }, ctx)).rejects.toBeInstanceOf(ProviderError);
    expect(f.calls).toHaveLength(0);
    expect(seedfiPhone('+2348031234567')).toBe('08031234567');
    expect(seedfiPhone('08031234567')).toBe('08031234567');
    expect(() => seedfiPhone('+447700900123')).toThrow();
  });
});

/** Shaped like Periculum's documented GET /statements/{key} sample (camelCase, naira amounts). */
const analytics = {
  key: 4411,
  accountName: 'ADA OBI',
  statementType: 'CONSUMER',
  startDate: '2026-05-01T00:00:00',
  endDate: '2026-10-31T00:00:00',
  processingStatus: 'PROCESSED',
  confidenceOnParsing: 0.97,
  cashFlowAnalysis: {
    averageMonthlyCredits: 610000.5,
    averageMonthlyDebits: 480000,
    averageMonthlyBalance: 125000,
    monthlyInflow: [500000, 520000, 510000, 505000, 515000, 600000].map((amount, i) => ({ year: 2026, month_name: String(i), amount })),
  },
  incomeAnalysis: { isSalaryEarner: 'Yes', salaryTransactions: [{ date: '2026-05-25', description: 'SALARY MAY ACME LTD', amount: 450000 }] },
  behavioralAnalysis: { averageMonthlyLoanRepaymentAmount: 35000, gamblingStatus: 'No' },
  transactionPatternAnalysis: { selfTransferInflowTransactions: [{ date: '2026-05-27', amount: 20000 }], returnCheque: 0 },
};
const transactions = [
  { date: '2026-05-25', amount: 450000, type: 'credit', description: 'SALARY MAY ACME LTD', balance: 460000 },
  { date: '2026-05-26', amount: 9000, type: 'debit', description: 'POS', balance: 451000 },
  { date: '2026-05-27', amount: 20000, type: 'credit', description: 'TRF FROM ADA OBI', balance: 471000 },
  { date: '2026-05-28', amount: 1500, type: 'credit', description: 'REVERSAL', balance: 472500 },
];

describe('Periculum Insights (live adapter)', () => {
  it("marks Periculum's detected salary payments as salary and maps the averages to kobo", () => {
    const a = mapPericulumAnalysis('4411', analytics, transactions);
    expect(a.periodStart).toBe('2026-05-01');
    expect(a.periodEnd).toBe('2026-10-31');
    expect(a.credits.map((c) => c.classification)).toEqual(['SALARY', 'SELF_TRANSFER', 'OTHER']);
    expect(a.credits[0].amount).toBe(45_000_000n);
    expect(a.averageMonthlyInflow).toBe(61_000_050n);
    expect(a.recurringObligations).toBe(3_500_000n);
    expect(a.reliable).toBe(true);
    expect(a.statementQuality).toBe('GOOD');
    expect(a.cashFlowConsistency).toBe('STABLE');
    expect(a.businessRevenueMonthly).toBeNull();
  });

  it('treats a statement without a reported parsing confidence as not reliable (review, never auto-decline)', () => {
    const { confidenceOnParsing: _c, ...rest } = analytics;
    expect(mapPericulumAnalysis('4411', rest, transactions).reliable).toBe(false);
  });

  it('uploads the PDF as documented, polls until processed, and refreshes an expired token once', async () => {
    let tokens = 0;
    let first401 = true;
    const f = fakeFetch((url, init) => {
      if (url.includes('/openid-connect/token')) return { status: 200, body: { access_token: `tok-${++tokens}`, expires_in: 3600, token_type: 'Bearer' } };
      if (url.endsWith('/statements') && init.method === 'PUT') {
        if (first401) {
          first401 = false;
          return { status: 401, body: {} };
        }
        return { status: 200, body: { key: 4411, processingStatus: 'UPLOADED' } };
      }
      if (url.endsWith('/statements/4411/transactions')) return { status: 200, body: transactions };
      if (url.endsWith('/statements/4411')) return { status: 200, body: analytics };
      return { status: 404, body: {} };
    });
    const p = new PericulumHttpProvider({ baseUrl: 'https://api.insights-periculum.io', authUrl: 'https://insightsb2b.auth-periculum.app/realms/prod/protocol/openid-connect/token', clientId: 'id', clientSecret: 's+e%c', fetchImpl: f.impl });
    const pdf = Buffer.from('%PDF-1.4 test');
    const { jobRef } = await p.submit({ reference: 'ARAF-2026-000099', source: { kind: 'PDF', document: pdf, filename: 'x.pdf' }, months: 6 }, ctx);
    expect(jobRef).toBe('4411');
    expect(tokens).toBe(2);
    const put = f.calls.filter((c) => c.init.method === 'PUT').pop()!;
    const form = put.init.body as FormData;
    expect((form.get('File') as File).name).toBe('ARAF-2026-000099-6m.pdf');
    expect(form.get('statementType')).toBe('CONSUMER');
    expect((put.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
    expect(String(f.calls[0].init.body)).toContain('client_secret=s%2Be%25c');
    const r = await p.getResult(jobRef, ctx);
    expect(r.status).toBe('COMPLETED');
  });

  it('reports processing and documented failure statuses, and refuses non-PDF sources', async () => {
    const statuses = ['PROCESSING', 'ALTERED', 'NOT ENOUGH TRANSACTIONS', 'INSUFFIENT BALANCE', 'FAILED'];
    const out: unknown[] = [];
    for (const s of statuses) {
      const f = fakeFetch((url) => (url.includes('token') ? { status: 200, body: { access_token: 't', expires_in: 3600, token_type: 'Bearer' } } : { status: 200, body: { processingStatus: s } }));
      out.push(await new PericulumHttpProvider({ baseUrl: 'https://p', authUrl: 'https://a/token', clientId: 'i', clientSecret: 's', fetchImpl: f.impl }).getResult('1', ctx));
    }
    expect(out).toEqual([
      { status: 'PROCESSING' },
      { status: 'FAILED', code: 'STATEMENT_ALTERED' },
      { status: 'FAILED', code: 'NOT_ENOUGH_TRANSACTIONS' },
      { status: 'FAILED', code: 'PROVIDER_CREDIT_EXHAUSTED' },
      { status: 'FAILED', code: 'ANALYSIS_FAILED' },
    ]);
    const f = fakeFetch(() => ({ status: 200, body: {} }));
    const p = new PericulumHttpProvider({ baseUrl: 'https://p', authUrl: 'https://a/token', clientId: 'i', clientSecret: 's', fetchImpl: f.impl });
    await expect(p.submit({ reference: 'R', source: { kind: 'TRANSACTIONS', statement: { accountName: 'A', periodStart: '2026-01-01', periodEnd: '2026-06-30', transactions: [] }, origin: 'ALTBANK' }, months: 6 }, ctx)).rejects.toMatchObject({ code: 'REJECTED' });
    expect(f.calls).toHaveLength(0);
  });
});
