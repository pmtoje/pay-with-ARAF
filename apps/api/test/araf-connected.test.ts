import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, drain, staffEmail, type Harness } from './harness';
import { cart, createCheckout, onboardPartner, openCheckout, toOfferAccepted, type OnboardedPartner } from './flows';

/**
 * Connected mode: Pay with ARAF talks to the real ARAF's integration API (here a stand-in server that checks the
 * contract v1 signatures exactly as ARAF does) instead of the built-in simulator, and Bank staff sign in to the
 * admin portal with their ARAF account.
 */
const SECRET = 'connected-test-secret-0123456789abcdef01234';
const sign = (t: number, method: string, path: string, body: string) => `v1=${createHmac('sha256', SECRET).update(`${t}.${method}.${path}.${body}`).digest('hex')}`;

interface Seen {
  method: string;
  path: string;
  body: string;
  valid: boolean;
}

class FakeAraf {
  server!: Server;
  seen: Seen[] = [];
  /** code → identity returned by the token exchange */
  codes = new Map<string, { email: string; name: string; auth_time: number; amr: string[] }>();
  cases = new Map<string, string>(); // idempotency key → reference
  n = 0;
  get url() {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const path = req.url ?? '';
        const t = Number(req.headers['x-pwa-timestamp']);
        const valid = Math.abs(Date.now() / 1000 - t) <= 300 && req.headers['x-pwa-signature'] === sign(t, req.method ?? '', path, body);
        this.seen.push({ method: req.method ?? '', path, body, valid });
        const send = (status: number, json: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(json));
        };
        if (!valid) return send(401, { error: 'UNAUTHENTICATED' });
        if (req.method === 'POST' && path === '/api/sso/pay-with-araf/token') {
          const { code } = JSON.parse(body) as { code: string };
          const id = this.codes.get(code);
          this.codes.delete(code);
          return id ? send(200, id) : send(400, { error: 'INVALID_GRANT' });
        }
        if (req.method === 'POST' && path === '/api/integrations/pay-with-araf/applications') {
          const key = String(req.headers['idempotency-key']);
          const existing = this.cases.get(key);
          if (existing) return send(200, { araf_reference: existing });
          const ref = `PWA-2026-${String(++this.n).padStart(6, '0')}`;
          this.cases.set(key, ref);
          return send(201, { araf_reference: ref });
        }
        if (req.method === 'GET' && path.startsWith('/api/integrations/pay-with-araf/applications/by-key/')) {
          const ref = this.cases.get(decodeURIComponent(path.split('/').pop()!));
          return ref ? send(200, { araf_reference: ref }) : send(404, { error: 'NOT_FOUND' });
        }
        if (req.method === 'POST' && path === '/api/integrations/pay-with-araf/reports') return send(200, { acknowledged: true, event_reference: randomUUID() });
        send(404, { error: 'NOT_FOUND' });
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
  }
}

const ENV = ['ARAF_MODE', 'ARAF_BASE_URL', 'ARAF_INTEGRATION_SECRET', 'ARAF_SSO_ENABLED'] as const;

