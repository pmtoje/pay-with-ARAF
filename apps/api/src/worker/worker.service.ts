import { BackupCardService } from '../operations/backup-card.service';
import { Injectable, Logger } from '@nestjs/common';
import type { ApplicationState } from '@araf/business-rules';
import { deriveMerchantStatus } from '@araf/business-rules';
import { PrismaService } from '../common/prisma.service';
import { SYSTEM_ACTOR } from '../common/core.services';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService, type NotificationRequest } from '../notifications/notifications.service';
import { ArafService } from '../araf/araf.service';
import { StatementsService } from '../customer/statements.service';
import { OperationsService } from '../operations/operations.service';
import { CheckoutService } from '../checkout/checkout.service';
import { ArafReportingService } from '../araf/araf-reporting.service';

/**
 * Durable background processing. The transactional outbox is the source of truth; handlers
 * are idempotent; rows are claimed with SELECT … FOR UPDATE SKIP LOCKED so several worker
 * replicas can run concurrently.
 */
@Injectable()
export class WorkerService {
  private readonly logger = new Logger('Worker');
  private running = false;
  private ticks = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    private readonly araf: ArafService,
    private readonly statements: StatementsService,
    private readonly ops: OperationsService,
    private readonly checkout: CheckoutService,
    private readonly arafReports: ArafReportingService,
    private readonly cards: BackupCardService,
  ) {}

  async processOutbox(batch = 50): Promise<number> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM outbox_events WHERE "processedAt" IS NULL AND "availableAt" <= now() ORDER BY "createdAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED`,
      );
      if (!rows.length) return [];
      // Lease the rows for 60s; a crashed worker's rows become available again afterwards.
      await tx.outboxEvent.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { availableAt: new Date(Date.now() + 60_000), attempts: { increment: 1 } } });
      return tx.outboxEvent.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
    });
    for (const ev of claimed) {
      try {
        await this.handle(ev.type, ev.payload as Record<string, unknown>);
        await this.prisma.outboxEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), lastError: null } });
      } catch (e) {
        const backoff = Math.min(15 * 60_000, 2_000 * 2 ** ev.attempts);
        await this.prisma.outboxEvent.update({ where: { id: ev.id }, data: { lastError: (e as Error).message.slice(0, 500), availableAt: new Date(Date.now() + backoff) } });
        this.logger.warn(`outbox ${ev.type} failed (attempt ${ev.attempts}): ${(e as Error).message}`);
      }
    }
    return claimed.length;
  }

  private async handle(type: string, payload: Record<string, unknown>) {
    switch (type) {
      case 'araf.submit':
        return this.araf.submit(String(payload.applicationId));
      case 'notification.send':
        return this.notifications.deliver(payload as unknown as NotificationRequest);
      case 'application.state_changed': {
        const app = await this.prisma.financingApplication.findUnique({ where: { id: String(payload.applicationId) } });
        if (!app) return;
        const from = deriveMerchantStatus(String(payload.from) as ApplicationState);
        const to = deriveMerchantStatus(String(payload.to) as ApplicationState);
        if (from !== to) {
          await this.notifications.deliver({ environment: app.environment, audience: 'PARTNER', channel: 'IN_APP', templateCode: 'PARTNER_STATUS_CHANGE', destination: app.partnerId, partnerId: app.partnerId, applicationId: app.id, applicationReference: app.reference, vars: { reference: app.reference, status: to.replace(/_/g, ' ').toLowerCase() } });
        }
        return;
      }
      default:
        this.logger.warn(`no handler for outbox event ${type}`);
    }
  }

  /** One scheduling pass. Exposed for tests and the sandbox demo runner. */
  async tick(): Promise<Record<string, number>> {
    this.ticks++;
    const r: Record<string, number> = {};
    r.outbox = await this.processOutbox();
    r.webhooks = await this.webhooks.deliverDue();
    r.analysis = await this.statements.pollDueJobs();
    r.payments = await this.ops.pollPayments();
    r.mandates = await this.ops.pollMandates();
    r.cards = await this.cards.pollPending();
    r.refunds = await this.ops.pollRefunds();
    r.araf = await this.araf.retryDueSubmissions();
    r.arafReports = await this.arafReports.deliverDue();
    if (this.ticks % 30 === 0) r.expired = await this.checkout.expireStaleSessions();
    if (this.ticks % 900 === 0) await this.ops.runReconciliation({ ...SYSTEM_ACTOR, label: 'Scheduled reconciliation' });
    return r;
  }

  async run(intervalMs = 2000) {
    this.running = true;
    this.logger.log('worker started');
    while (this.running) {
      try {
        await this.tick();
      } catch (e) {
        this.logger.error(`tick failed: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  stop() {
    this.running = false;
  }
}
