import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ALL_WEBHOOK_EVENT_TYPES, WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@araf/types';
import type { Prisma } from '@araf/database';
import { deriveMerchantStatus, type ApplicationState } from '@araf/business-rules';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { Ctx, PartnerUser, type AuthedRequest } from '../auth/auth.guard';
import { PartnersService } from './partners.service';
import { CheckoutService } from '../checkout/checkout.service';
import { OperationsService } from '../operations/operations.service';
import { ReportsService, parseRange } from '../reports/reports.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { n } from '../applications/presenters';

/**
 * Partner (merchant) portal API. The tenant is ALWAYS taken from the authenticated session,
 * never from a request parameter. Partners never see BVNs, credit data, statements or
 * affordability calculations.
 */
@Controller('api/partner-portal')
export class PartnerPortalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partners: PartnersService,
    private readonly checkout: CheckoutService,
    private readonly ops: OperationsService,
    private readonly reports: ReportsService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
    private readonly providers: ProvidersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private pid(req: AuthedRequest) {
    return req.portal!.partnerId!;
  }

  @Get('overview')
  @PartnerUser('p.dashboard.read')
  overview(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest) {
    return this.reports.partnerOverview(this.pid(req), parseRange(q));
  }

  @Get('applications')
  @PartnerUser('p.application.read')
  async applications(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest) {
    const page = Math.max(1, Number(q.page ?? 1));
    const size = Math.min(100, Math.max(5, Number(q.page_size ?? 20)));
    const range = parseRange(q);
    const where: Prisma.FinancingApplicationWhereInput = { partnerId: this.pid(req), environment: this.config.PLATFORM_ENVIRONMENT, createdAt: { gte: range.from, lte: range.to } };
    if (q.search) where.OR = [{ reference: { contains: q.search, mode: 'insensitive' } }];
    let rows = await this.prisma.financingApplication.findMany({ where, orderBy: { createdAt: q.sort === 'asc' ? 'asc' : 'desc' } });
    const orders = new Map((await this.prisma.merchantOrder.findMany({ where: { id: { in: rows.map((r) => r.orderId) } } })).map((o) => [o.id, o]));
    if (q.search) {
      const s = q.search.toLowerCase();
      const byOrder = await this.prisma.merchantOrder.findMany({ where: { partnerId: this.pid(req), merchantOrderReference: { contains: q.search, mode: 'insensitive' } } });
      const extra = await this.prisma.financingApplication.findMany({ where: { orderId: { in: byOrder.map((o) => o.id) }, environment: this.config.PLATFORM_ENVIRONMENT } });
      for (const o of byOrder) orders.set(o.id, o);
      rows = [...rows, ...extra.filter((e) => !rows.some((r) => r.id === e.id))].filter((r) => r.reference.toLowerCase().includes(s) || orders.get(r.orderId)?.merchantOrderReference.toLowerCase().includes(s));
    }
    const mapped = rows.map((a) => ({
      reference: a.reference,
      merchant_order_reference: orders.get(a.orderId)?.merchantOrderReference,
      status: deriveMerchantStatus(a.status as ApplicationState),
      purchase_amount: n(a.purchaseAmountKobo),
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    }));
    const filtered = q.status ? mapped.filter((m) => q.status.split(',').includes(m.status)) : mapped;
    return { page, page_size: size, total: filtered.length, data: filtered.slice((page - 1) * size, page * size) };
  }

  @Get('applications/:reference')
  @PartnerUser('p.application.read')
  application(@Param('reference') reference: string, @Ctx() req: AuthedRequest) {
    return this.checkout.getApplication(this.pid(req), this.config.PLATFORM_ENVIRONMENT, reference);
  }

  @Get('applications.csv')
  @PartnerUser('p.report.export')
  async export(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest, @Res() res: Response) {
    const csv = await this.reports.exportApplicationsCsv(parseRange(q), this.pid(req), true);
    await this.audit.record(req.actor, { action: 'report.exported', resourceType: 'REPORT', resourceId: 'partner-applications.csv', partnerId: this.pid(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="applications.csv"');
    res.send(csv);
  }

  @Get('release-queue')
  @PartnerUser('p.fulfilment.manage')
  async releaseQueue(@Ctx() req: AuthedRequest) {
    const releases = await this.prisma.releaseAuthorization.findMany({ where: { partnerId: this.pid(req), environment: this.config.PLATFORM_ENVIRONMENT, status: { in: ['AUTHORIZED', 'SUSPENDED'] } }, orderBy: { authorizedAt: 'asc' } });
    const out = [];
    for (const r of releases) {
      const [app, order, payment, vendor, items, fulfilment] = await Promise.all([
        this.prisma.financingApplication.findUniqueOrThrow({ where: { id: r.applicationId } }),
        this.prisma.merchantOrder.findUniqueOrThrow({ where: { id: r.orderId } }),
        this.prisma.vendorPaymentInstruction.findUniqueOrThrow({ where: { id: r.paymentInstructionId } }),
        this.prisma.vendor.findUniqueOrThrow({ where: { id: r.vendorId } }),
        this.prisma.orderItem.findMany({ where: { orderId: r.orderId } }),
        this.prisma.fulfilmentRecord.findMany({ where: { applicationId: r.applicationId } }),
      ]);
      out.push({
        release_reference: r.reference,
        release_status: r.status,
        suspension_reason: r.suspensionReason,
        application_reference: app.reference,
        merchant_order_reference: order.merchantOrderReference,
        products: items.map((i) => `${i.quantity} × ${i.name}`),
        vendor: vendor.name,
        payment_amount: n(payment.amountKobo),
        payment_reference: payment.reference,
        payment_status: payment.status,
        customer_contact: { email: order.customerEmail, phone: order.customerPhone },
        authorized_at: r.authorizedAt,
        prepared: fulfilment.some((f) => f.status === 'PREPARED'),
        simulated: r.isSimulated,
      });
    }
    return out;
  }

  @Post('orders/:reference/fulfil')
  @HttpCode(200)
  @PartnerUser('p.fulfilment.manage')
  fulfil(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.fulfil(this.pid(req), this.config.PLATFORM_ENVIRONMENT, reference, body, req.actor);
  }

  @Post('orders/:reference/deliver')
  @HttpCode(200)
  @PartnerUser('p.fulfilment.manage')
  deliver(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.deliver(this.pid(req), this.config.PLATFORM_ENVIRONMENT, reference, body, req.actor);
  }

  @Post('orders/:reference/cancel')
  @HttpCode(200)
  @PartnerUser('p.refund.request')
  cancel(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.cancelOrder(this.pid(req), this.config.PLATFORM_ENVIRONMENT, reference, body, req.actor);
  }

  @Post('orders/:reference/return')
  @HttpCode(200)
  @PartnerUser('p.refund.request')
  returnOrder(@Param('reference') reference: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.requestReturn(this.pid(req), this.config.PLATFORM_ENVIRONMENT, reference, body, req.actor);
  }

  @Get('refunds')
  @PartnerUser('p.settlement.read')
  async refunds(@Ctx() req: AuthedRequest) {
    const apps = await this.prisma.financingApplication.findMany({ where: { partnerId: this.pid(req) }, select: { id: true, reference: true } });
    const refs = new Map(apps.map((a) => [a.id, a.reference]));
    const rows = await this.prisma.refundRecord.findMany({ where: { applicationId: { in: apps.map((a) => a.id) } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ reference: r.reference, application_reference: refs.get(r.applicationId), status: r.status, expected_amount: n(r.expectedAmountKobo), received_amount: n(r.receivedAmountKobo), simulated: r.isSimulated, created_at: r.createdAt }));
  }

  /** Sandbox only: the vendor records that it has returned funds to the Bank (simulated rail). */
  @Post('refunds/:reference/simulate-vendor-refund')
  @HttpCode(200)
  @PartnerUser('p.refund.request')
  async simulateRefund(@Param('reference') reference: string, @Ctx() req: AuthedRequest) {
    if (!this.config.sandboxToolsEnabled) throw new AppError('NOT_FOUND');
    const r = await this.prisma.refundRecord.findUnique({ where: { reference } });
    const app = r ? await this.prisma.financingApplication.findUnique({ where: { id: r.applicationId } }) : null;
    if (!r || !app || app.partnerId !== this.pid(req) || r.status !== 'VENDOR_REFUND_PENDING') throw new AppError('NOT_FOUND');
    await this.providers.sandbox.payments.recordVendorRefundSimulated(r.reference, r.expectedAmountKobo);
    await this.audit.record(req.actor, { action: 'sandbox.vendor_refund_simulated', resourceType: 'REFUND', resourceId: r.id, partnerId: app.partnerId });
    await this.ops.pollRefunds();
    return { ok: true };
  }

  @Get('settlements')
  @PartnerUser('p.settlement.read')
  settlements(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest) {
    return this.checkout.listSettlements(this.pid(req), this.config.PLATFORM_ENVIRONMENT, { status: q.status, limit: 200 });
  }

  // ---- Integration --------------------------------------------------------------------

  @Get('integration')
  @PartnerUser('p.integration.read')
  async integration(@Ctx() req: AuthedRequest) {
    const partner = await this.prisma.partner.findUniqueOrThrow({ where: { id: this.pid(req) } });
    const config = await this.prisma.partnerConfiguration.findFirst({ where: { partnerId: partner.id, status: 'ACTIVE' } });
    const domains = await this.prisma.partnerDomain.findMany({ where: { partnerId: partner.id, approved: true } });
    return {
      partner: { id: partner.id, code: partner.partnerCode, name: partner.tradingName, status: partner.status },
      environment: this.config.PLATFORM_ENVIRONMENT,
      api_base_url: `${this.config.PUBLIC_API_URL}/api/v1`,
      production_available: this.config.LIVE_OPERATIONS_ENABLED && partner.status === 'PRODUCTION_ACTIVE',
      credentials: await this.partners.listCredentials(partner.id),
      webhook_endpoints: await this.partners.listWebhookEndpoints(partner.id),
      approved_return_origins: domains.filter((d) => d.kind === 'RETURN_URL_ORIGIN').map((d) => d.value),
      configuration: config ? this.partners.presentConfig(config) : null,
      event_types: Object.entries(WEBHOOK_EVENT_TYPES).map(([type, description]) => ({ type, description })),
      health: await this.reports.webhookHealth(parseRange({ range: '7d' }), partner.id),
    };
  }

  @Post('credentials')
  @PartnerUser('p.integration.manage')
  createCredential(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.createCredential(this.pid(req), body, req.actor);
  }

  @Post('credentials/:id/revoke')
  @HttpCode(200)
  @PartnerUser('p.integration.manage')
  revoke(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.partners.revokeCredential(this.pid(req), id, req.actor);
  }

  @Post('credentials/:id/rotate')
  @HttpCode(200)
  @PartnerUser('p.integration.manage')
  rotate(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.partners.rotateCredential(this.pid(req), id, req.actor);
  }

  @Post('webhooks')
  @PartnerUser('p.integration.manage')
  createWebhook(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.createWebhookEndpoint(this.pid(req), body, req.actor);
  }

  @Post('webhooks/:id')
  @HttpCode(200)
  @PartnerUser('p.integration.manage')
  updateWebhook(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.updateWebhookEndpoint(this.pid(req), id, body, req.actor);
  }

  @Post('webhooks/:id/reveal-secret')
  @HttpCode(200)
  @PartnerUser('p.integration.manage')
  reveal(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.partners.revealWebhookSecret(this.pid(req), id, req.actor);
  }

  @Post('webhooks/:id/rotate-secret')
  @HttpCode(200)
  @PartnerUser('p.integration.manage')
  rotateSecret(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.partners.rotateWebhookSecret(this.pid(req), id, req.actor);
  }

  @Get('webhook-events')
  @PartnerUser('p.integration.read')
  events(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest) {
    return this.checkout.listWebhookEvents(this.pid(req), this.config.PLATFORM_ENVIRONMENT, { type: q.type, limit: 100 });
  }

  @Post('webhook-events/:id/retry')
  @HttpCode(202)
  @PartnerUser('p.integration.manage')
  async retry(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    const n = await this.webhooks.retryEvent(this.pid(req), this.config.PLATFORM_ENVIRONMENT, id);
    if (n < 0) throw new AppError('NOT_FOUND');
    await this.audit.record(req.actor, { action: 'webhook.retried', resourceType: 'WEBHOOK_EVENT', resourceId: id, partnerId: this.pid(req) });
    return { queued_deliveries: n };
  }

  /** Sandbox: send a clearly-flagged test event of any type to the partner's endpoints. */
  @Post('webhooks/test-event')
  @HttpCode(202)
  @PartnerUser('p.integration.manage')
  async testEvent(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    if (!this.config.isSandbox) throw new AppError('NOT_FOUND');
    const { type } = z.object({ type: z.enum(ALL_WEBHOOK_EVENT_TYPES as [WebhookEventType, ...WebhookEventType[]]) }).strict().parse(body);
    const id = await this.prisma.$transaction((tx) =>
      this.webhooks.emit(tx, {
        partnerId: this.pid(req),
        environment: 'SANDBOX',
        type,
        applicationReference: 'ARAF-TEST-000000',
        merchantOrderReference: 'TEST-ORDER',
        resourceVersion: 0,
        test: true,
        data: type === 'goods.release_authorized' ? { currency: 'NGN', vendor_payment_amount: 45000000, payment_reference: 'PAY-TEST', payment_status: 'CONFIRMED', release_authorized: true, release_reference: 'REL-TEST', note: 'TEST EVENT — do not release goods' } : { status: 'TEST' },
      }),
    );
    await this.audit.record(req.actor, { action: 'webhook.test_event_sent', resourceType: 'WEBHOOK_EVENT', resourceId: id, partnerId: this.pid(req) });
    return { event_id: id };
  }

  @Get('notifications')
  @PartnerUser('p.dashboard.read')
  notifications(@Ctx() req: AuthedRequest) {
    return this.prisma.notification.findMany({ where: { audience: 'PARTNER', partnerId: this.pid(req) }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ---- Team ------------------------------------------------------------------------------

  @Get('team')
  @PartnerUser('p.dashboard.read')
  team(@Ctx() req: AuthedRequest) {
    return this.partners.listTeam(this.pid(req));
  }

  @Post('team/invitations')
  @PartnerUser('p.team.manage')
  invite(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.inviteTeamMember(this.pid(req), body, req.actor);
  }

  @Post('team/:userId/status')
  @HttpCode(200)
  @PartnerUser('p.team.manage')
  memberStatus(@Param('userId') userId: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).strict().parse(body);
    return this.partners.setTeamMemberStatus(this.pid(req), userId, status, req.actor);
  }
}
