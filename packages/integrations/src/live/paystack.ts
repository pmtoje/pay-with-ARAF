import { ProviderError, type CallContext, type CardCollectionProvider, type CardTxnStatus, type SavedCard } from '../interfaces';

/**
 * Paystack — backup repayment card, per Paystack's public API (paystack.com/docs/api), the provider the Bank's
 * ARAF application already uses:
 *
 *   POST /transaction/initialize               { email, amount (kobo), currency, reference, channels: ["card"], callback_url, metadata }
 *                                              → data.authorization_url
 *   GET  /transaction/verify/{reference}       → data.status, data.id, data.amount, data.gateway_response, data.channel,
 *                                                data.authorization { authorization_code, reusable, last4, exp_month, exp_year,
 *                                                                     card_type, bank, channel, signature }
 *   POST /transaction/charge_authorization     { email, amount, authorization_code, reference, currency } → data.status, data.id
 *   POST /refund                               { transaction, amount } → data.status
 *
 * Header: Authorization: Bearer <secret key>. A card is only usable for later charges when the authorization is
 * `reusable` and the channel is `card`.
 */
const P = 'Paystack';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

export interface PaystackOptions {
  secretKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function parseSavedCard(a: unknown): SavedCard | null {
  const x = obj(a);
  const code = str(x.authorization_code, 120);
  if (!code) return null;
  return {
    authorizationCode: code,
    reusable: x.reusable === true,
    last4: str(x.last4, 4),
    expMonth: str(x.exp_month, 2),
    expYear: str(x.exp_year, 4),
    cardType: str(x.card_type, 40).trim(),
    bank: str(x.bank, 80),
    channel: str(x.channel, 20),
    signature: str(x.signature, 120) || null,
  };
}

export class PaystackCardProvider implements CardCollectionProvider {
  readonly name = 'Paystack cards (live)';
  constructor(private readonly opts: PaystackOptions) {}

  private async req(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${(this.opts.baseUrl ?? 'https://api.paystack.co').replace(/\/$/, '')}${path}`, {
        method,
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${this.opts.secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ProviderError(P, (e as Error).name === 'AbortError' ? 'TIMEOUT' : 'UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(P, 'AUTHENTICATION_FAILED');
    if (res.status === 429 || res.status >= 500) throw new ProviderError(P, 'UNAVAILABLE', `HTTP ${res.status}`);
    const json = obj(await res.json().catch(() => null));
    return { status: res.status, json };
  }

  async startCardLink(input: { reference: string; email: string; amountKobo: bigint; callbackUrl: string; metadata: Record<string, string> }, _ctx: CallContext) {
    const r = await this.req('POST', '/transaction/initialize', {
      email: input.email,
      amount: Number(input.amountKobo),
      currency: 'NGN',
      reference: input.reference,
      channels: ['card'],
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    });
    const url = str(obj(r.json.data).authorization_url, 500);
    if (r.status >= 400 || !/^https:\/\//.test(url)) throw new ProviderError(P, r.status >= 400 ? 'REJECTED' : 'INVALID_RESPONSE', str(r.json.message, 200));
    return { authorizationUrl: url };
  }

  async verify(reference: string, _ctx: CallContext) {
    const r = await this.req('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    if (r.status === 404 || (r.status === 400 && /not found/i.test(str(r.json.message, 200)))) return { status: 'not_found' as const, transactionId: null, amountKobo: 0n, card: null, gatewayResponse: null };
    if (r.status >= 400) throw new ProviderError(P, 'REJECTED', str(r.json.message, 200));
    const d = obj(r.json.data);
    const raw = str(d.status, 20);
    const amount = typeof d.amount === 'number' && Number.isInteger(d.amount) ? BigInt(d.amount) : null;
    if (amount === null) throw new ProviderError(P, 'INVALID_RESPONSE', 'amount');
    const status: CardTxnStatus = raw === 'success' ? 'success' : raw === 'failed' || raw === 'abandoned' || raw === 'reversed' ? 'failed' : 'pending';
    return { status, transactionId: d.id !== undefined && d.id !== null ? String(d.id) : null, amountKobo: amount, card: parseSavedCard(d.authorization), gatewayResponse: str(d.gateway_response, 200) || null };
  }

  async refund(transactionId: string, amountKobo: bigint, _ctx: CallContext) {
    const r = await this.req('POST', '/refund', { transaction: transactionId, amount: Number(amountKobo) });
    if (r.status >= 400) return { status: 'failed' as const };
    const s = str(obj(r.json.data).status, 20);
    return { status: s === 'processed' ? ('processed' as const) : s === 'failed' ? ('failed' as const) : ('pending' as const) };
  }

  async charge(input: { authorizationCode: string; email: string; amountKobo: bigint; reference: string }, _ctx: CallContext) {
    const r = await this.req('POST', '/transaction/charge_authorization', { email: input.email, amount: Number(input.amountKobo), authorization_code: input.authorizationCode, reference: input.reference, currency: 'NGN' });
    const d = obj(r.json.data);
    if (r.status >= 400) return { status: 'failed' as const, transactionId: null, gatewayResponse: str(r.json.message, 200) || 'Declined' };
    const raw = str(d.status, 20);
    return {
      status: raw === 'success' ? ('success' as const) : raw === 'failed' ? ('failed' as const) : ('pending' as const),
      transactionId: d.id !== undefined && d.id !== null ? String(d.id) : null,
      gatewayResponse: str(d.gateway_response, 200) || null,
    };
  }
}
