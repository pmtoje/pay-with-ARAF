import { Inject, Injectable, Logger, type OnModuleInit, forwardRef } from '@nestjs/common';
import { z } from 'zod';
import { ProviderError } from '@araf/integrations';
import { randomBase62, sha256Hex } from '@araf/security';
import type { FinancingApplication } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService, SYSTEM_ACTOR, type Actor } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { OperationsService } from './operations.service';

/**
 * Backup repayment card (any Nigerian bank, saved through Paystack).
 *
 * Every customer still repays from their Alternative Bank account. The card is charged only when that account is
 * not funded on a due date. Linking: a small card check (refunded immediately) saves a reusable card authorization,
 * verified with the provider — never from the redirect. Charging: one officer proposes, a second approves
 * (maker-checker), then the card is charged once under a fixed reference; an unknown outcome is reconciled by that
 * reference, never charged again blindly.
 */
@Injectable()
export class BackupCardService implements OnModuleInit {
  private readonly logger = new Logger('BackupCard');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
    private readonly approvals: ApprovalsService,
    @Inject(forwardRef(() => OperationsService)) private readonly ops: OperationsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.approvals.register('BACKUP_CARD_CHARGE', {
      onApprove: async (tx, req, checker) => {
        const charge = await tx.cardCharge.findUniqueOrThrow({ where: { id: req.resourceId } });
        if (charge.requestedById === checker.id) throw new AppError('MAKER_CHECKER_VIOLATION');
        if (charge.status !== 'REQUESTED' || charge.approvalId) throw new AppError('INVALID_STATE');
        await tx.cardCharge.update({ where: { id: charge.id }, data: { approvalId: req.id, approvedById: checker.id } });
      },
      onReject: async (tx, req) => {
        await tx.cardCharge.update({ where: { id: req.resourceId }, data: { status: 'FAILED', gatewayResponse: `Not approved: ${req.checkerComment ?? ''}`.slice(0, 200), completedAt: new Date() } });
      },
      afterApprove: async (req) => {
        await this.executeCharge(req.resourceId).catch((e) => this.logger.error(`card charge ${req.resourceId}: ${(e as Error).message}`));
      },
    });
  }

  private callCtx(app: FinancingApplication, correlationId = `card-${Date.now()}`) {
    return { correlationId, applicationReference: app.reference, applicationId: app.id };
  }

  /** The email the provider needs for the card owner: the one the merchant supplied, else the customer record. */
  private async emailFor(app: FinancingApplication): Promise<string> {
    const order = await this.prisma.merchantOrder.findUnique({ where: { id: app.orderId }, select: { customerEmail: true } });
    const customer = app.customerId ? await this.prisma.customer.findUnique({ where: { id: app.customerId }, select: { email: true } }) : null;
    const email = order?.customerEmail?.trim() || customer?.email?.trim();
    if (!email) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'email', message: 'An email address is needed to add a card' }] });
    return email;
  }

  async activeCard(applicationId: string) {
    return this.prisma.repaymentCard.findFirst({ where: { applicationId, status: 'ACTIVE' } });
  }

  async charges(applicationId: string) {
    return this.prisma.cardCharge.findMany({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
  }

  // ---- Customer: link a card ----------------------------------------------------------

  async start(applicationId: string) {
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    // Added while repayments are being set up (or later, to replace an expired card).
    if (!['MANDATE_PENDING', 'BOOKING_PENDING', 'FINANCING_BOOKED', 'VENDOR_PAYMENT_PENDING', 'VENDOR_PAYMENT_CONFIRMED', 'SALE_CONTRACT_PENDING', 'RELEASE_AUTHORIZED', 'COMPLETED'].includes(app.status)) throw new AppError('INVALID_STATE');
    const email = await this.emailFor(app);
    const reference = `card-${app.reference}-${randomBase62(10)}`.toLowerCase();
    const amount = BigInt(this.config.CARD_CHECK_AMOUNT_KOBO);
    const c = this.callCtx(app);
    const res = await this.providers.call(app.environment, 'PAYSTACK', 'card_link_start', c, () =>
      this.providers.for(app.environment).cards.startCardLink(
        { reference, email, amountKobo: amount, callbackUrl: `${this.config.CHECKOUT_BASE_URL}/c/${app.checkoutSessionId}/card/return?reference=${encodeURIComponent(reference)}`, metadata: { source: 'pay-with-araf', application_reference: app.reference, purpose: 'backup_repayment_card' } },
        c,
      ),
    );
    await this.prisma.repaymentCard.create({ data: { applicationId, customerId: app.customerId!, provider: 'PAYSTACK', linkReference: reference, status: 'PENDING', checkAmountKobo: amount } });
    return { authorization_url: res.authorizationUrl, reference };
  }

  /** Verify a card-link payment with the provider and save the card. Idempotent. */
  async verify(applicationId: string, reference: string | undefined, actor: Actor = SYSTEM_ACTOR) {
    const card = reference
      ? await this.prisma.repaymentCard.findFirst({ where: { applicationId, linkReference: reference } })
      : await this.prisma.repaymentCard.findFirst({ where: { applicationId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (!card || card.status !== 'PENDING') return card?.status ?? 'NONE';
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: applicationId } });
    const c = this.callCtx(app);
    const res = await this.providers.call(app.environment, 'PAYSTACK', 'card_link_verify', c, () => this.providers.for(app.environment).cards.verify(card.linkReference, c));
    if (res.status === 'pending' || res.status === 'not_found') return 'PENDING';
    const usable = res.status === 'success' && res.card && res.card.reusable && res.card.channel === 'card' && res.amountKobo === card.checkAmountKobo;
    const failureCode = res.status !== 'success' ? 'CARD_CHECK_FAILED' : !res.card?.reusable || res.card?.channel !== 'card' ? 'CARD_NOT_REUSABLE' : res.amountKobo !== card.checkAmountKobo ? 'AMOUNT_MISMATCH' : null;
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.repaymentCard.findUniqueOrThrow({ where: { id: card.id } });
      if (locked.status !== 'PENDING') return;
      if (!usable) {
        await tx.repaymentCard.update({ where: { id: card.id }, data: { status: 'FAILED', failureCode, checkTransactionId: res.transactionId } });
        await this.audit.record(actor, { action: 'repayment_card.failed', resourceType: 'APPLICATION', resourceId: applicationId, reason: failureCode ?? undefined }, tx);
        return;
      }
      const sc = res.card!;
      // A newer card replaces the previous one.
      await tx.repaymentCard.updateMany({ where: { applicationId, status: 'ACTIVE' }, data: { status: 'REPLACED' } });
      await tx.repaymentCard.update({
        where: { id: card.id },
        data: {
          status: 'ACTIVE',
          authorizationEncrypted: this.crypto.encrypt(sc.authorizationCode, `card:${card.id}`),
          signatureHash: sc.signature ? sha256Hex(`card-signature:${sc.signature}`) : null,
          last4: sc.last4,
          expMonth: sc.expMonth,
          expYear: sc.expYear,
          cardType: sc.cardType,
          bank: sc.bank,
          checkTransactionId: res.transactionId,
          verifiedAt: new Date(),
        },
      });
      await this.audit.record(actor, { action: 'repayment_card.linked', resourceType: 'APPLICATION', resourceId: applicationId, after: { last4: sc.last4, bank: sc.bank } }, tx);
      await this.ops.completeRepaymentSetupIfReady(tx, applicationId, actor);
    });
    // The card check is refunded straight away.
    if (usable && res.transactionId) {
      const refund = await this.providers.for(app.environment).cards.refund(res.transactionId, card.checkAmountKobo, c).catch(() => ({ status: 'failed' as const }));
      await this.prisma.repaymentCard.update({ where: { id: card.id }, data: { refundStatus: refund.status } });
    }
    return usable ? 'ACTIVE' : 'FAILED';
  }

  /** Worker: finish card links the customer completed but never returned from. */
  async pollPending(): Promise<number> {
    const due = await this.prisma.repaymentCard.findMany({ where: { status: 'PENDING', createdAt: { gt: new Date(Date.now() - 24 * 3600_000), lt: new Date(Date.now() - 60_000) } }, take: 20 });
    for (const c of due) await this.verify(c.applicationId, c.linkReference).catch((e) => this.logger.error(`card ${c.id}: ${(e as Error).message}`));
    const unknown = await this.prisma.cardCharge.findMany({ where: { status: { in: ['UNKNOWN'] } }, take: 20 });
    for (const ch of unknown) await this.reconcileCharge(ch.id).catch((e) => this.logger.error(`charge ${ch.id}: ${(e as Error).message}`));
    return due.length + unknown.length;
  }

  // ---- Bank: charge the backup card (maker-checker) -----------------------------------

  async proposeCharge(applicationId: string, body: unknown, maker: Actor) {
    const input = z.object({ amount_naira: z.number().positive().max(1_000_000_000), reason: z.string().trim().min(5).max(300) }).strict().parse(body);
    const amount = BigInt(Math.round(input.amount_naira * 100));
    return this.prisma.$transaction(async (tx) => {
      const app = await this.ctx.lockApplication(tx, applicationId);
      const card = await tx.repaymentCard.findFirst({ where: { applicationId, status: 'ACTIVE' } });
      if (!card) throw new AppError('INVALID_STATE', undefined, 'No active backup card for this application.');
      const offer = await tx.financingOffer.findFirst({ where: { applicationId, status: 'ACCEPTED' } });
      if (!offer) throw new AppError('INVALID_STATE');
      // Never more than what is still owed on the deferred sale price through this card.
      const charged = await tx.cardCharge.aggregate({ where: { applicationId, status: { in: ['SUCCESS', 'REQUESTED', 'UNKNOWN'] } }, _sum: { amountKobo: true } });
      const ceiling = offer.deferredSalePriceKobo - (charged._sum.amountKobo ?? 0n);
      if (amount > ceiling) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'amount_naira', message: `At most ₦${(Number(ceiling) / 100).toLocaleString('en-NG')} can be charged to this card` }] });
      const charge = await tx.cardCharge.create({ data: { applicationId, cardId: card.id, reference: `bcc-${app.reference}-${randomBase62(10)}`.toLowerCase(), amountKobo: amount, reason: input.reason, status: 'REQUESTED', requestedById: maker.id } });
      const approval = await this.approvals.create(
        tx,
        { type: 'BACKUP_CARD_CHARGE', resourceType: 'CARD_CHARGE', resourceId: charge.id, partnerId: app.partnerId, payload: { application: app.reference, amount_kobo: amount.toString(), card: `${card.cardType ?? 'card'} •••• ${card.last4}` }, summary: `Charge backup card •••• ${card.last4} ₦${(Number(amount) / 100).toLocaleString('en-NG')} for ${app.reference}`, comment: input.reason },
        maker,
      );
      await this.audit.record(maker, { action: 'repayment_card.charge_proposed', resourceType: 'CARD_CHARGE', resourceId: charge.id, partnerId: app.partnerId, after: { amount_kobo: amount.toString() } }, tx);
      return { charge_id: charge.id, approval: approval.reference };
    });
  }

  /** Charge once under the fixed reference. A timeout leaves it UNKNOWN for reconciliation — never a second charge. */
  async executeCharge(chargeId: string) {
    const charge = await this.prisma.cardCharge.findUniqueOrThrow({ where: { id: chargeId } });
    if (charge.status !== 'REQUESTED' || !charge.approvalId) return charge.status;
    const card = await this.prisma.repaymentCard.findUniqueOrThrow({ where: { id: charge.cardId } });
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: charge.applicationId } });
    const c = this.callCtx(app, `card-charge-${charge.id}`);
    // Mark as in flight first: if we crash mid-call the record is reconciled, not re-sent.
    await this.prisma.cardCharge.update({ where: { id: charge.id }, data: { status: 'UNKNOWN' } });
    try {
      const res = await this.providers.call(app.environment, 'PAYSTACK', 'card_charge', c, async () =>
        this.providers.for(app.environment).cards.charge({ authorizationCode: this.crypto.decrypt(card.authorizationEncrypted!, `card:${card.id}`), email: await this.emailFor(app), amountKobo: charge.amountKobo, reference: charge.reference }, c),
      );
      if (res.status === 'pending') return 'UNKNOWN';
      return this.settle(charge.id, res.status === 'success' ? 'SUCCESS' : 'FAILED', res.transactionId, res.gatewayResponse);
    } catch (e) {
      if (e instanceof ProviderError && (e.code === 'TIMEOUT' || e.code === 'UNAVAILABLE')) return 'UNKNOWN';
      return this.settle(charge.id, 'FAILED', null, e instanceof ProviderError ? e.code : 'ERROR');
    }
  }

  async reconcileCharge(chargeId: string) {
    const charge = await this.prisma.cardCharge.findUniqueOrThrow({ where: { id: chargeId } });
    if (charge.status !== 'UNKNOWN') return charge.status;
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: charge.applicationId } });
    const c = this.callCtx(app);
    const res = await this.providers.call(app.environment, 'PAYSTACK', 'card_charge_verify', c, () => this.providers.for(app.environment).cards.verify(charge.reference, c));
    if (res.status === 'pending') return 'UNKNOWN';
    // The provider never received it: safe to mark failed (a new, approved charge can be raised).
    if (res.status === 'not_found') return this.settle(charge.id, 'FAILED', null, 'NOT_RECEIVED_BY_PROVIDER');
    if (res.status === 'success' && res.amountKobo !== charge.amountKobo) throw new AppError('INVALID_STATE', undefined, 'Charged amount does not match; resolve manually.');
    return this.settle(charge.id, res.status === 'success' ? 'SUCCESS' : 'FAILED', res.transactionId, res.gatewayResponse);
  }

  private async settle(chargeId: string, status: 'SUCCESS' | 'FAILED', txnId: string | null, gatewayResponse: string | null) {
    await this.prisma.$transaction(async (tx: Tx) => {
      const ch = await tx.cardCharge.update({ where: { id: chargeId }, data: { status, providerTxnId: txnId, gatewayResponse: gatewayResponse?.slice(0, 200) ?? null, completedAt: new Date() } });
      await this.audit.record(SYSTEM_ACTOR, { action: status === 'SUCCESS' ? 'repayment_card.charged' : 'repayment_card.charge_failed', resourceType: 'CARD_CHARGE', resourceId: ch.id, after: { amount_kobo: ch.amountKobo.toString(), provider_txn: txnId } }, tx);
    });
    return status;
  }

  /** Masked card details for the customer and staff — never the authorization. */
  present(card: { status: string; last4: string | null; cardType: string | null; bank: string | null; expMonth: string | null; expYear: string | null; failureCode: string | null } | null) {
    return card ? { status: card.status, last4: card.last4, card_type: card.cardType, bank: card.bank, expires: card.expMonth && card.expYear ? `${card.expMonth}/${card.expYear.slice(-2)}` : null, failure: card.failureCode } : null;
  }
}
