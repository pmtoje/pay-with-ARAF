import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness';
import { cart, createCheckout, onboardPartner, openCheckout, verifyIdentity, type OnboardedPartner } from './flows';

/** Take what the merchant passed; ask only for what is remaining. */
describe('Merchant details skip the questions they answer', () => {
  let h: Harness;
  let mall: OnboardedPartner;
  beforeAll(async () => {
    h = await createHarness();
    mall = await onboardPartner(h, { name: 'PrefillMall', equity: true });
  }, 180_000);
  afterAll(async () => h?.close());

  async function start(order: string, extra: Record<string, unknown>, bvn: string, dob: string) {
    const base = cart(order);
    const created = await createCheckout(h, mall, { ...base, customer: { ...base.customer, ...(extra.customer as object) }, ...(extra.top as object) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const c = await openCheckout(h, created.body.session_id);
    const otp = await verifyIdentity(h, c, bvn, dob);
    expect(otp.status, JSON.stringify(otp.body)).toBe(200);
    return { c, ref: created.body.application_reference as string };
  }

  it('fair credit: the eligibility form is skipped when the merchant sent how the shopper earns and where', async () => {
    const { c, ref } = await start(`PRE-${Date.now()}-A`, { customer: { income_type: 'BUSINESS', business_name: 'Ikeja Phones Hub', nature_of_business: 'Phone retail' } }, '22200000003', '1988-01-22');
    expect((await c.state()).state).toBe('ENHANCED_REVIEW_PENDING');
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference: ref } });
    expect((await h.prisma.enhancedReview.findFirstOrThrow({ where: { applicationId: app.id } })).status).toBe('PENDING');
  });

  it('the "How do you earn?" step is skipped, and the agreed equity is used, when the merchant sent them', async () => {
    const { c, ref } = await start(`PRE-${Date.now()}-B`, { customer: { income_type: 'SALARY', employer_name: 'Acme Ltd' }, top: { customer_equity_amount: 5_000_000 } }, '22200000001', '1990-04-12');
    const accounts = await c.get('/accounts');
    const eligible = accounts.body.accounts.find((a: { eligible: boolean }) => a.eligible);
    const sel = await c.post('/accounts/select', { account_id: eligible.id });
    expect(sel.body.state).toBe('STATEMENT_PENDING');
    const app = await h.prisma.financingApplication.findUniqueOrThrow({ where: { reference: ref } });
    expect(app.incomeProfile).toBe('SALARY_EARNER');
    expect(app.contributionAmountKobo).toBe(5_000_000n);
  });
});
