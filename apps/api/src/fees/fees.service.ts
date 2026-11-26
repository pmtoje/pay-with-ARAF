import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { merchantFee } from '@araf/business-rules';
import type { Environment, FinancingApplication } from '@araf/database';
import { AppError, fail } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, ReferenceService, type Actor } from '../common/core.services';

const n = (v: bigint) => Number(v);

/**
 * ARAF merchant fee: a percentage (2% by default, per partner configuration) of the purchase amount
 * applied for — the full price, whether or not the customer paid equity. It is charged to the
 * MERCHANT and invoiced monthly; it never changes the customer's price or the vendor payment.
 *
 * Accrued once per application when the vendor payment is confirmed (the transaction is processed);
 * reversed if that payment is reversed or the goods are refunded. Reversals after invoicing appear as
 * credits on the next invoice.
 */
@Injectable()
export class FeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: ReferenceService,
  ) {}

  async accrue(tx: Tx, app: FinancingApplication) {
    const exists = await tx.merchantFee.findUnique({ where: { applicationId_kind: { applicationId: app.id, kind: 'FEE' } } });
    if (exists) return exists;
    return tx.merchantFee.create({
      data: { partnerId: app.partnerId, environment: app.environment, applicationId: app.id, kind: 'FEE', baseAmountKobo: app.purchaseAmountKobo, feeBps: app.merchantFeeBps, feeKobo: merchantFee(app.purchaseAmountKobo, app.merchantFeeBps) },
    });
  }

  async reverse(tx: Tx, applicationId: string, reason: string) {
    const fee = await tx.merchantFee.findUnique({ where: { applicationId_kind: { applicationId, kind: 'FEE' } } });
    if (!fee) return null;
    const done = await tx.merchantFee.findUnique({ where: { applicationId_kind: { applicationId, kind: 'REVERSAL' } } });
    if (done) return done;
    return tx.merchantFee.create({
      data: { partnerId: fee.partnerId, environment: fee.environment, applicationId, kind: 'REVERSAL', baseAmountKobo: fee.baseAmountKobo, feeBps: fee.feeBps, feeKobo: -fee.feeKobo, reason },
    });
  }

  async overview(partnerId: string, environment: Environment) {
    const [open, invoices, config] = await Promise.all([
      this.prisma.merchantFee.findMany({ where: { partnerId, environment, invoiceId: null }, orderBy: { accruedAt: 'desc' }, take: 500 }),
      this.prisma.merchantInvoice.findMany({ where: { partnerId, environment }, orderBy: { issuedAt: 'desc' }, take: 60 }),
      this.prisma.partnerConfiguration.findFirst({ where: { partnerId, status: 'ACTIVE' }, select: { merchantFeeBps: true } }),
    ]);
    const apps = new Map((await this.prisma.financingApplication.findMany({ where: { id: { in: open.map((f) => f.applicationId) } }, select: { id: true, reference: true } })).map((a) => [a.id, a.reference]));
    return {
      rate_percent: (config?.merchantFeeBps ?? 200) / 100,
      basis: 'Purchase amount applied for (equity included), per transaction processed (vendor payment confirmed). Invoiced monthly; never deducted from the vendor payment.',
      uninvoiced: {
        count: open.length,
        total: n(open.reduce((s, f) => s + f.feeKobo, 0n)),
        items: open.map((f) => ({ application_reference: apps.get(f.applicationId) ?? null, kind: f.kind, purchase_amount: n(f.baseAmountKobo), rate_percent: f.feeBps / 100, fee: n(f.feeKobo), reason: f.reason, accrued_at: f.accruedAt })),
      },
      invoices: invoices.map((i) => ({ id: i.id, reference: i.reference, period: i.period, fee_count: i.feeCount, total: n(i.totalKobo), status: i.status, issued_at: i.issuedAt, paid_at: i.paidAt, payment_reference: i.paymentReference })),
    };
  }

  /** Finance/Settlement view across partners: what is accrued and what is owed. */
  async portfolio(environment: Environment) {
    const partners = await this.prisma.partner.findMany({ where: { status: { notIn: ['DRAFT', 'REJECTED'] } }, select: { id: true, tradingName: true, partnerCode: true }, orderBy: { tradingName: 'asc' } });
    const open = await this.prisma.merchantFee.groupBy({ by: ['partnerId'], where: { environment, invoiceId: null }, _sum: { feeKobo: true }, _count: true });
    const due = await this.prisma.merchantInvoice.groupBy({ by: ['partnerId'], where: { environment, status: 'ISSUED' }, _sum: { totalKobo: true }, _count: true });
    return partners.map((p) => {
      const o = open.find((x) => x.partnerId === p.id);
      const d = due.find((x) => x.partnerId === p.id);
      return { partner_id: p.id, name: p.tradingName, code: p.partnerCode, uninvoiced_total: n(o?._sum.feeKobo ?? 0n), uninvoiced_count: o?._count ?? 0, outstanding_total: n(d?._sum.totalKobo ?? 0n), outstanding_invoices: d?._count ?? 0 };
    });
  }

  /** Finance issues the month's invoice: every fee (and credit) not yet invoiced, accrued by the end of that month. */
  async issueInvoice(partnerId: string, environment: Environment, body: unknown, actor: Actor) {
    const { period } = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict().parse(body);
    const [y, m] = period.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 1));
    if (end.getTime() - 31 * 86_400_000 > Date.now()) fail('VALIDATION_FAILED', { fields: [{ path: 'period', message: 'Cannot invoice a future month' }] });
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.merchantInvoice.findUnique({ where: { partnerId_environment_period: { partnerId, environment, period } } });
      if (exists) throw new AppError('CONFLICT', { invoice: exists.reference }, 'An invoice already exists for this month.');
      const fees = await tx.merchantFee.findMany({ where: { partnerId, environment, invoiceId: null, accruedAt: { lt: end } } });
      if (!fees.length) fail('VALIDATION_FAILED', { fields: [{ path: 'period', message: 'No uninvoiced fees for this period' }] });
      const total = fees.reduce((s, f) => s + f.feeKobo, 0n);
      const reference = await this.refs.next('FIV', { tx });
      const invoice = await tx.merchantInvoice.create({ data: { reference, partnerId, environment, period, feeCount: fees.length, totalKobo: total, issuedById: actor.id! } });
      await tx.merchantFee.updateMany({ where: { id: { in: fees.map((f) => f.id) } }, data: { invoiceId: invoice.id } });
      await this.audit.record(actor, { action: 'fee.invoice_issued', resourceType: 'MERCHANT_INVOICE', resourceId: invoice.id, partnerId, after: { reference, period, fees: fees.length, total_kobo: total.toString() } }, tx);
      return { id: invoice.id, reference, period, fee_count: fees.length, total: n(total), status: invoice.status };
    });
  }

  async markPaid(invoiceId: string, body: unknown, actor: Actor) {
    const { payment_reference } = z.object({ payment_reference: z.string().trim().min(4).max(64) }).strict().parse(body);
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.merchantInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv) throw new AppError('NOT_FOUND');
      if (inv.status !== 'ISSUED') throw new AppError('INVALID_STATE');
      if (inv.issuedById === actor.id) throw new AppError('MAKER_CHECKER_VIOLATION'); // whoever issued cannot also record payment
      const updated = await tx.merchantInvoice.update({ where: { id: inv.id }, data: { status: 'PAID', paidAt: new Date(), paymentReference: payment_reference, recordedPaidById: actor.id } });
      await this.audit.record(actor, { action: 'fee.invoice_paid', resourceType: 'MERCHANT_INVOICE', resourceId: inv.id, partnerId: inv.partnerId, after: { payment_reference } }, tx);
      return { id: updated.id, reference: updated.reference, status: updated.status };
    });
  }
}