describe('Connected to the real ARAF', () => {
  let h: Harness;
  let araf: FakeAraf;
  let mall: OnboardedPartner;
  const saved: Record<string, string | undefined> = {};
  let seq = 0;

  /** ARAF's signed callback, as its worker sends it. */
  function callback(ref: string, stage: string, extra: Record<string, unknown> = {}, opts: { secret?: string; skew?: number } = {}) {
    const body = JSON.stringify({ event_id: `araf-${randomUUID()}`, araf_reference: ref, sequence: ++seq, stage, occurred_at: new Date().toISOString(), ...extra });
    const t = Math.floor(Date.now() / 1000) - (opts.skew ?? 0);
    const sig = `v1=${createHmac('sha256', opts.secret ?? SECRET).update(`${t}.POST./api/callbacks/araf.${body}`).digest('hex')}`;
    return request(h.http).post('/api/callbacks/araf').set('Content-Type', 'application/json').set('X-ARAF-Timestamp', String(t)).set('X-ARAF-Signature', sig).send(body);
  }

  beforeAll(async () => {
    araf = new FakeAraf();
    await araf.start();
    for (const k of ENV) saved[k] = process.env[k];
    Object.assign(process.env, { ARAF_MODE: 'connected', ARAF_BASE_URL: araf.url, ARAF_INTEGRATION_SECRET: SECRET, ARAF_SSO_ENABLED: 'true' });
    h = await createHarness();
    mall = await onboardPartner(h, { name: 'ConnectedMall' });
  }, 180_000);

  afterAll(async () => {
    await h?.close();
    araf.server.close();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('submits to ARAF, follows its signed decisions, and reports the customer reply and execution steps', async () => {
    const created = await createCheckout(h, mall, cart(`CON-${Date.now()}`));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const c = await openCheckout(h, created.body.session_id);
    await toOfferAccepted(h, c, '22200000001', '1990-04-12');
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference: created.body.application_reference } });
    expect(app.status).toBe('ARAF_SUBMITTED');
    expect(app.arafReference).toMatch(/^PWA-2026-/);
    const submitted = araf.seen.find((s) => s.path === '/api/integrations/pay-with-araf/applications');
    expect(submitted?.valid).toBe(true);
    expect(JSON.parse(submitted!.body).application_reference).toBe(app.reference);
    // No simulator case is created in connected mode.
    expect(await h.prisma.simArafCase.count({ where: { arafReference: app.arafReference! } })).toBe(0);

    const ref = app.arafReference!;
    expect((await callback(ref, 'UNDER_REVIEW')).status).toBe(200);
    expect((await callback(ref, 'INFO_REQUESTED', { note: 'Upload your latest payslip.' })).status).toBe(200);
    expect((await c.state()).state).toBe('ADDITIONAL_INFORMATION_REQUIRED');

    const reply = await c.post('/information', { note: 'Payslip uploaded to the bank portal.' });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    await drain(h, 2);
    const reports = araf.seen.filter((s) => s.path === '/api/integrations/pay-with-araf/reports').map((s) => JSON.parse(s.body) as { type: string; arafReference: string });
    expect(reports.some((r) => r.type === 'CUSTOMER_INFORMATION_PROVIDED' && r.arafReference === ref)).toBe(true);

    expect((await callback(ref, 'INFO_PROVIDED')).status).toBe(200);
    expect((await callback(ref, 'APPROVED', { decision: 'APPROVED', actor_name: 'Olu Unit-Head' })).status).toBe(200);
    const approved = await h.prisma.financingApplication.findUniqueOrThrow({ where: { id: app.id } });
    // Approval hands over to documentation (offer letter) before booking.
    expect(approved.status).toBe('DOCUMENTATION_PENDING');
    expect(araf.seen.every((s) => s.valid)).toBe(true);
  });

  it('refuses callbacks with the wrong secret, a stale timestamp, or the old simulator signature', async () => {
    const ref = 'PWA-2026-999999';
    expect((await callback(ref, 'UNDER_REVIEW', {}, { secret: 'wrong-secret-wrong-secret-wrong-secret-00' })).status).toBe(401);
    expect((await callback(ref, 'UNDER_REVIEW', {}, { skew: 900 })).status).toBe(401);
    const body = JSON.stringify({ event_id: `araf-${randomUUID()}`, araf_reference: ref, sequence: 1, stage: 'UNDER_REVIEW', occurred_at: new Date().toISOString() });
    const legacy = createHmac('sha256', process.env.INTERNAL_CALLBACK_SECRET!).update(body).digest('hex');
    expect((await request(h.http).post('/api/callbacks/araf').set('Content-Type', 'application/json').set('X-ARAF-Signature', legacy).send(body)).status).toBe(401);
  });

  describe('staff sign-in with an ARAF account', () => {
    async function start() {
      const agent = request.agent(h.http);
      const s = await agent.get('/api/auth/admin/sso/start');
      expect(s.status).toBe(302);
      const to = new URL(s.headers.location);
      expect(`${to.origin}${to.pathname}`).toBe(`${araf.url}/sso/pay-with-araf`);
      expect(to.searchParams.get('redirect_uri')).toMatch(/\/api\/auth\/admin\/sso\/callback$/);
      return { agent, state: to.searchParams.get('state')! };
    }
    const identity = (email: string, authAgo = 60) => ({ email, name: 'Test Staff', auth_time: Math.floor(Date.now() / 1000) - authAgo, amr: ['otp'] });

    it('is offered on the sign-in page', async () => {
      const r = await request(h.http).get('/api/auth/admin/sso/config');
      expect(r.body).toMatchObject({ enabled: true, provider: 'ARAF' });
    });

    it('signs a provisioned staff member in with full portal access', async () => {
      const { agent, state } = await start();
      const code = randomUUID();
      araf.codes.set(code, identity(staffEmail('analyst')));
      const cb = await agent.get(`/api/auth/admin/sso/callback?code=${code}&state=${state}`);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).not.toContain('sso_error');
      const me = await agent.get('/api/auth/admin/me');
      expect(me.status, JSON.stringify(me.body)).toBe(200);
      expect(me.body.user.email).toBe(staffEmail('analyst'));
      expect(me.body.mfa_verified).toBe(true);
      // The code is single-use at ARAF.
      const again = await agent.get(`/api/auth/admin/sso/callback?code=${code}&state=${state}`);
      expect(again.headers.location).toContain('sso_error=STATE');
    });

    it('refuses a forged state, unknown people, other email domains and stale ARAF sign-ins', async () => {
      const forged = await request(h.http).get(`/api/auth/admin/sso/callback?code=x&state=${randomUUID()}`);
      expect(forged.headers.location).toContain('sso_error=STATE');

      const cases: [ReturnType<typeof identity>, string][] = [
        [identity('nobody@altbank.ng'), 'NOT_PROVISIONED'],
        [identity('someone@gmail.com'), 'DOMAIN'],
        [identity(staffEmail('analyst'), 13 * 3600), 'DENIED'],
      ];
      for (const [id, expected] of cases) {
        const { agent, state } = await start();
        const code = randomUUID();
        araf.codes.set(code, id);
        const cb = await agent.get(`/api/auth/admin/sso/callback?code=${code}&state=${state}`);
        expect(cb.headers.location, id.email).toContain(`sso_error=${expected}`);
        expect((await agent.get('/api/auth/admin/me')).status).toBe(401);
      }
      const { agent, state } = await start();
      const bad = await agent.get(`/api/auth/admin/sso/callback?code=unknown-code&state=${state}`);
      expect(bad.headers.location).toContain('sso_error=EXCHANGE');
    });
  });
});
