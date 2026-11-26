import { createHmac, randomUUID } from 'node:crypto';
import { ProviderError, type ArafStatusReport, type ArafWorkflowProvider, type CallContext } from '../interfaces';

/**
 * Pay with ARAF ⇄ AltBank Retail Asset Factory (ARAF) integration, v1.
 *
 * Both applications belong to the Bank and this contract is defined by them together
 * (docs: ARAF_INTEGRATION.md in both repositories). Every request is signed:
 *
 *   X-PWA-Timestamp: <unix seconds>
 *   X-PWA-Signature: v1=<hex HMAC-SHA256(secret, `${timestamp}.${METHOD}.${path}.${rawBody}`)>
 *
 * ARAF rejects requests more than 300 s old. ARAF calls back with the same scheme
 * (X-ARAF-Timestamp / X-ARAF-Signature over `${timestamp}.POST./api/callbacks/araf.${rawBody}`).
 */
export function signArafRequest(secret: string, method: string, path: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${method.toUpperCase()}.${path}.${body}`).digest('hex');
  return { timestamp: String(timestamp), signature: `v1=${sig}` };
}

function arafReferenceOf(json: unknown): string {
  const ref = (json as { araf_reference?: unknown } | null)?.araf_reference;
  if (typeof ref !== 'string' || ref.length < 3 || ref.length > 80) throw new ProviderError('ARAF', 'INVALID_RESPONSE');
  return ref;
}

export class ArafHttpProvider implements ArafWorkflowProvider {
  readonly name = 'AltBank Retail Asset Factory (connected)';
  constructor(private readonly opts: { baseUrl: string; secret: string; timeoutMs?: number; fetchImpl?: typeof fetch }) {}

  private async request(method: 'GET' | 'POST', path: string, ctx: CallContext, body?: unknown, headers: Record<string, string> = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const { timestamp, signature } = signArafRequest(this.opts.secret, method, path, raw);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 12_000);
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(new URL(path, this.opts.baseUrl), {
        method,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'X-PWA-Timestamp': timestamp, 'X-PWA-Signature': signature, 'X-Correlation-Id': ctx.correlationId ?? randomUUID(), ...headers },
        body: method === 'POST' ? raw : undefined,
      });
    } catch (e) {
      throw new ProviderError('ARAF', (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError('ARAF', 'AUTHENTICATION_FAILED');
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ProviderError('ARAF', 'INVALID_RESPONSE');
    }
    return { status: res.status, json };
  }

  async submit(payload: Record<string, unknown>, idempotencyKey: string, ctx: CallContext) {
    const r = await this.request('POST', '/api/integrations/pay-with-araf/applications', ctx, payload, { 'Idempotency-Key': idempotencyKey });
    if (r.status !== 200 && r.status !== 201) throw new ProviderError('ARAF', r.status >= 500 ? 'UNAVAILABLE' : 'REJECTED');
    return { arafReference: arafReferenceOf(r.json) };
  }

  async findByIdempotencyKey(idempotencyKey: string, ctx: CallContext) {
    const r = await this.request('GET', `/api/integrations/pay-with-araf/applications/by-key/${encodeURIComponent(idempotencyKey)}`, ctx);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new ProviderError('ARAF', r.status >= 500 ? 'UNAVAILABLE' : 'REJECTED');
    return { arafReference: arafReferenceOf(r.json) };
  }

  async reportStatus(report: ArafStatusReport, ctx: CallContext) {
    const r = await this.request('POST', '/api/integrations/pay-with-araf/reports', ctx, report);
    if (r.status !== 200 && r.status !== 201) throw new ProviderError('ARAF', r.status >= 500 ? 'UNAVAILABLE' : 'REJECTED');
    const body = r.json as { acknowledged?: unknown; event_reference?: unknown } | null;
    if (body?.acknowledged !== true) throw new ProviderError('ARAF', 'INVALID_RESPONSE');
    return { acknowledged: true as const, arafEventReference: typeof body.event_reference === 'string' ? body.event_reference.slice(0, 80) : undefined };
  }
}
