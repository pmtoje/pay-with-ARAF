import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { AuditService } from '../common/core.services';
import { Ctx, Staff, type AuthedRequest } from '../auth/auth.guard';
import { ApprovalsService } from '../approvals/approvals.service';
import { PartnersService } from '../partners/partners.service';
import { ReviewsService } from '../credit/reviews.service';
import { ArafService } from '../araf/araf.service';
import { OperationsService } from '../operations/operations.service';
import { ReportsService, parseRange } from '../reports/reports.service';
import { AdminService } from './admin.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ArafReportingService } from '../araf/araf-reporting.service';

const reason = z.object({ reason: z.string().min(3).max(1000) }).strict();
const comment = z.object({ comment: z.string().min(3).max(1000) }).strict();

@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly approvals: ApprovalsService,
    private readonly partners: PartnersService,
    private readonly reviews: ReviewsService,
    private readonly araf: ArafService,
    private readonly ops: OperationsService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
    private readonly arafReports: ArafReportingService,
  ) {}

  // ---- Dashboards & reports -----------------------------------------------------------

  @Get('overview')
  @Staff('report.read')
  overview(@Query() q: Record<string, string>) {
    return this.reports.executiveOverview(parseRange(q));
  }

  @Get('reports/funnel')
  @Staff('report.read')
  funnel(@Query() q: Record<string, string>) {
    return this.reports.funnel(parseRange(q), q.partner_id || undefined);
  }

  @Get('reports/credit')
  @Staff('report.read', 'application.read.sensitive')
  creditReport(@Query() q: Record<string, string>) {
    return this.reports.creditReport(parseRange(q));
  }

  @Get('reports/operations')
  @Staff('report.read')
  operationsReport() {
    return this.reports.operations();
  }

  @Get('reports/portfolio')
  @Staff('report.read')
  portfolio() {
    return this.reports.portfolio();
  }

  @Get('reports/applications.csv')
  @Staff('report.export')
  async exportCsv(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest, @Res() res: Response) {
    const csv = await this.reports.exportApplicationsCsv(parseRange(q), q.partner_id || undefined);
    await this.audit.record(req.actor, { action: 'report.exported', resourceType: 'REPORT', resourceId: 'applications.csv', after: q });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="araf-applications.csv"');
    res.send(csv);
  }

  // ---- Partners ------------------------------------------------------------------------

  @Get('partners')
  @Staff('partner.read')
  listPartners(@Query() q: Record<string, string>) {
    return this.partners.list(q);
  }

  @Post('partners')
  @Staff('partner.create')
  createPartner(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.create(body, req.actor);
  }

  @Get('partners/:id')
  @Staff('partner.read')
  partner(@Param('id') id: string) {
    return this.partners.detail(id);
  }

  @Post('partners/:id')
  @HttpCode(200)
  @Staff('partner.create')
  updatePartner(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.update(id, body, req.actor);
  }

  @Post('partners/:id/portal-settings')
  @Staff('partner.portal.configure')
  proposePortalSettings(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.proposePortalSettings(id, body, req.actor);
  }

  @Post('partners/:id/configuration')
  @Staff('partner.create')
  proposeConfig(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.proposeConfiguration(id, body, req.actor);
  }

  @Post('partners/:id/vendors')
  @Staff('vendor.manage')
  addVendor(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.addVendor(id, body, req.actor);
  }

  @Post('partners/:id/vendors/:vendorId/settlement-accounts')
  @Staff('vendor.manage')
  addAccount(@Param('id') id: string, @Param('vendorId') vendorId: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.addSettlementAccount(id, vendorId, body, req.actor);
  }

  @Post('partners/:id/submit')
  @HttpCode(200)
  @Staff('partner.create')
  submit(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    const { comment: c } = z.object({ comment: z.string().max(1000).optional() }).strict().parse(body ?? {});
    return this.partners.submit(id, c, req.actor);
  }

  @Post('partners/:id/production-request')
  @HttpCode(200)
  @Staff('partner.production.request')
  production(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.requestProduction(id, comment.parse(body).comment, req.actor);
  }

  @Post('partners/:id/suspend')
  @HttpCode(200)
  @Staff('partner.suspend')
  suspend(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.suspend(id, reason.parse(body).reason, req.actor);
  }

  @Post('partners/:id/reactivation-request')
  @HttpCode(200)
  @Staff('partner.suspend')
  reactivate(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.partners.requestReactivation(id, comment.parse(body).comment, req.actor);
  }

  // ---- Approvals (maker-checker inbox) -------------------------------------------

  @Get('approvals')
  @Staff()
  listApprovals(@Query() q: Record<string, string>, @Ctx() req: AuthedRequest) {
    return this.approvals.list({ status: q.status || 'PENDING', types: q.types ? q.types.split(',') : undefined, partnerId: q.partner_id || undefined }, req.actor);
  }

  @Post('approvals/:id/decide')
  @HttpCode(200)
  @Staff()
  async decide(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    const input = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'REQUEST_INFO']), comment: z.string().min(3).max(1000) }).strict().parse(body);
    const approval = await this.approvals.list({ status: 'PENDING' }, req.actor).then((l) => l.find((a) => a.id === id));
    if (approval?.type === 'PARTNER_APPROVAL') return this.partners.decideOnboarding(id, input.decision, input.comment, req.actor);
    if (input.decision === 'REQUEST_INFO') throw new AppError('VALIDATION_FAILED');
    return this.approvals.decide(id, input.decision, input.comment, req.actor);
  }

  // ---- Applications --------------------------------------------------------------------

  @Get('applications')
  @Staff('application.read')
  applications(@Query() q: Record<string, string>) {
    return this.admin.listApplications(q);
  }

  @Get('applications/:id')
  @Staff('application.read')
  application(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.admin.applicationDetail(id, req.actor);
  }

  @Get('applications/:id/documents/:docId')
  @Staff('document.read.sensitive')
  async document(@Param('id') id: string, @Param('docId') docId: string, @Ctx() req: AuthedRequest, @Res() res: Response) {
    const { doc, data } = await this.admin.openStoredDocument(id, docId, req.actor);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="document.pdf"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(data);
  }

  @Get('applications/:id/financing-documents/:docId.pdf')
  @Staff('application.read')
  async financingDocument(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const pdf = await this.ops.documentPdf(id, docId);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  @Post('applications/:id/cancel')
  @HttpCode(200)
  @Staff('application.cancel')
  async cancel(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    const r = reason.parse(body).reason;
    const app = await this.admin.applicationDetail(id, req.actor);
    return this.ops.cancelOrder(app.partner.id, app.environment, app.order.reference, { reason: r }, req.actor);
  }

  // ---- Financing operations (CAD, settlement, finance) -------------------------------

  @Post('applications/:id/invoice/verify')
  @HttpCode(200)
  @Staff('cad.conditions.manage')
  verifyInvoice(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.ops.verifyInvoice(id, req.actor);
  }

  @Post('applications/:id/booking')
  @HttpCode(200)
  @Staff('booking.execute')
  booking(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.ops.requestBooking(id, req.actor);
  }

  @Post('applications/:id/vendor-payment')
  @Staff('payment.initiate')
  payment(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.ops.initiatePayment(id, req.actor);
  }

  @Post('payments/:id/reconcile')
  @HttpCode(200)
  @Staff('payment.reconcile')
  async reconcile(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return { status: await this.ops.reconcileInstruction(id, req.actor) };
  }

  @Post('applications/:id/possession')
  @HttpCode(200)
  @Staff('cad.conditions.manage')
  possession(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.recordPossession(id, body, req.actor);
  }

  @Post('applications/:id/release/evaluate')
  @HttpCode(200)
  @Staff('application.read')
  evaluate(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.ops.evaluateRelease(id, req.actor);
  }

  @Post('applications/:id/release/suspend')
  @HttpCode(200)
  @Staff('release.suspend')
  suspendRelease(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.suspendRelease(id, reason.parse(body).reason, req.actor);
  }

  @Post('applications/:id/release/reinstate')
  @HttpCode(200)
  @Staff('release.suspend')
  reinstateRelease(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.reinstateRelease(id, reason.parse(body).reason, req.actor);
  }

  @Post('applications/:id/araf-reports/retry')
  @HttpCode(200)
  @Staff('exception.manage')
  async retryArafReports(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    const n = await this.arafReports.retryNow(id);
    await this.audit.record(req.actor, { action: 'araf.reports_retried', resourceType: 'APPLICATION', resourceId: id, after: { requeued: n } });
    return { requeued: n };
  }

  @Post('applications/:id/refunds')
  @Staff('refund.manage')
  refund(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.startRefund(id, body, req.actor);
  }

  // ---- Credit reviews & policy ------------------------------------------------------

  @Get('reviews')
  @Staff('application.read.sensitive')
  reviewQueue(@Query() q: Record<string, string>) {
    return this.reviews.queue(q.queue, q.status);
  }

  @Get('reviews/:id')
  @Staff('application.read.sensitive')
  review(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.reviews.detail(id, req.actor);
  }

  @Post('reviews/:id/decision')
  @HttpCode(200)
  @Staff('review.perform')
  reviewDecision(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.reviews.decide(id, body, req.actor);
  }

  @Get('policies')
  @Staff('policy.read')
  policies() {
    return this.reviews.policies();
  }

  @Post('policies')
  @Staff('policy.propose')
  proposePolicy(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.reviews.proposePolicy(body, req.actor);
  }

  @Post('policies/simulate')
  @HttpCode(200)
  @Staff('policy.read')
  simulate(@Body() body: unknown) {
    return this.reviews.simulate(body);
  }

  // ---- ARAF workflow simulator (sandbox) --------------------------------------------

  @Get('araf-simulator/cases')
  @Staff('application.read')
  simCases(@Query() q: Record<string, string>) {
    return this.araf.simCases(q.stage);
  }

  @Post('araf-simulator/cases/:id/actions')
  @HttpCode(200)
  @Staff()
  simAct(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.araf.simAct(id, body, req.actor);
  }

  // ---- Operations, exceptions, reconciliation ---------------------------------------

  @Get('exceptions')
  @Staff('application.read')
  exceptions(@Query() q: Record<string, string>) {
    return this.admin.exceptions(q);
  }

  @Post('exceptions/:id/actions')
  @HttpCode(200)
  @Staff('exception.manage')
  exceptionAction(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.ops.resolveException(id, body, req.actor);
  }

  @Get('reconciliation')
  @Staff('payment.reconcile')
  reconciliation() {
    return this.admin.reconciliation();
  }

  @Post('reconciliation/run')
  @HttpCode(200)
  @Staff('payment.reconcile')
  runReconciliation(@Ctx() req: AuthedRequest) {
    return this.ops.runReconciliation(req.actor);
  }

  @Post('reconciliation/findings/:id/resolve')
  @HttpCode(200)
  @Staff('payment.reconcile')
  resolveFinding(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.admin.resolveFinding(id, reason.parse(body).reason, req.actor);
  }

  // ---- Audit, users, integrations --------------------------------------------------

  @Get('audit')
  @Staff('audit.read')
  auditSearch(@Query() q: Record<string, string>) {
    return this.admin.searchAudit(q);
  }

  @Get('audit/verify')
  @Staff('audit.read')
  verifyAudit() {
    return this.audit.verifyChain();
  }

  @Get('users')
  @Staff('user.manage')
  users() {
    return this.admin.listStaff();
  }

  @Post('users/role-requests')
  @Staff('user.manage')
  proposeRoles(@Body() body: unknown, @Ctx() req: AuthedRequest) {
    return this.admin.proposeRoles(body, req.actor);
  }

  @Post('users/:id/status')
  @HttpCode(200)
  @Staff('user.manage')
  userStatus(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    const input = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().min(3).max(500) }).strict().parse(body);
    return this.admin.setStaffStatus(id, input.status, input.reason, req.actor);
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  @Staff('user.manage')
  revokeSessions(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.admin.revokeUserSessions(id, req.actor);
  }

  @Get('integrations')
  @Staff('integration.read')
  integrations() {
    return this.admin.integrations();
  }

  @Get('integrations/health')
  @Staff('integration.read')
  integrationHealth(@Query() q: Record<string, string>) {
    return Promise.all([this.reports.integrationHealth(parseRange(q)), this.reports.webhookHealth(parseRange(q))]).then(([providers, webhooks]) => ({ providers, webhooks }));
  }

  @Get('webhooks/deliveries')
  @Staff('integration.read')
  deliveries(@Query() q: Record<string, string>) {
    return this.admin.webhookDeliveries(q);
  }

  @Post('webhooks/events/:partnerId/:eventId/retry')
  @HttpCode(202)
  @Staff('webhook.manage.bank')
  async retryEvent(@Param('partnerId') partnerId: string, @Param('eventId') eventId: string, @Ctx() req: AuthedRequest) {
    const n = await this.webhooks.retryEvent(partnerId, this.reports.environment(), eventId);
    await this.audit.record(req.actor, { action: 'webhook.retry_by_bank', resourceType: 'WEBHOOK_EVENT', resourceId: eventId, partnerId });
    return { queued: n };
  }

  @Get('notifications')
  @Staff()
  notifications() {
    return this.admin.bankNotifications();
  }

  // ---- Sandbox controls ----------------------------------------------------------------

  @Get('sandbox/scenarios')
  @Staff()
  scenarios() {
    return this.admin.sandboxScenarios();
  }

  @Post('sandbox/applications/:id/forced-outcomes')
  @HttpCode(200)
  @Staff('exception.manage')
  forced(@Param('id') id: string, @Body() body: unknown, @Ctx() req: AuthedRequest) {
    const { outcomes } = z.object({ outcomes: z.array(z.enum(['MANDATE_FAILURE', 'BOOKING_FAILURE', 'PAYMENT_FAILURE', 'PAYMENT_UNKNOWN', 'ANALYSIS_FAILURE', 'ARAF_REPORTING_FAILURE'])) }).strict().parse(body);
    return this.admin.setForcedOutcomes(id, outcomes, req.actor);
  }

  @Post('sandbox/applications/:id/reverse-payment')
  @HttpCode(200)
  @Staff('payment.reconcile')
  reverse(@Param('id') id: string, @Ctx() req: AuthedRequest) {
    return this.admin.simulateReversal(id, req.actor);
  }
}
