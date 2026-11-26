import request from 'supertest';
import { expect } from 'vitest';
import { totpAt } from '@araf/security';
import { drain, loginPortal, nextTotp, staff, type Harness, type PortalAgent } from './harness';

export interface OnboardedPartner {
  id: string;
  code: string;
  apiKey: string;
  portal: PortalAgent;
  webhookSecret: string;
  adminEmail: string;
}

let seq = 0;

/** Full partner onboarding through the real APIs (maker-checker, provisioning, invitation, MFA, keys, webhook). */
export async function onboardPartner(h: Harness, opts: { name: string; webhookUrl?: string; returnOrigin?: string; equity?: boolean; ratePercent?: number }): Promise<OnboardedPartner> {
  seq++;
  const maker = await staff(h, 'onboarding');
  const checker = await staff(h, 'partner.approver');
  const adminEmail = `admin${seq}-${Date.now()}@${opts.name.toLowerCase().replace(/\W/g, '')}.example`;
  const created = await maker.post('/api/admin/partners', {
    registered_name: `${opts.name} Commerce Ltd`,
    trading_name: opts.name,
    registration_number: `RC${100000 + seq}`,
    business_type: 'Limited liability company',
    partner_type: 'MARKETPLACE',
    website_url: 'http://localhost:3005',
    business_address: '12 Marina Road, Lagos',
    business_category: 'E-commerce marketplace',
    contact_name: 'Ada Partner',
    contact_email: adminEmail,
    contact_phone: '+2348011112222',
    risk_classification: 'LOW',
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const partnerId = created.body.id as string;
  const cfg = await maker.post(`/api/admin/partners/${partnerId}/configuration`, {
    min_transaction_naira: 20_000,
    max_transaction_naira: 5_000_000,
    permitted_products: ['MURABAHA_ASSET_FINANCING'],
    permitted_tenors: [3, 6, 12, 18, 24],
    eligible_categories: ['electronics', 'appliances', 'furniture', 'solar'],
    application_expiry_minutes: 1440,
    order_reservation_minutes: 4320,
    partial_financing_enabled: opts.equity ?? false,
    annual_profit_rate_percent: opts.ratePercent ?? 25,
    allow_multiple_vendors: false,
    settlement_arrangement: 'DIRECT_TO_VENDOR',
    return_url_origins: [opts.returnOrigin ?? 'http://localhost:3005'],
  });
  expect(cfg.status, JSON.stringify(cfg.body)).toBe(201);
  const vendor = await maker.post(`/api/admin/partners/${partnerId}/vendors`, { vendor_reference: 'VENDOR-001', name: 'Lekki Electronics Ltd', categories: ['electronics', 'appliances'] });
  expect(vendor.status).toBe(201);
  const acct = await maker.post(`/api/admin/partners/${partnerId}/vendors/${vendor.body.id}/settlement-accounts`, { bank_code: '058', bank_name: 'Sandbox Bank', account_number: `01234567${String(seq).padStart(2, '0')}`, account_name: 'LEKKI ELECTRONICS LTD' });
  expect(acct.status).toBe(201);
  expect(acct.body.verification_status).toBe('VERIFIED');
  const submit = await maker.post(`/api/admin/partners/${partnerId}/submit`, { comment: 'KYB complete' });
  expect(submit.status, JSON.stringify(submit.body)).toBe(200);

  const approvals = (await checker.get('/api/admin/approvals?status=PENDING')).body as Array<{ id: string; type: string; partner_id: string; can_decide: boolean }>;
  const mine = approvals.filter((a) => a.partner_id === partnerId);
  expect(mine.map((a) => a.type).sort()).toEqual(['PARTNER_APPROVAL', 'VENDOR_ACCOUNT']);
  // The maker cannot approve their own request (and lacks the permission).
  const self = await maker.post(`/api/admin/approvals/${mine[0].id}/decide`, { decision: 'APPROVE', comment: 'self approve' });
  expect(self.status).toBe(403);
  for (const a of mine) {
    const d = await checker.post(`/api/admin/approvals/${a.id}/decide`, { decision: 'APPROVE', comment: 'Verified documents and account' });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
  }
  const detail = await checker.get(`/api/admin/partners/${partnerId}`);
  expect(detail.body.status).toBe('SANDBOX_ACTIVE');

  // Partner administrator invitation (sandbox inbox) → accept → enrol TOTP → activate.
  const msg = await h.prisma.sandboxMessage.findFirstOrThrow({ where: { destination: adminEmail }, orderBy: { createdAt: 'desc' } });
  const token = /invite\/(inv_[A-Za-z0-9]+)/.exec(msg.body)![1];
  const anon = request(h.http);
  const accepted = await anon.post(`/api/auth/invitations/${token}/accept`).send({ password: 'Partner-Pass-2026!' });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const secret = accepted.body.totp_secret as string;
  const activated = await anon.post(`/api/auth/invitations/${token}/activate`).send({ code: totpAt(secret, Date.now()) });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  // The activation consumed the current step; log in on the next one.
  const portal = await loginPortal(h, 'partner', adminEmail, 'Partner-Pass-2026!', secret).catch(async () => {
    await new Promise((r) => setTimeout(r, 31_000));
    return loginPortal(h, 'partner', adminEmail, 'Partner-Pass-2026!', secret);
  });

  const key = await portal.post('/api/partner-portal/credentials', { name: 'Server key', scopes: ['checkout:write', 'checkout:read', 'applications:read', 'orders:read', 'orders:write', 'settlements:read', 'webhooks:read', 'webhooks:write'] });
  expect(key.status, JSON.stringify(key.body)).toBe(201);
  expect(key.body.secret).toMatch(/^sk_test_/);
  let webhookSecret = '';
  if (opts.webhookUrl) {
    const wh = await portal.post('/api/partner-portal/webhooks', { url: opts.webhookUrl, events: [] });
    expect(wh.status, JSON.stringify(wh.body)).toBe(201);
    webhookSecret = wh.body.signing_secret;
  }
  return { id: partnerId, code: detail.body.partner_code, apiKey: key.body.secret, portal, webhookSecret, adminEmail };
}

export function cart(order: string, unitNaira = 450_000, qty = 1) {
  return {
    merchant_order_reference: order,
    currency: 'NGN',
    amount: unitNaira * 100 * qty,
    items: [{ sku: 'PHONE-001', name: 'Sandbox Smartphone X', quantity: qty, unit_amount: unitNaira * 100, category: 'electronics', vendor_reference: 'VENDOR-001' }],
    customer: { email: 'customer@example.com', phone: '+2348000000000' },
    return_url: `http://localhost:3005/orders/${order}`,
    cancel_url: 'http://localhost:3005/cart',
  };
}

export async function createCheckout(h: Harness, p: OnboardedPartner, body: object, key = `idem-${Math.random().toString(36).slice(2)}-${Date.now()}`) {
  return request(h.http).post('/api/v1/checkout/sessions').set('Authorization', `Bearer ${p.apiKey}`).set('Idempotency-Key', key).send(body);
}

export interface CustomerAgent {
  sessionId: string;
  post(path: string, body?: unknown): request.Test;
  get(path: string): request.Test;
  state(): Promise<Record<string, any>>;
}

export async function openCheckout(h: Harness, sessionId: string): Promise<CustomerAgent> {
  const agent = request.agent(h.http);
  const open = await agent.post(`/api/checkout/sessions/${sessionId}/open`);
  expect(open.status, JSON.stringify(open.body)).toBe(200);
  const csrf = open.body.csrf_token as string;
  const base = `/api/checkout/sessions/${sessionId}`;
  return {
    sessionId,
    post: (path, body) => agent.post(`${base}${path}`).set('x-csrf-token', csrf).send(body as object),
    get: (path) => agent.get(`${base}${path}`),
    state: async () => (await agent.get(`${base}/state`)).body,
  };
}

export async function latestOtp(h: Harness, sessionId: string): Promise<string> {
  const app = await h.prisma.financingApplication.findFirstOrThrow({ where: { checkoutSessionId: sessionId } });
  const msg = await h.prisma.sandboxMessage.findFirstOrThrow({ where: { applicationId: app.id, channel: 'SMS', body: { contains: 'code is' } }, orderBy: { createdAt: 'desc' } });
  return /code is (\d{6})/.exec(msg.body)![1];
}

/** Customer: consents → BVN/DOB → OTP → (automatic SeedFi assessment). */
export async function verifyIdentity(h: Harness, c: CustomerAgent, bvn: string, dob: string) {
  expect((await c.post('/consents', { consents: ['IDENTITY_VERIFICATION', 'CREDIT_ASSESSMENT', 'APPLICATION_PROCESSING'] })).status).toBe(200);
  const idv = await c.post('/identity', { bvn, date_of_birth: dob });
  expect(idv.status, JSON.stringify(idv.body)).toBe(200);
  const otp = await c.post('/identity/otp', { code: await latestOtp(h, c.sessionId) });
  return otp;
}

/** Drive a good-credit existing customer from identity to the accepted offer. */
export async function toOfferAccepted(h: Harness, c: CustomerAgent, bvn: string, dob: string, tenor = 12) {
  const otp = await verifyIdentity(h, c, bvn, dob);
  expect(otp.status, JSON.stringify(otp.body)).toBe(200);
  expect(otp.body.state).toBe('ACCOUNT_VERIFICATION_PENDING');
  const accounts = await c.get('/accounts');
  const eligible = accounts.body.accounts.find((a: { eligible: boolean }) => a.eligible);
  expect((await c.post('/accounts/select', { account_id: eligible.id })).body.state).toBe('ACCOUNT_VERIFIED');
  expect((await c.post('/income-profile', { income_profile: 'SALARY_EARNER' })).body.state).toBe('STATEMENT_PENDING');
  const stmt = await c.post('/statements/altbank');
  expect(stmt.status, JSON.stringify(stmt.body)).toBe(200);
  await drain(h, 1);
  const st = await c.state();
  expect(st.state, JSON.stringify(st)).toBe('ELIGIBLE');
  const sel = await c.post('/offers/select', { tenor_months: tenor });
  expect(sel.status, JSON.stringify(sel.body)).toBe(200);
  const acc = await c.post('/offers/accept', { offer_id: sel.body.offer.id, accept_terms: true });
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  expect(acc.body.state).toBe('ARAF_SUBMISSION_PENDING');
  await drain(h, 2);
  return acc.body;
}

export async function arafApprove(h: Harness, applicationReference: string, analyst: PortalAgent, approver: PortalAgent) {
  const cases = (await analyst.get('/api/admin/araf-simulator/cases')).body as Array<{ id: string; application_reference: string }>;
  const c = cases.find((x) => x.application_reference === applicationReference)!;
  for (const action of ['START_EVALUATION', 'COMPLETE_EVALUATION', 'RECOMMEND_APPROVAL']) {
    const r = await analyst.post(`/api/admin/araf-simulator/cases/${c.id}/actions`, { action, note: `${action} ok` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  const ok = await approver.post(`/api/admin/araf-simulator/cases/${c.id}/actions`, { action: 'APPROVE', note: 'Approved within delegated limit' });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  return c.id;
}

export { nextTotp };
