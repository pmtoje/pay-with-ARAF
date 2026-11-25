import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, drain, staff, type Harness, type PortalAgent } from './harness';
import { arafApprove, cart, createCheckout, latestOtp, onboardPartner, openCheckout, toOfferAccepted, type OnboardedPartner } from './flows';

/**
 * Definition of Done (spec §71) — the complete sandbox lifecycle through the real HTTP APIs:
 * onboarding → checkout → identity → credit → account → statement → analysis → eligibility →
 * offer → ARAF → documents → mandate → booking → maker-checker payment → release → signed
 * webhook → fulfilment → delivery → reporting.
 */
describe('Pay with ARAF — end-to-end sandbox lifecycle', () => {
  let h: Harness;
  let mall: OnboardedPartner;
  let analyst: PortalAgent, approver: PortalAgent, cad: PortalAgent, settlement: PortalAgent, finance: PortalAgent, management: PortalAgent, auditor: PortalAgent;
  let sessionId = '';
  let reference = '';
  const ORDER = `ALTMALL-ORD-${Date.now()}`;

  beforeAll(async () => {
    h = await createHarness();
    mall = await onboardPartner(h, { name: 'AltMall', webhookUrl: '' });
    analyst = await staff(h, 'analyst');
    approver = await staff(h, 'approver');
    cad = await staff(h, 'cad');
    settlement = await staff(h, 'settlement');
    finance = await staff(h, 'finance');
    management = await staff(h, 'management');
    auditor = await staff(h, 'auditor');
    // Partner configures its receiving webhook endpoint (the demo receiver).
    const wh = await mall.portal.post('/api/partner-portal/webhooks', { url: h.receiver.url, events: [] });
    expect(wh.status).toBe(201);
    h.receiver.secret = wh.body.signing_secret;
  }, 120_000);

  afterAll(async () => h?.close());

  it('1–8. partner creates an idempotent, validated checkout session', async () => {
    const body = cart(ORDER);
    const key = `idem-${Date.now()}`;
    const created = await createCheckout(h, mall, body, key);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.checkout_url).toMatch(/\/c\/cs_test_/);
    expect(created.body.application_reference).toMatch(/^ARAF-\d{4}-\d{6}$/);
    sessionId = created.body.session_id;
    reference = created.body.application_reference;
    // Idempotent replay returns the same session.
    const replay = await createCheckout(h, mall, body, key);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.session_id).toBe(sessionId);
    // Same key, different body → rejected.
    expect((await createCheckout(h, mall, { ...body, amount: body.amount + 100 }, key)).status).toBe(422);
    // Duplicate checkout for the same order → 409.
    expect((await createCheckout(h, mall, body)).status).toBe(409);
    // Amount manipulation → cart validation failure.
    const tampered = await createCheckout(h, mall, { ...cart(`${ORDER}-T`), amount: 100_00 });
    expect(tampered.status).toBe(422);
    expect(tampered.body.error.code).toBe('CART_INVALID');
    // Unapproved return URL → rejected (open-redirect protection).
    const evil = await createCheckout(h, mall, { ...cart(`${ORDER}-E`), return_url: 'https://evil.example/steal' });
    expect(evil.body.error.code).toBe('RETURN_URL_NOT_APPROVED');
  });

  it('9–17. customer verifies identity, passes credit, connects AltBank statement and accepts an offer', async () => {
    const c = await openCheckout(h, sessionId);
    // Nothing personal is visible before OTP verification.
    const pre = await c.state();
    expect(pre.customer).toBeUndefined();
    // Later-stage APIs cannot be called before earlier stages (state machine).
    expect((await c.post('/offers/accept', { offer_id: '00000000-0000-0000-0000-000000000000', accept_terms: true })).status).toBe(401);
    const accepted = await toOfferAccepted(h, c, '22200000001', '1990-04-12', 12);
    expect(accepted.offer.financing_amount).toBe(45_000_000);
    expect(accepted.offer.deferred_sale_price).toBe(56_250_000);
    expect(accepted.offer.monthly_repayment).toBe(4_687_500);
    // Best tenor (24m, 50% markup): ₦109,840 × 24 / 1.5 = ₦1,757,440.
    expect(accepted.eligibility.max_eligible_amount).toBe(175_744_000);
    const appRow = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    const detail = await analyst.get(`/api/admin/applications/${appRow.id}`);
    const twelve = detail.body.affordability[0].tenors.find((t: { tenor_months: number }) => t.tenor_months === 12);
    expect(detail.body.affordability[0].income).toBe(48_000_000); // lowest verified salary ₦480,000
    expect(detail.body.affordability[0].capacity).toBe(10_984_000); // ₦109,840
    expect(twelve.max_affordable).toBe(105_446_400); // spec example ₦1,054,464 for 12 months
    const st = await c.state();
    expect(st.state).toBe('ARAF_SUBMITTED');
    expect(st.status.description).toMatch(/not yet approved/i);
    // Offer summary PDF is downloadable.
    const pdf = await c.get(`/offers/${st.offer.id}/summary.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('partner sees status but never credit details', async () => {
    const app = await request(h.http).get(`/api/v1/applications/${reference}`).set('Authorization', `Bearer ${mall.apiKey}`);
    expect(app.status).toBe(200);
    expect(app.body.status).toBe('SUBMITTED');
    const raw = JSON.stringify(app.body);
    for (const forbidden of ['score', 'bvn', 'salary', 'income', 'capacity', 'obligation', 'ENHANCED', 'band']) expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
  });

  it('goods release is blocked before vendor payment', async () => {
    const r = await request(h.http).post(`/api/v1/orders/${ORDER}/fulfil`).set('Authorization', `Bearer ${mall.apiKey}`).send({ status: 'DISPATCHED' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RELEASE_NOT_AUTHORIZED');
  });

  it('18–21. ARAF workflow approves (maker-checker), customer signs documents and authorises the mandate', async () => {
    const appRow = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    // The recommending analyst cannot also be the approver; analysts lack approval permission.
    await arafApprove(h, reference, analyst, approver);
    const c = await openCheckout(h, sessionId);
    // New browser session requires re-authentication (resume OTP to the identity-linked phone).
    expect((await c.state()).needs_reauthentication).toBe(true);
    await c.post('/resume');
    const resumed = await c.post('/resume/verify', { code: await latestOtp(h, sessionId) });
    expect(resumed.body.state, JSON.stringify(resumed.body)).toBe('DOCUMENTATION_PENDING');
    expect(resumed.body.documents.map((d: { type: string }) => d.type).sort()).toEqual(['OFFER_LETTER', 'PROMISE_TO_PURCHASE', 'VENDOR_INVOICE']);
    await c.post('/documents/otp', { purpose: 'DOCUMENT_SIGNING' });
    const signed = await c.post('/documents/sign', { code: await latestOtp(h, sessionId) });
    expect(signed.body.state).toBe('MANDATE_PENDING');
    const m = await c.post('/mandate/start');
    expect(m.body.authorization_url).toContain('/sandbox/remita/');
    const ref = m.body.authorization_url.split('/').pop();
    // A browser redirect alone proves nothing: until Remita reports ACTIVE the mandate is pending.
    expect((await c.post('/mandate/verify')).body.state).toBe('MANDATE_PENDING');
    await request(h.http).post(`/api/sandbox/remita/${ref}/authorize`).send({ approve: true });
    const verified = await c.post('/mandate/verify');
    expect(verified.body.state).toBe('BOOKING_PENDING');
    expect(appRow.id).toBeTruthy();
  });

  it('22. CAD books, settlement initiates and finance approves the vendor payment (maker-checker)', async () => {
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    // Payment cannot be initiated before booking.
    const early = await settlement.post(`/api/admin/applications/${app.id}/vendor-payment`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('PRECONDITIONS_NOT_MET');
    expect(early.body.error.details.blockers).toEqual(expect.arrayContaining(['BOOKING_NOT_CONFIRMED', 'INVOICE_NOT_APPROVED']));
    expect((await cad.post(`/api/admin/applications/${app.id}/invoice/verify`)).status).toBe(200);
    const booked = await cad.post(`/api/admin/applications/${app.id}/booking`);
    expect(booked.body.status, JSON.stringify(booked.body)).toBe('BOOKED');
    const ins = await settlement.post(`/api/admin/applications/${app.id}/vendor-payment`);
    expect(ins.status, JSON.stringify(ins.body)).toBe(201);
    // Duplicate payment instruction is impossible.
    expect((await settlement.post(`/api/admin/applications/${app.id}/vendor-payment`)).body.error.code).toBe('DUPLICATE_PAYMENT_ATTEMPT');
    const approvals = (await finance.get('/api/admin/approvals?status=PENDING&types=VENDOR_PAYMENT')).body as Array<{ id: string; resource_id: string }>;
    const a = approvals.find((x) => x.resource_id === ins.body.id)!;
    // Settlement officer (maker) cannot approve.
    expect((await settlement.post(`/api/admin/approvals/${a.id}/decide`, { decision: 'APPROVE', comment: 'self' })).status).toBe(403);
    const ok = await finance.post(`/api/admin/approvals/${a.id}/decide`, { decision: 'APPROVE', comment: 'Beneficiary and amount verified' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await drain(h, 2);
    const after = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    expect(after.status).toBe('VENDOR_PAYMENT_CONFIRMED');
    const payment = await h.prisma.vendorPaymentInstruction.findFirstOrThrow({ where: { applicationId: app.id } });
    expect(payment.status).toBe('CONFIRMED');
    expect(payment.confirmedByAuthoritativeSource).toBe(true);
    expect(payment.isSimulated).toBe(true);
    expect(payment.amountKobo).toBe(45_000_000n);
  });

  it('payment confirmed but contractual conditions missing: release still blocked', async () => {
    const r = await request(h.http).post(`/api/v1/orders/${ORDER}/fulfil`).set('Authorization', `Bearer ${mall.apiKey}`).send({ status: 'DISPATCHED' });
    expect(r.body.error.code).toBe('RELEASE_NOT_AUTHORIZED');
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    const detail = await analyst.get(`/api/admin/applications/${app.id}`);
    expect(detail.body.release_gate.authorized).toBe(false);
    expect(detail.body.release_gate.pending_conditions).toEqual(['POSSESSION_EVIDENCED', 'COST_AND_PROFIT_DISCLOSED', 'SALE_CONTRACT_EXECUTED']);
  });

  it('23–25. CAD evidences possession, customer executes the sale; release authorised and signed webhook delivered', async () => {
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    const c = await openCheckout(h, sessionId);
    await c.post('/resume');
    await c.post('/resume/verify', { code: await latestOtp(h, sessionId) });
    // The sale contract cannot be executed before the Bank evidences acquisition/possession.
    expect((await c.post('/documents/otp', { purpose: 'SALE_CONTRACT' })).status).toBe(200);
    const early = await c.post('/sale-contract/sign', { code: await latestOtp(h, sessionId) });
    expect(early.body.error.code).toBe('PRECONDITIONS_NOT_MET');
    const pos = await cad.post(`/api/admin/applications/${app.id}/possession`, { evidence: 'Vendor invoice issued to the Bank; constructive possession via agency letter AL-001.' });
    expect(pos.status, JSON.stringify(pos.body)).toBe(200);
    await c.post('/documents/otp', { purpose: 'SALE_CONTRACT' }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 10));
    const ch = await h.prisma.otpChallenge.findFirst({ where: { applicationId: app.id, purpose: 'SALE_CONTRACT', consumedAt: null, invalidatedAt: null } });
    if (!ch) await c.post('/documents/otp', { purpose: 'SALE_CONTRACT' });
    const signed = await c.post('/sale-contract/sign', { code: await latestOtp(h, sessionId) });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body.state).toBe('RELEASE_AUTHORIZED');
    await drain(h, 3);
    const events = h.receiver.events('goods.release_authorized');
    expect(events).toHaveLength(1);
    expect(events[0].valid).toBe(true);
    expect(events[0].body.data).toMatchObject({ application_reference: reference, merchant_order_reference: ORDER, currency: 'NGN', vendor_payment_amount: 45_000_000, payment_status: 'CONFIRMED', release_authorized: true });
    // Every lifecycle event arrived signed.
    expect(h.receiver.received.every((r) => r.valid)).toBe(true);
    const types = h.receiver.received.map((r) => r.body.event);
    for (const t of ['application.created', 'application.eligible', 'application.submitted', 'financing.approved', 'financing.booked', 'vendor.payment_pending', 'vendor.payment_confirmed', 'goods.release_authorized']) expect(types).toContain(t);
    // Merchant verifies the release through the API (never via a customer screenshot).
    const relRef = events[0].body.data.release_reference as string;
    const rel = await request(h.http).get(`/api/v1/releases/${relRef}`).set('Authorization', `Bearer ${mall.apiKey}`);
    expect(rel.body).toMatchObject({ release_authorized: true, status: 'AUTHORIZED', payment_status: 'CONFIRMED', simulated: true });
  });

  it('26–30. partner dashboard shows the payment; vendor dispatches and delivers; customer sees completion', async () => {
    const queue = await mall.portal.get('/api/partner-portal/release-queue');
    expect(queue.body.some((q: { merchant_order_reference: string; release_status: string }) => q.merchant_order_reference === ORDER && q.release_status === 'AUTHORIZED')).toBe(true);
    const settlements = await mall.portal.get('/api/partner-portal/settlements');
    expect(settlements.body.data[0]).toMatchObject({ status: 'CONFIRMED', amount: 45_000_000 });
    const dispatch = await mall.portal.post(`/api/partner-portal/orders/${ORDER}/fulfil`, { status: 'DISPATCHED', tracking_reference: 'GIG-123', carrier: 'GIG Logistics' });
    expect(dispatch.status, JSON.stringify(dispatch.body)).toBe(200);
    // Duplicate fulfilment is rejected.
    expect((await mall.portal.post(`/api/partner-portal/orders/${ORDER}/fulfil`, { status: 'DISPATCHED' })).status).toBe(409);
    const delivered = await request(h.http).post(`/api/v1/orders/${ORDER}/deliver`).set('Authorization', `Bearer ${mall.apiKey}`).send({ note: 'Signed by customer' });
    expect(delivered.status).toBe(200);
    await drain(h, 2);
    const app = await request(h.http).get(`/api/v1/applications/${reference}`).set('Authorization', `Bearer ${mall.apiKey}`);
    expect(app.body.status).toBe('COMPLETED');
    expect(app.body.timeline.map((t: { status: string }) => t.status)).toEqual(
      expect.arrayContaining(['CUSTOMER_ACTION_REQUIRED', 'ELIGIBLE', 'SUBMITTED', 'APPROVED', 'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED', 'READY_FOR_RELEASE', 'DISPATCHED', 'DELIVERED', 'COMPLETED']),
    );
    expect(h.receiver.events('goods.delivered')).toHaveLength(1);
    const c = await openCheckout(h, sessionId);
    await c.post('/resume');
    const view = (await c.post('/resume/verify', { code: await latestOtp(h, sessionId) })).body;
    expect(view.state).toBe('COMPLETED');
    expect(view.status.label).toBe('Delivered');
  });

  it('execution status is reported back to ARAF in order and acknowledged (D-013)', async () => {
    await drain(h, 2);
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference } });
    const reports = await h.prisma.arafOutboundReport.findMany({ where: { applicationId: app.id }, orderBy: { sequence: 'asc' } });
    expect(reports.map((r) => r.type)).toEqual([
      'BOOKING_CONFIRMED', 'VENDOR_PAYMENT_INITIATED', 'VENDOR_PAYMENT_CONFIRMED', 'RELEASE_AUTHORIZED', 'GOODS_DISPATCHED', 'GOODS_DELIVERED',
    ]);
    expect(reports.every((r) => r.status === 'DELIVERED')).toBe(true);
    expect(reports.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((reports[0].data as Record<string, unknown>).booking_reference).toMatch(/^FIN-SBX-/);
    // The simulated ARAF case history shows each report exactly once.
    const simCase = await h.prisma.simArafCase.findUniqueOrThrow({ where: { applicationRef: reference }, include: { actions: true } });
    const received = simCase.actions.filter((a) => a.action.startsWith('REPORTED:')).map((a) => a.action.slice(9));
    expect(received).toEqual(reports.map((r) => r.type));
    // Visible to Bank staff on the application.
    const detail = await analyst.get(`/api/admin/applications/${app.id}`);
    expect(detail.body.araf.outbound_reports).toHaveLength(6);
  });

  it('management dashboards reflect the lifecycle from database records; audit chain intact', async () => {
    const overview = await management.get('/api/admin/overview?range=all');
    expect(overview.status).toBe(200);
    expect(overview.body.total_applications).toBeGreaterThanOrEqual(1);
    expect(overview.body.confirmed_vendor_payments).toBeGreaterThanOrEqual(45_000_000);
    expect(overview.body.completed_deliveries).toBeGreaterThanOrEqual(1);
    const funnel = (await management.get('/api/admin/reports/funnel?range=all')).body as Array<{ key: string; count: number }>;
    for (const k of ['initiated', 'identity', 'eligible', 'submitted', 'approved', 'booked', 'paid', 'delivered']) expect(funnel.find((f) => f.key === k)!.count).toBeGreaterThanOrEqual(1);
    const portfolio = await management.get('/api/admin/reports/portfolio');
    expect(portfolio.body.available).toBe(false);
    const chain = await auditor.get('/api/admin/audit/verify');
    expect(chain.body.valid).toBe(true);
    expect(chain.body.checked).toBeGreaterThan(20);
    // Management has no sensitive access.
    expect((await management.get('/api/admin/reviews')).status).toBe(403);
    // Audit records cannot be modified, even directly in the database.
    await expect(h.prisma.$executeRawUnsafe(`UPDATE audit_logs SET action = 'tampered'`)).rejects.toThrow(/append-only/);
  });
});
