import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { cart, createCheckout, onboardPartner, openCheckout, verifyIdentity, type OnboardedPartner } from './flows';

/** "Once and for all": a customer's still-valid SeedFi result is reused by their next application. */
describe('Credit check reuse across applications', () => {
  let h: Harness;
  let mall: OnboardedPartner;
  beforeAll(async () => {
    h = await createHarness();
    mall = await onboardPartner(h, { name: 'ReuseMall' });
  }, 180_000);
  afterAll(async () => h?.close());

  async function apply(order: string) {
    const created = await createCheckout(h, mall, cart(order));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const c = await openCheckout(h, created.body.session_id);
    const otp = await verifyIdentity(h, c, '22200000001', '1990-04-12');
    expect(otp.status, JSON.stringify(otp.body)).toBe(200);
    return h.prisma.financingApplication.findUniqueOrThrow({ where: { reference: created.body.application_reference } });
  }

  it('calls SeedFi once, then reuses the result (keeping its original expiry) for the next application', async () => {
    const first = await apply(`REUSE-${Date.now()}-A`);
    const a1 = await h.prisma.creditAssessment.findFirstOrThrow({ where: { applicationId: first.id, status: 'COMPLETED' } });
    const calls = () => h.prisma.integrationLog.count({ where: { provider: 'SEEDFI', operation: 'credit_assessment' } });
    const before = await calls();

    const second = await apply(`REUSE-${Date.now()}-B`);
    const a2 = await h.prisma.creditAssessment.findFirstOrThrow({ where: { applicationId: second.id, status: 'COMPLETED' } });
    expect(await calls()).toBe(before);
    expect(a2.score).toBe(a1.score);
    expect(a2.band).toBe(a1.band);
    expect(a2.validUntil?.getTime()).toBe(a1.validUntil?.getTime());
    expect(a2.reusedFromId === a1.id || a2.reusedFromId === a1.reusedFromId).toBe(true);
    // The identity step recorded the gender on the BVN record for the credit check.
    const idv = await h.prisma.identityVerification.findFirstOrThrow({ where: { applicationId: second.id, status: 'VERIFIED' } });
    expect(idv.gender).toBe('female');
  });
});
