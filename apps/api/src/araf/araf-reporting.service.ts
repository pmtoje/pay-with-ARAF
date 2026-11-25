import { Injectable, Logger } from '@nestjs/common';
import type { ArafStatusReportType } from '@araf/integrations';
import { randomToken } from '@araf/security';
import type { FinancingApplication } from '@araf/database';
import { PrismaService, type Tx } from '../common/prisma.service';
import { SYSTEM_ACTOR, toJsonRaw } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';
import { AppContextService } from '../applications/app-context.service';

/** Partner-facing events that represent execution steps ARAF must hear about (D-013). */
export const WEBHOOK_TO_ARAF_REPORT: Partial<Record<string, ArafStatusReportType>> = {
  'financing.booked': 'BOOKING_CONFIRMED',
  'vendor.payment_pending': 'VENDOR_PAYMENT_INITIATED',
  'vendor.payment_confirmed': 'VENDOR_PAYMENT_CONFIRMED',
  'vendor.payment_failed': 'VENDOR_PAYMENT_FAILED',
  'vendor.payment_reversed': 'VENDOR_PAYMENT_REVERSED',
  'goods.release_authorized': 'RELEASE_AUTHORIZED',
  'goods.release_suspended': 'RELEASE_SUSPENDED',
  'goods.dispatched': 'GOODS_DISPATCHED',
  'goods.delivered': 'GOODS_DELIVERED',
  'refund.initiated': 'REFUND_INITIATED',
  'refund.completed': 'REFUND_COMPLETED',
  'order.cancelled': 'APPLICATION_CANCELLED',
  'application.cancelled': 'APPLICATION_CANCELLED',
};

const MAX_ATTEMPTS_BEFORE_EXCEPTION = 5;

/**
 * Outbound execution-status reporting to ARAF.
 *
 * Reports are recorded in the SAME transaction as the booking / payment / release change (so a
 * committed change is never left unreported and a rolled-back change is never reported), then
 * delivered by the worker in per-application sequence order, retried with backoff, idempotent on
 * the event id. Persistent failure raises an operational exception; it never blocks or reverses
 * the financial operation that already happened.
 */
@Injectable()
export class ArafReportingService {
  private readonly logger = new Logger('ArafReporting');

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly ctx: AppContextService,
  ) {}

  /** Record a report inside the caller's transaction. No-op before ARAF has acknowledged the case. */
  async record(tx: Tx, app: Pick<FinancingApplication, 'id' | 'reference' | 'arafReference'>, type: ArafStatusReportType, data: Record<string, unknown> = {}): Promise<string | null> {
    if (!app.arafReference) return null;
    // Serialise sequence allocation per application.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `araf-report:${app.id}`);
    const last = await tx.arafOutboundReport.findFirst({ where: { applicationId: app.id }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    const id = randomToken('pwa_evt_', 24);
    const safe: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) safe[k] = v as string | number | boolean | null;
      else if (typeof v === 'bigint') safe[k] = Number(v);
    }
    await tx.arafOutboundReport.create({
      data: { id, applicationId: app.id, arafReference: app.arafReference, type, sequence: (last?.sequence ?? 0) + 1, data: toJsonRaw(safe) },
    });
    return id;
  }

  /** Deliver due reports. Per application, a report is only sent once all earlier ones are delivered. */
  async deliverDue(batch = 25): Promise<number> {
    const due = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT r.id FROM araf_outbound_reports r
       WHERE r.status IN ('PENDING','RETRYING') AND r."nextAttemptAt" <= now()
         AND NOT EXISTS (SELECT 1 FROM araf_outbound_reports p
                         WHERE p."applicationId" = r."applicationId" AND p.sequence < r.sequence AND p.status <> 'DELIVERED')
       ORDER BY r."createdAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED`,
    );
    for (const { id } of due) await this.deliverOne(id).catch((e) => this.logger.error(`report ${id}: ${(e as Error).message}`));
    return due.length;
  }

  private async deliverOne(id: string) {
    // Claim with a short lease so a concurrent worker does not send the same report.
    const claimed = await this.prisma.arafOutboundReport.updateMany({ where: { id, status: { in: ['PENDING', 'RETRYING'] } }, data: { nextAttemptAt: new Date(Date.now() + 60_000) } });
    if (claimed.count !== 1) return;
    const r = await this.prisma.arafOutboundReport.findUniqueOrThrow({ where: { id } });
    const app = await this.prisma.financingApplication.findUniqueOrThrow({ where: { id: r.applicationId } });
    const c = { correlationId: `araf-report-${r.id}`, applicationReference: app.reference, applicationId: app.id };
    try {
      const res = await this.providers.call(app.environment, 'ARAF', 'report_status', c, () =>
        this.providers.for(app.environment).araf.reportStatus(
          {
            eventId: r.id,
            arafReference: r.arafReference,
            applicationReference: app.reference,
            type: r.type as ArafStatusReportType,
            sequence: r.sequence,
            occurredAt: r.createdAt.toISOString(),
            data: r.data as Record<string, string | number | boolean | null>,
          },
          c,
        ),
      );
      await this.prisma.arafOutboundReport.update({ where: { id }, data: { status: 'DELIVERED', attempts: { increment: 1 }, deliveredAt: new Date(), lastError: null, arafEventReference: res.arafEventReference ?? null } });
      await this.prisma.$transaction((tx) => this.ctx.resolveExceptions(tx, app.id, ['ARAF_REPORTING_DELAYED'], 'ARAF acknowledged pending status reports', SYSTEM_ACTOR));
    } catch (e) {
      const attempts = r.attempts + 1;
      const backoff = Math.min(15 * 60_000, 5_000 * 2 ** (attempts - 1));
      await this.prisma.arafOutboundReport.update({
        where: { id },
        data: { status: 'RETRYING', attempts, lastError: (e as Error).message.slice(0, 300), nextAttemptAt: new Date(Date.now() + backoff) },
      });
      if (attempts === MAX_ATTEMPTS_BEFORE_EXCEPTION) {
        await this.prisma.$transaction((tx) =>
          this.ctx.raiseException(
            tx,
            { code: 'ARAF_REPORTING_DELAYED', category: 'ARAF_SUBMISSION', application: app, severity: 'MEDIUM', responsibleTeam: 'TECHNOLOGY', retryEligible: true, detail: `ARAF has not acknowledged ${r.type} (sequence ${r.sequence}) after ${attempts} attempts: ${(e as Error).message}`.slice(0, 500), customerMessage: 'Your application is progressing normally.' },
            SYSTEM_ACTOR,
          ),
        );
      }
    }
  }

  async forApplication(applicationId: string) {
    const rows = await this.prisma.arafOutboundReport.findMany({ where: { applicationId }, orderBy: { sequence: 'asc' } });
    return rows.map((r) => ({ event_id: r.id, sequence: r.sequence, type: r.type, status: r.status, attempts: r.attempts, last_error: r.lastError, delivered_at: r.deliveredAt, created_at: r.createdAt, data: r.data }));
  }

  /** Operations: re-queue reports that are still retrying (e.g. after an ARAF outage). */
  async retryNow(applicationId: string): Promise<number> {
    const r = await this.prisma.arafOutboundReport.updateMany({ where: { applicationId, status: { in: ['RETRYING', 'FAILED'] } }, data: { status: 'RETRYING', nextAttemptAt: new Date() } });
    return r.count;
  }
}
