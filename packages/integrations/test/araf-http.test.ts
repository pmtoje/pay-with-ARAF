import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ArafHttpProvider, ProviderError, signArafRequest } from '../src';

const SECRET = 'x'.repeat(40);
const ctx = { correlationId: 'corr-test-0001' } as never;

function fakeFetch(handler: (url: URL, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const impl = (async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('ARAF connected adapter (signed v1 contract)', () => {
  it('signs every request over timestamp, method, path and raw body', async () => {
    const f = fakeFetch(() => ({ status: 201, body: { araf_reference: 'PWA-2026-000001' } }));
    const p = new ArafHttpProvider({ baseUrl: 'https://araf.example', secret: SECRET, fetchImpl: f.impl });
    const r = await p.submit({ application_reference: 'ARAF-2026-000001', amount_kobo: 645000n }, 'araf-submit-1', ctx);
    expect(r.arafReference).toBe('PWA-2026-000001');
    const { url, init } = f.calls[0];
    expect(url.pathname).toBe('/api/integrations/pay-with-araf/applications');
    const h = init.headers as Record<string, string>;
    expect(h['Idempotency-Key']).toBe('araf-submit-1');
    const expected = createHmac('sha256', SECRET).update(`${h['X-PWA-Timestamp']}.POST./api/integrations/pay-with-araf/applications.${init.body}`).digest('hex');
    expect(h['X-PWA-Signature']).toBe(`v1=${expected}`);
    expect(String(init.body)).toContain('"amount_kobo":"645000"'); // bigint-safe
  });

  it('lookup by idempotency key returns null on 404', async () => {
    const f = fakeFetch(() => ({ status: 404, body: { error: 'not found' } }));
    const p = new ArafHttpProvider({ baseUrl: 'https://araf.example', secret: SECRET, fetchImpl: f.impl });
    expect(await p.findByIdempotencyKey('k-1', ctx)).toBeNull();
  });

  it('fails closed on bad signatures, server errors and malformed responses', async () => {
    const auth = new ArafHttpProvider({ baseUrl: 'https://araf.example', secret: SECRET, fetchImpl: fakeFetch(() => ({ status: 401, body: {} })).impl });
    await expect(auth.submit({}, 'k', ctx)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    const down = new ArafHttpProvider({ baseUrl: 'https://araf.example', secret: SECRET, fetchImpl: fakeFetch(() => ({ status: 503, body: {} })).impl });
    await expect(down.reportStatus({} as never, ctx)).rejects.toBeInstanceOf(ProviderError);
    const bad = new ArafHttpProvider({ baseUrl: 'https://araf.example', secret: SECRET, fetchImpl: fakeFetch(() => ({ status: 200, body: { acknowledged: 'yes' } })).impl });
    await expect(bad.reportStatus({} as never, ctx)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('signArafRequest is deterministic for a given timestamp', () => {
    expect(signArafRequest(SECRET, 'post', '/p', '{}', 1).signature).toBe(signArafRequest(SECRET, 'POST', '/p', '{}', 1).signature);
  });
});
