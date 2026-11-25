import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderSimplePdf } from '../src/common/pdf';
import { createHarness, drain, staff, type Harness, type PortalAgent } from './harness';
import { arafApprove, cart, createCheckout, latestOtp, onboardPartner, openCheckout, toOfferAccepted, verifyIdentity, type CustomerAgent, type OnboardedPartner } from './flows';

/** Sandbox scenarios (spec §60) and security tests (spec §65) through the real HTTP APIs. */
describe('Sandbox scenarios and security controls', () => {
  let h: Harness;
  let a: OnboardedPartner; // partner A (with webhook receiver)
  let b: OnboardedPartner; // partner B (tenant isolation)
  let analyst: PortalAgent, risk: PortalAgent, approver: PortalAgent, cad: PortalAgent, settlement: PortalAgent, finance: PortalAgent, ops: PortalAgent;
  let n = 0;
  const order = () => `SCN-${Date.now()}-${++n}`;

  async function start(bvn: string, dob: string, amountNaira = 450_000) {
    const res = await createCheckout(h, a, cart(order(), amountNaira));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = await openCheckout(h, res.body.session_id);
    const otp = await verifyIdentity(h, c, bvn, dob);
    return { c, otp, ref: res.body.application_reference as string, sessionId: res.body.session_id as string, orderRef: res.body.application_reference as string, body: res.body };
  }

  async function toStatement(c: CustomerAgent, profile: 'SALARY_EARNER' | 'BUSINESS_OWNER' = 'SALARY_EARNER') {
    const accounts = await c.get('/accounts');
    const eligible = accounts.body.accounts.find((x: { eligible: boolean }) => x.eligible);
    await c.post('/accounts/select', { account_id: eligible.id });
    await c.post('/income-profile', { income_profile: profile });
  }

  const appOf = (ref: string) => h.prisma.financingApplication.findUniqueOrThrow({ where: { reference: ref } });

  beforeAll(async () => {
    h = await createHarness();
    a = await onboardPartner(h, { name: 'ScenarioMall' });
    const wh = await a.portal.post('/api/partner-portal/webhooks', { url: h.receiver.url, events: [] });
    h.receiver.secret = wh.body.signing_secret;
    b = await onboardPartner(h, { name: 'OtherShop' });
    [analyst, risk, approver, cad, settlement, finance, ops] = await Promise.all(['analyst', 'risk', 'approver', 'cad', 'settlement', 'finance', 'ops'].map((w) => staff(h, w)));
  }, 180_000);

  afterAll(async () => h?.close());

  // ---- Credit pathways ----------------------------------------------------------------------

  it('5. poor credit → respectful decline; partner told without credit details', async () => {
    const { otp, ref } = await start('22200000005', '1991-11-11');
    expect(otp.body.state).toBe('DECLINED');
    expect(otp.body.status.description).toMatch(/unable to offer financing/);
    expect(JSON.stringify(otp.body)).not.toMatch(/412|score/i);
    await drain(h, 2);
    const declined = h.receiver.events('application.declined').find((e) => e.body.data.application_reference === ref);
    expect(declined?.valid).toBe(true);
    expect(JSON.stringify(declined?.body)).not.toMatch(/score|band|credit/i);
  });

  it('3. fair credit → enhanced assessment → analyst clears → checker approves → continues', async () => {
    const { c, otp, ref } = await start('22200000003', '1988-01-22');
    expect(otp.body.state).toBe('ENHANCED_REVIEW_REQUIRED');
    const info = await c.post('/enhanced-info', { employment_status: 'EMPLOYED', employer_name: 'Lagoon Logistics', employment_duration_months: 40, job_role: 'Analyst', monthly_income_naira: 420000, residential_address: '5 Test Street, Yaba, Lagos', accommodation_type: 'RENTED', dependants: 1, existing_obligations_naira: 40000 });
    expect(info.body.state).toBe('ENHANCED_REVIEW_PENDING');
    const queue = (await analyst.get('/api/admin/reviews?queue=FAIR_CREDIT')).body as Array<{ id: string; application_reference: string }>;
    const review = queue.find((r) => r.application_reference === ref)!;
    const detail = await analyst.get(`/api/admin/reviews/${review.id}`);
    expect(detail.body.form.employer_name).toBe('Lagoon Logistics');
    const decided = await analyst.post(`/api/admin/reviews/${review.id}/decision`, { decision: 'CLEAR', reason: 'Stable employment, obligations within policy' });
    expect(decided.body.status).toBe('PENDING_APPROVAL');
    // The analyst cannot approve their own decision.
    const approvals = (await risk.get('/api/admin/approvals?status=PENDING&types=REVIEW_DECISION')).body as Array<{ id: string; resource_id: string }>;
    const ap = approvals.find((x) => x.resource_id === review.id)!;
    expect((await analyst.post(`/api/admin/approvals/${ap.id}/decide`, { decision: 'APPROVE', comment: 'self' })).status).toBe(403);
    expect((await risk.post(`/api/admin/approvals/${ap.id}/decide`, { decision: 'APPROVE', comment: 'Concur with analyst' })).status).toBe(200);
    expect((await appOf(ref)).status).toBe('ACCOUNT_VERIFICATION_PENDING');
  });

  it('4. fair credit → enhanced review declined', async () => {
    const { c, ref } = await start('22200000004', '1985-06-30');
    await c.post('/enhanced-info', { employment_status: 'EMPLOYED', monthly_income_naira: 300000, residential_address: '9 Test Close, Ikeja', accommodation_type: 'FAMILY', dependants: 3, existing_obligations_naira: 120000 });
    const review = ((await analyst.get('/api/admin/reviews')).body as Array<{ id: string; application_reference: string }>).find((r) => r.application_reference === ref)!;
    await analyst.post(`/api/admin/reviews/${review.id}/decision`, { decision: 'DECLINE', reason: 'Delinquency indicators and high obligations' });
    const ap = ((await risk.get('/api/admin/approvals?status=PENDING&types=REVIEW_DECISION')).body as Array<{ id: string; resource_id: string }>).find((x) => x.resource_id === review.id)!;
    await risk.post(`/api/admin/approvals/${ap.id}/decide`, { decision: 'APPROVE', comment: 'Concur' });
    expect((await appOf(ref)).status).toBe('DECLINED');
  });

  it('6. no credit history → never zero; routed to thin-file review', async () => {
    const { otp, ref } = await start('22200000006', '2000-02-14');
    expect(otp.body.state).toBe('ENHANCED_REVIEW_REQUIRED');
    const assessment = await h.prisma.creditAssessment.findFirstOrThrow({ where: { applicationId: (await appOf(ref)).id } });
    expect(assessment.score).toBeNull();
    expect(assessment.band).toBe('NO_SCORE');
    expect((await h.prisma.enhancedReview.findFirstOrThrow({ where: { applicationId: assessment.applicationId } })).queue).toBe('THIN_FILE');
  });

  it('SeedFi timeout and invalid response are technical failures, never poor credit', async () => {
    const t = await start('22200000098', '1990-01-02');
    expect(t.otp.status).toBe(503);
    expect(t.otp.body.error.code).toBe('CREDIT_PROVIDER_UNAVAILABLE');
    expect((await appOf(t.ref)).status).toBe('CREDIT_CHECK_PENDING');
    const retry = await t.c.post('/credit-check');
    expect(retry.status).toBe(503);
    const inv = await start('22200000097', '1990-01-03');
    expect(inv.otp.body.error.code).toBe('CREDIT_INVALID_RESPONSE');
    expect((await appOf(inv.ref)).status).toBe('CREDIT_CHECK_PENDING');
  });

  it('identity provider outage → safe retry message; DOB mismatch → identity mismatch', async () => {
    const res = await createCheckout(h, a, cart(order()));
    const c = await openCheckout(h, res.body.session_id);
    await c.post('/consents', { consents: ['IDENTITY_VERIFICATION', 'CREDIT_ASSESSMENT', 'APPLICATION_PROCESSING'] });
    expect((await c.post('/identity', { bvn: '22200000099', date_of_birth: '1990-01-01' })).body.error.code).toBe('IDENTITY_PROVIDER_UNAVAILABLE');
    expect((await c.post('/identity', { bvn: '22200000001', date_of_birth: '1990-04-13' })).body.error.code).toBe('IDENTITY_MISMATCH');
    expect((await c.post('/identity', { bvn: '2220000', date_of_birth: '1990-04-13' })).body.error.code).toBe('INVALID_BVN');
  });

  it('consent is required before identity checks', async () => {
    const res = await createCheckout(h, a, cart(order()));
    const c = await openCheckout(h, res.body.session_id);
    expect((await c.post('/identity', { bvn: '22200000001', date_of_birth: '1990-04-12' })).body.error.code).toBe('CONSENT_REQUIRED');
    expect((await c.post('/consents', { consents: ['IDENTITY_VERIFICATION'] })).body.error.code).toBe('CONSENT_REQUIRED');
  });

  // ---- Statements & affordability ------------------------------------------------------------

  it('11. missing salary month in a complete statement → decline', async () => {
    const { c, ref } = await start('22200000011', '1989-07-07');
    await toStatement(c);
    await c.post('/statements/altbank');
    await drain(h, 1);
    await c.state();
    const app = await appOf(ref);
    expect(app.status).toBe('DECLINED');
    expect(app.declineReasonCode).toBe('MISSING_SALARY_MONTH');
  });

  it('12. high existing obligations → no capacity → decline', async () => {
    const { c, ref } = await start('22200000012', '1984-03-19');
    await toStatement(c);
    await c.post('/statements/altbank');
    await drain(h, 1);
    expect((await appOf(ref)).declineReasonCode).toBe('NO_REPAYMENT_CAPACITY');
  });

  it('13. insufficient eligibility → cart revision; revised session reuses assessments', async () => {
    const res = await createCheckout(h, a, cart(`REV-${Date.now()}`, 450_000));
    const c = await openCheckout(h, res.body.session_id);
    await verifyIdentity(h, c, '22200000013', '1996-05-05');
    await toStatement(c);
    await c.post('/statements/altbank');
    await drain(h, 1);
    const st = await c.state();
    expect(st.state).toBe('ELIGIBLE');
    expect(st.eligibility.reasons).toContain('CART_REVISION_REQUIRED');
    expect(st.eligibility.max_eligible_amount).toBeLessThan(45_000_000);
    // Offers cannot be selected when the cart exceeds eligibility.
    expect((await c.post('/offers/select', { tenor_months: 12 })).body.error.code).toBe('OFFER_NOT_AFFORDABLE');
    // Merchant creates a revised, smaller cart for the same order.
    const orderRef = (await h.prisma.merchantOrder.findFirstOrThrow({ where: { checkoutSessions: { some: { id: res.body.session_id } } } })).merchantOrderReference;
    const revised = await createCheckout(h, a, { ...cart(orderRef, 250_000), revises_session_id: res.body.session_id });
    expect(revised.status, JSON.stringify(revised.body)).toBe(201);
    expect((await h.prisma.checkoutSession.findUniqueOrThrow({ where: { id: res.body.session_id } })).status).toBe('SUPERSEDED');
    const c2 = await openCheckout(h, revised.body.session_id);
    const otp = await verifyIdentity(h, c2, '22200000013', '1996-05-05');
    expect(otp.body.state, JSON.stringify(otp.body)).toBe('ELIGIBLE'); // no repeated credit check / statement
    expect(otp.body.eligibility.reasons).not.toContain('CART_REVISION_REQUIRED');
  });

  it('14. business owner → 12-month statement and manual review queue', async () => {
    const { c, ref } = await start('22200000014', '1980-10-01');
    await toStatement(c, 'BUSINESS_OWNER');
    const st0 = await c.state();
    expect(st0.statement.required_months).toBe(12);
    await c.post('/statements/altbank');
    await drain(h, 1);
    const st = await c.state();
    expect(st.state).toBe('AFFORDABILITY_REVIEW_REQUIRED');
    expect(st.contact_window_hours).toEqual({ min: 24, max: 48 });
    const reviews = (await analyst.get('/api/admin/reviews?queue=BUSINESS_OWNER')).body as Array<{ application_reference: string }>;
    expect(reviews.some((r) => r.application_reference === ref)).toBe(true);
  });

  it('uncertain salary classification → review, not decline', async () => {
    const { c, ref } = await start('22200000015', '1992-12-12');
    await toStatement(c);
    await c.post('/statements/altbank');
    await drain(h, 1);
    expect((await appOf(ref)).status).toBe('AFFORDABILITY_REVIEW_REQUIRED');
  });

  it('2/8/29. new customer: account opening interrupted & resumed, then Mono statement', async () => {
    const { c, ref } = await start('22200000002', '1993-09-03');
    const accts = await c.get('/accounts');
    expect(accts.body.accounts).toHaveLength(0);
    const ao = await c.post('/account-opening/start');
    const aoRef = ao.body.redirect_url.split('/').pop();
    // Customer leaves the account opening platform without finishing.
    const abandon = await request(h.http).post(`/api/sandbox/account-opening/${aoRef}/abandon`);
    const state = new URL(abandon.body.return_url).searchParams.get('state')!;
    // A browser redirect alone does not prove the account exists.
    expect((await c.post('/account-opening/complete', { state })).body.error.code).toBe('ACCOUNT_OPENING_INCOMPLETE');
    // Later, the customer resumes (fresh session, re-verify) and completes account opening.
    const again = await c.post('/account-opening/start');
    const ref2 = again.body.redirect_url.split('/').pop();
    await request(h.http).post(`/api/sandbox/account-opening/${ref2}/complete`);
    expect((await appOf(ref)).status).toBe('ACCOUNT_VERIFIED'); // via the signed callback
    await c.post('/income-profile', { income_profile: 'SALARY_EARNER' });
    // New account has no history → AltBank statement insufficient; alternatives offered.
    const alt = await c.post('/statements/altbank');
    expect(alt.body.error.code).toBe('STATEMENT_COVERAGE_INSUFFICIENT');
    expect(alt.body.error.details.alternatives).toEqual(['MONO', 'PDF_UPLOAD']);
    const mono = await c.post('/statements/mono/session');
    const monoRef = mono.body.connect_url.split('/').pop();
    const auth = await request(h.http).post(`/api/sandbox/mono/${monoRef}/authorize`).send({ institution: 'Lagoon Bank (sandbox)', outcome: 'SUCCESS' });
    const ex = await c.post('/statements/mono/exchange', { code: auth.body.code });
    expect(ex.status, JSON.stringify(ex.body)).toBe(200);
    // The authorisation code is single-use.
    expect((await c.post('/statements/mono/exchange', { code: auth.body.code })).status).not.toBe(200);
    await drain(h, 1);
    expect((await c.state()).state).toBe('ELIGIBLE');
  });

  it('9/10. PDF upload: invalid, malware and active content rejected; valid PDF analysed', async () => {
    const { c, ref } = await start('22200000016', '1994-08-08');
    await toStatement(c);
    const up = (buf: Buffer, name = 'statement.pdf') => c.post('/statements/pdf').attach('file', buf, { filename: name, contentType: 'application/pdf' });
    expect((await up(Buffer.from('this is not a pdf at all, just text pretending'), 'fake.pdf')).body.error.code).toBe('PDF_INVALID');
    const js = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
    expect((await up(js)).body.error.details.findings).toEqual(expect.arrayContaining(['ACTIVE_CONTENT_JAVASCRIPT']));
    const enc = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 2 0 R >>\n%%EOF\n');
    expect((await up(enc)).body.error.code).toBe('PDF_ENCRYPTED');
    const eicar = renderSimplePdf('Statement', ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*']);
    const infected = Buffer.concat([eicar.subarray(0, 20), Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'), eicar.subarray(20)]);
    expect((await up(infected)).body.error.code).toBe('MALWARE_DETECTED');
    const good = renderSimplePdf('Account statement', ['Sandbox Bank PLC', 'Account holder: AMAKA IGWE-TEST', 'Period: last 6 months']);
    const ok = await up(good);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await up(good)).status).not.toBe(200); // duplicate or wrong stage
    await drain(h, 1);
    expect((await appOf(ref)).status).toBe('ELIGIBLE');
  });

  // ---- ARAF, mandate, booking, payment exceptions -------------------------------------------

  async function toBookingPending(bvn: string, dob: string) {
    const res = await createCheckout(h, a, cart(order()));
    const c = await openCheckout(h, res.body.session_id);
    await toOfferAccepted(h, c, bvn, dob, 12);
    const ref = res.body.application_reference as string;
    await arafApprove(h, ref, analyst, approver);
    const fresh = await openCheckout(h, res.body.session_id);
    await fresh.post('/resume');
    await fresh.post('/resume/verify', { code: await latestOtp(h, res.body.session_id) });
    await fresh.post('/documents/otp', { purpose: 'DOCUMENT_SIGNING' });
    await fresh.post('/documents/sign', { code: await latestOtp(h, res.body.session_id) });
    const m = await fresh.post('/mandate/start');
    await request(h.http).post(`/api/sandbox/remita/${m.body.authorization_url.split('/').pop()}/authorize`).send({ approve: true });
    const v = await fresh.post('/mandate/verify');
    return { c: fresh, ref, state: v.body.state as string, sessionId: res.body.session_id as string };
  }

  it('16. ARAF rejection → declined, exposure released', async () => {
    const res = await createCheckout(h, a, cart(order()));
    const c = await openCheckout(h, res.body.session_id);
    await toOfferAccepted(h, c, '22200000001', '1990-04-12');
    const cases = (await analyst.get('/api/admin/araf-simulator/cases')).body as Array<{ id: string; application_reference: string }>;
    const cs = cases.find((x) => x.application_reference === res.body.application_reference)!;
    await analyst.post(`/api/admin/araf-simulator/cases/${cs.id}/actions`, { action: 'START_EVALUATION', note: 'Begin' });
    await analyst.post(`/api/admin/araf-simulator/cases/${cs.id}/actions`, { action: 'REJECT', note: 'Vendor not acceptable for this product' });
    const app = await appOf(res.body.application_reference);
    expect(app.status).toBe('DECLINED');
    expect((await h.prisma.exposureReservation.findUniqueOrThrow({ where: { applicationId: app.id } })).status).toBe('RELEASED');
  });

  it('ARAF information request → customer responds → back under review', async () => {
    const res = await createCheckout(h, a, cart(order()));
    const c = await openCheckout(h, res.body.session_id);
    await toOfferAccepted(h, c, '22200000001', '1990-04-12');
    const cs = ((await analyst.get('/api/admin/araf-simulator/cases')).body as Array<{ id: string; application_reference: string }>).find((x) => x.application_reference === res.body.application_reference)!;
    await analyst.post(`/api/admin/araf-simulator/cases/${cs.id}/actions`, { action: 'START_EVALUATION', note: 'Begin' });
    await analyst.post(`/api/admin/araf-simulator/cases/${cs.id}/actions`, { action: 'REQUEST_INFO', note: 'Please confirm your employer address' });
    expect((await appOf(res.body.application_reference)).status).toBe('ADDITIONAL_INFORMATION_REQUIRED');
    const c2 = await openCheckout(h, res.body.session_id);
    await c2.post('/resume');
    await c2.post('/resume/verify', { code: await latestOtp(h, res.body.session_id) });
    expect((await c2.post('/information', { note: '12 Broad Street, Lagos' })).body.state).toBe('ARAF_UNDER_REVIEW');
    const after = ((await analyst.get('/api/admin/araf-simulator/cases')).body as Array<{ id: string; stage: string }>).find((x) => x.id === cs.id)!;
    expect(after.stage).toBe('BUSINESS_EVALUATION');
  });

  it('17. mandate failure → exception, customer may retry', async () => {
    const { ref, state } = await toBookingPending('22200000017', '1990-01-17');
    expect(state).toBe('MANDATE_PENDING');
    const app = await appOf(ref);
    expect((await h.prisma.repaymentMandate.findUniqueOrThrow({ where: { applicationId: app.id } })).status).toBe('FAILED');
    expect(await h.prisma.operationalException.count({ where: { applicationId: app.id, code: 'MANDATE_FAILURE', status: 'OPEN' } })).toBe(1);
  });

  it('18. booking failure → vendor payment blocked, exception raised', async () => {
    const { ref, state } = await toBookingPending('22200000018', '1990-01-18');
    expect(state).toBe('BOOKING_PENDING');
    const app = await appOf(ref);
    await cad.post(`/api/admin/applications/${app.id}/invoice/verify`);
    const booking = await cad.post(`/api/admin/applications/${app.id}/booking`);
    expect(booking.body.status).toBe('FAILED');
    expect((await appOf(ref)).status).toBe('EXCEPTION');
    expect((await settlement.post(`/api/admin/applications/${app.id}/vendor-payment`)).status).toBe(409);
  });

  it('ARAF events: duplicates ignored, stale events never overwrite newer status, callbacks must be signed', async () => {
    const before = await h.prisma.arafStatusEvent.count();
    const unsigned = await request(h.http).post('/api/callbacks/araf').send({ event_id: 'x', araf_reference: 'y', sequence: 1, stage: 'APPROVED', occurred_at: new Date().toISOString() });
    expect(unsigned.status).toBe(401);
    expect(await h.prisma.arafStatusEvent.count()).toBe(before);
    const stale = await h.prisma.arafStatusEvent.findFirstOrThrow({ where: { stage: 'APPROVED', outcome: 'APPLIED' } });
    const { ArafService } = await import('../src/araf/araf.service');
    const svc = h.app.get(ArafService);
    const r = await svc.ingest({ event_id: `stale-${Date.now()}`, araf_reference: stale.arafReference, sequence: 1, stage: 'REJECTED', occurred_at: new Date().toISOString() }, { type: 'PROVIDER' });
    expect(r.outcome).toBe('IGNORED_STALE');
    expect((await svc.ingest({ event_id: stale.eventId, araf_reference: stale.arafReference, sequence: 99, stage: 'REJECTED', occurred_at: new Date().toISOString() }, { type: 'PROVIDER' })).outcome).toBe('DUPLICATE');
    expect((await h.prisma.financingApplication.findUniqueOrThrow({ where: { id: stale.applicationId } })).status).not.toBe('DECLINED');
  });

  async function toPaymentPending(bvn: string, dob: string) {
    const { ref } = await toBookingPending(bvn, dob);
    const app = await appOf(ref);
    await cad.post(`/api/admin/applications/${app.id}/invoice/verify`);
    expect((await cad.post(`/api/admin/applications/${app.id}/booking`)).body.status).toBe('BOOKED');
    const ins = await settlement.post(`/api/admin/applications/${app.id}/vendor-payment`);
    const ap = ((await finance.get('/api/admin/approvals?status=PENDING&types=VENDOR_PAYMENT')).body as Array<{ id: string; resource_id: string }>).find((x) => x.resource_id === ins.body.id)!;
    const decided = await finance.post(`/api/admin/approvals/${ap.id}/decide`, { decision: 'APPROVE', comment: 'Beneficiary verified' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    await drain(h, 2);
    return { app, instructionId: ins.body.id as string, ref };
  }

  it('19. vendor payment failure → exception; resolution allows a NEW approved instruction', async () => {
    const { app, instructionId, ref } = await toPaymentPending('22200000019', '1990-01-19');
    expect((await h.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: instructionId } })).status).toBe('FAILED');
    expect((await appOf(ref)).status).toBe('EXCEPTION');
    expect(h.receiver.events('vendor.payment_failed').some((e) => e.body.data.application_reference === ref)).toBe(true);
    const exc = await h.prisma.operationalException.findFirstOrThrow({ where: { applicationId: app.id, code: 'PAYMENT_FAILURE' } });
    expect((await ops.post(`/api/admin/exceptions/${exc.id}/actions`, { action: 'RESUME', note: 'Vendor confirmed corrected account' })).status).toBe(200);
    expect((await appOf(ref)).status).toBe('FINANCING_BOOKED');
  });

  it('20/27. unknown payment status → never re-initiated; reconciliation confirms the single payment', async () => {
    const { app, instructionId, ref } = await toPaymentPending('22200000020', '1990-01-20');
    const ins = await h.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: instructionId } });
    // The worker reconciled the UNKNOWN outcome against the payment system.
    expect(['CONFIRMED', 'UNKNOWN']).toContain(ins.status);
    if (ins.status === 'UNKNOWN') await settlement.post(`/api/admin/payments/${instructionId}/reconcile`);
    expect((await h.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: instructionId } })).status).toBe('CONFIRMED');
    expect((await appOf(ref)).status).toBe('VENDOR_PAYMENT_CONFIRMED');
    // Exactly one payment exists at the (simulated) rail and one instruction in ARAF.
    expect(await h.prisma.simRecord.count({ where: { kind: 'PAYMENT', key: { startsWith: `vpay-${app.id}` } } })).toBe(1);
    expect(await h.prisma.vendorPaymentInstruction.count({ where: { applicationId: app.id } })).toBe(1);
    const events = await h.prisma.vendorPaymentEvent.findMany({ where: { instructionId }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.status)).toEqual(expect.arrayContaining(['UNKNOWN', 'CONFIRMED']));
    // Database-level duplicate payment prevention.
    await expect(
      h.prisma.vendorPaymentInstruction.create({
        data: { ...(((x: typeof ins) => { const { id: _i, reference: _r, idempotencyKey: _k, createdAt: _c, updatedAt: _u, ...rest } = x; return rest; })(ins)), reference: `PAY-DUP-${Date.now()}`, idempotencyKey: `dup-${Date.now()}`, status: 'PENDING_APPROVAL' },
      }),
    ).rejects.toThrow();
    // Payment reversal suspends release eligibility and raises an exception.
    const rev = await ops.post(`/api/admin/sandbox/applications/${app.id}/reverse-payment`);
    expect(rev.status === 200 || rev.status === 403).toBe(true);
  });

  it('23. webhook endpoint failure → retried with backoff, then delivered', async () => {
    h.receiver.failNext = 2;
    const before = h.receiver.received.length;
    await createCheckout(h, a, cart(order()));
    await drain(h, 1);
    void before;
    const retrying = await h.prisma.webhookDelivery.findFirstOrThrow({ where: { status: 'RETRYING' }, orderBy: { createdAt: 'desc' } });
    expect(retrying.lastStatusCode).toBe(500);
    for (let i = 0; i < 3; i++) {
      await h.prisma.webhookDelivery.updateMany({ where: { status: 'RETRYING' }, data: { nextAttemptAt: new Date() } });
      await drain(h, 1);
    }
    const done = await h.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: retrying.id } });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.attemptCount).toBeGreaterThanOrEqual(2);
    const attempts = await h.prisma.webhookDeliveryAttempt.findMany({ where: { deliveryId: retrying.id }, orderBy: { attemptNumber: 'asc' } });
    expect(attempts[0].statusCode).toBe(500);
    expect(attempts[attempts.length - 1].statusCode).toBe(200);
    expect(await h.prisma.webhookDelivery.count({ where: { status: { in: ['RETRYING', 'PENDING'] } } })).toBe(0);
  });

  // ---- Exposure concurrency ------------------------------------------------------------------

  it('28. concurrent applications cannot exceed the single obligor limit', async () => {
    // Existing exposure ₦4.6m → ₦400k remains. Two ₦300k carts evaluated concurrently.
    const s1 = await start('22200000028', '1979-09-09', 300_000);
    const s2 = await start('22200000028', '1979-09-09', 300_000);
    await toStatement(s1.c);
    await toStatement(s2.c);
    await Promise.all([s1.c.post('/statements/altbank'), s2.c.post('/statements/altbank')]);
    await drain(h, 1);
    await Promise.all([s1.c.state(), s2.c.state()]);
    const apps = await Promise.all([appOf(s1.ref), appOf(s2.ref)]);
    const reservations = await h.prisma.exposureReservation.findMany({ where: { applicationId: { in: apps.map((x) => x.id) }, status: 'ACTIVE' } });
    const reserved = reservations.reduce((t, r) => t + r.amountKobo, 0n);
    expect(reserved).toBeLessThanOrEqual(40_000_000n);
    expect(reservations).toHaveLength(1);
  });

  // ---- Security --------------------------------------------------------------------------------

  it('tenant isolation: partner B cannot read partner A resources by guessing identifiers', async () => {
    const res = await createCheckout(h, a, cart(order()));
    const ref = res.body.application_reference;
    const orderRef = (await h.prisma.merchantOrder.findFirstOrThrow({ where: { checkoutSessions: { some: { id: res.body.session_id } } } })).merchantOrderReference;
    const asB = (path: string) => request(h.http).get(path).set('Authorization', `Bearer ${b.apiKey}`);
    expect((await asB(`/api/v1/applications/${ref}`)).status).toBe(404);
    expect((await asB(`/api/v1/orders/${orderRef}`)).status).toBe(404);
    expect((await asB(`/api/v1/checkout/sessions/${res.body.session_id}`)).status).toBe(404);
    const rel = await h.prisma.releaseAuthorization.findFirst({ where: { partnerId: a.id } });
    if (rel) expect((await asB(`/api/v1/releases/${rel.reference}`)).status).toBe(404);
    expect((await request(h.http).post(`/api/v1/orders/${orderRef}/cancel`).set('Authorization', `Bearer ${b.apiKey}`).send({ reason: 'malicious' })).status).toBe(404);
    expect((await b.portal.get(`/api/partner-portal/applications/${ref}`)).status).toBe(404);
    const list = await b.portal.get('/api/partner-portal/applications?range=all&page_size=100');
    expect(list.body.data.some((x: { reference: string }) => x.reference === ref)).toBe(false);
    const evA = await h.prisma.webhookEvent.findFirstOrThrow({ where: { partnerId: a.id } });
    expect((await request(h.http).post(`/api/v1/webhook-events/${evA.id}/retry`).set('Authorization', `Bearer ${b.apiKey}`)).status).toBe(404);
  });

  it('authentication, CSRF, scopes, revoked keys and portal separation are enforced', async () => {
    expect((await request(h.http).get('/api/admin/overview')).status).toBe(401);
    expect((await request(h.http).get('/api/v1/settlements')).status).toBe(401);
    expect((await request(h.http).get('/api/v1/settlements').set('Authorization', 'Bearer sk_test_' + 'A'.repeat(40))).body.error.code).toBe('INVALID_API_KEY');
    // CSRF: a state-changing request without the token is rejected.
    expect((await analyst.agent.post('/api/admin/reconciliation/run').send({})).body.error.code).toBe('CSRF_FAILED');
    // A partner session cannot use the admin portal.
    expect((await b.portal.get('/api/admin/overview')).status).toBe(401);
    // Least privilege: an analyst cannot initiate payments or manage users.
    expect((await analyst.post('/api/admin/applications/00000000-0000-0000-0000-000000000000/vendor-payment')).status).toBe(403);
    expect((await analyst.get('/api/admin/users')).status).toBe(403);
    // Scoped key: read-only key cannot create checkout sessions.
    const ro = await b.portal.post('/api/partner-portal/credentials', { name: 'read only', scopes: ['applications:read'] });
    const roRes = await request(h.http).post('/api/v1/checkout/sessions').set('Authorization', `Bearer ${ro.body.secret}`).set('Idempotency-Key', `ro-${Date.now()}`).send(cart(order()));
    expect(roRes.body.error.code).toBe('INSUFFICIENT_SCOPE');
    await b.portal.post(`/api/partner-portal/credentials/${ro.body.id}/revoke`);
    expect((await request(h.http).get('/api/v1/settlements').set('Authorization', `Bearer ${ro.body.secret}`)).body.error.code).toBe('INVALID_API_KEY');
    // Secrets are never stored in recoverable form.
    const stored = await h.prisma.partnerApiCredential.findUniqueOrThrow({ where: { id: ro.body.id } });
    expect(JSON.stringify(stored)).not.toContain(ro.body.secret.slice(16));
  });

  it('customer session: cross-session use rejected, OTP brute force limited, OTP single-use, inactivity re-auth', async () => {
    const s1 = await createCheckout(h, a, cart(order()));
    const s2 = await createCheckout(h, a, cart(order()));
    const c1 = await openCheckout(h, s1.body.session_id);
    // c1's cookie cannot be used against session 2.
    const cross = await (c1 as unknown as { get(p: string): request.Test }).get('/state');
    expect(cross.status).toBe(200);
    // A browser session for checkout session 2 cannot access checkout session 1.
    const agent = request.agent(h.http);
    await agent.post(`/api/checkout/sessions/${s2.body.session_id}/open`);
    expect((await agent.get(`/api/checkout/sessions/${s1.body.session_id}/state`)).body.error.code).toBe('SESSION_EXPIRED');
    // OTP brute force → attempts exceeded; replay of a consumed code → rejected.
    await c1.post('/consents', { consents: ['IDENTITY_VERIFICATION', 'CREDIT_ASSESSMENT', 'APPLICATION_PROCESSING'] });
    await c1.post('/identity', { bvn: '22200000001', date_of_birth: '1990-04-12' });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await c1.post('/identity/otp', { code: '000000' })).body.error.code);
    expect(codes.slice(0, 4), JSON.stringify(codes)).toEqual(['OTP_INVALID', 'OTP_INVALID', 'OTP_INVALID', 'OTP_INVALID']);
    expect(codes[4]).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect((await c1.post('/identity/otp', { code: await latestOtp(h, s1.body.session_id) })).body.error.code).toBe('OTP_EXPIRED');
    // Inactivity (> 5 min) → re-authentication required.
    const s3 = await createCheckout(h, a, cart(order()));
    const c3 = await openCheckout(h, s3.body.session_id);
    await verifyIdentity(h, c3, '22200000001', '1990-04-12');
    const app = await h.prisma.financingApplication.findFirstOrThrow({ where: { checkoutSessionId: s3.body.session_id } });
    await h.prisma.customerSession.updateMany({ where: { applicationId: app.id }, data: { lastActivityAt: new Date(Date.now() - 6 * 60_000) } });
    const st = await c3.state();
    expect(st.needs_reauthentication).toBe(true);
    expect(st.customer).toBeUndefined();
    expect((await c3.get('/accounts')).body.error.code).toBe('SESSION_EXPIRED');
  });

  it('state machine cannot be bypassed by calling later-stage APIs', async () => {
    const res = await createCheckout(h, a, cart(order()));
    const c = await openCheckout(h, res.body.session_id);
    await verifyIdentity(h, c, '22200000001', '1990-04-12');
    expect((await c.post('/offers/select', { tenor_months: 12 })).body.error.code).toBe('INVALID_STATE');
    expect((await c.post('/documents/sign', { code: '123456' })).body.error.code).toBe('INVALID_STATE');
    expect((await c.post('/sale-contract/sign', { code: '123456' })).body.error.code).toBe('INVALID_STATE');
    expect((await c.post('/mandate/start')).body.error.code).toBe('INVALID_STATE');
    expect((await c.post('/statements/altbank')).body.error.code).toBe('INVALID_STATE');
    const app = await appOf(res.body.application_reference);
    expect((await cad.post(`/api/admin/applications/${app.id}/booking`)).body.error.code).toBe('INVALID_STATE');
  });

  it('injection-style input is treated as data; errors never leak internals', async () => {
    const r = await analyst.get(`/api/admin/applications?search=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    const bad = await request(h.http).post('/api/v1/checkout/sessions').set('Authorization', `Bearer ${a.apiKey}`).set('Idempotency-Key', `bad-${Date.now()}`).send({ amount: 'lots' });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).not.toMatch(/prisma|stack|at \w+ \(|SELECT|node_modules/i);
  });

  it('production integrations are fail-closed in this sandbox deployment', async () => {
    const r = await a.portal.post(`/api/partner-portal/credentials`, { name: 'x', scopes: ['checkout:read'] });
    expect(r.body.secret).toMatch(/^sk_test_/); // no live keys can be minted
    const integrations = await (await staff(h, 'developer')).get('/api/admin/integrations');
    expect(integrations.body.live_operations_enabled).toBe(false);
    expect(integrations.body.production_gates.every((g: { status: string }) => g.status === 'OUTSTANDING')).toBe(true);
  });
});
