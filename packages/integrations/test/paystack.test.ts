import { describe, expect, it } from 'vitest';
import { PaystackCardProvider } from '../src';

const ctx = { correlationId: 'corr-test-0001' } as never;
function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const p = (impl: typeof fetch) => new PaystackCardProvider({ secretKey: 'sk_test_xxxxxxxxxxxx', fetchImpl: impl });

describe('Paystack backup card (live adapter)', () => {
  it('starts a card-only check and saves a reusable card from the verified transaction', async () => {
    const f = fakeFetch((url) =>
      url.endsWith('/transaction/initialize')
        ? { status: 200, body: { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'card-ref-1' } } }
        : { status: 200, body: { status: true, data: { id: 9911, status: 'success', amount: 5000, gateway_response: 'Approved', authorization: { authorization_code: 'AUTH_x1', reusable: true, last4: '4081', exp_month: '12', exp_year: '2030', card_type: 'visa ', bank: 'TEST BANK', channel: 'card', signature: 'SIG_1' } } } },
    );
    const start = await p(f.impl).startCardLink({ reference: 'card-ref-1', email: 'a@b.co', amountKobo: 5000n, callbackUrl: 'https://pay.example/c/x/card/return', metadata: { a: '1' } }, ctx);
    expect(start.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(body).toMatchObject({ email: 'a@b.co', amount: 5000, currency: 'NGN', reference: 'card-ref-1', channels: ['card'] });
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_xxxxxxxxxxxx');
    const v = await p(f.impl).verify('card-ref-1', ctx);
    expect(v).toMatchObject({ status: 'success', transactionId: '9911', amountKobo: 5000n });
    expect(v.card).toMatchObject({ authorizationCode: 'AUTH_x1', reusable: true, last4: '4081', cardType: 'visa', channel: 'card' });
  });

  it('charges a saved card under our reference and reports declines and unknown outcomes', async () => {
    const ok = fakeFetch(() => ({ status: 200, body: { status: true, data: { id: 77, status: 'success', gateway_response: 'Approved' } } }));
    const r = await p(ok.impl).charge({ authorizationCode: 'AUTH_x1', email: 'a@b.co', amountKobo: 4_687_500n, reference: 'bcc-1' }, ctx);
    expect(r).toEqual({ status: 'success', transactionId: '77', gatewayResponse: 'Approved' });
    expect(JSON.parse(String(ok.calls[0].init.body))).toEqual({ email: 'a@b.co', amount: 4687500, authorization_code: 'AUTH_x1', reference: 'bcc-1', currency: 'NGN' });
    const no = fakeFetch(() => ({ status: 200, body: { status: true, data: { id: 78, status: 'failed', gateway_response: 'Insufficient Funds' } } }));
    expect((await p(no.impl).charge({ authorizationCode: 'A', email: 'a@b.co', amountKobo: 100n, reference: 'bcc-2' }, ctx)).status).toBe('failed');
    const down = fakeFetch(() => ({ status: 503, body: {} }));
    await expect(p(down.impl).charge({ authorizationCode: 'A', email: 'a@b.co', amountKobo: 100n, reference: 'bcc-3' }, ctx)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('treats an unknown reference as not found and abandoned checks as failed', async () => {
    const nf = fakeFetch(() => ({ status: 404, body: { status: false, message: 'Transaction reference not found' } }));
    expect((await p(nf.impl).verify('nope', ctx)).status).toBe('not_found');
    const ab = fakeFetch(() => ({ status: 200, body: { status: true, data: { id: 1, status: 'abandoned', amount: 5000 } } }));
    expect((await p(ab.impl).verify('x', ctx)).status).toBe('failed');
  });
});
