import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/core.services';
import { Public } from '../auth/auth.guard';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RateLimitService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('health/live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @Public()
  async ready(@Res({ passthrough: true }) res: Response) {
    const db = await this.prisma.$queryRawUnsafe('SELECT 1').then(() => true).catch(() => false);
    const redis = await this.redis.ping();
    const ok = db && redis;
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ready' : 'degraded', checks: { database: db, redis }, environment: this.config.PLATFORM_ENVIRONMENT, live_operations: this.config.LIVE_OPERATIONS_ENABLED };
  }

  /** Technical metrics only (queue depths, failures). Restrict at the ingress in shared environments. */
  @Get('metrics')
  @Public()
  async metrics(@Res() res: Response) {
    const [outbox, webhooksPending, webhooksDead, unknownPayments, openExceptions, analysisPending] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { processedAt: null } }),
      this.prisma.webhookDelivery.count({ where: { status: { in: ['PENDING', 'RETRYING'] } } }),
      this.prisma.webhookDelivery.count({ where: { status: 'DEAD_LETTERED' } }),
      this.prisma.vendorPaymentInstruction.count({ where: { status: { in: ['UNKNOWN', 'RECONCILIATION_REQUIRED'] } } }),
      this.prisma.operationalException.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } }),
      this.prisma.statementAnalysisJob.count({ where: { status: { in: ['SUBMITTED', 'PROCESSING'] } } }),
    ]);
    const lines = [
      ['araf_outbox_backlog', outbox],
      ['araf_webhook_deliveries_pending', webhooksPending],
      ['araf_webhook_deliveries_dead_lettered', webhooksDead],
      ['araf_vendor_payments_unknown', unknownPayments],
      ['araf_operational_exceptions_open', openExceptions],
      ['araf_statement_analysis_in_flight', analysisPending],
    ].map(([k, v]) => `# TYPE ${k} gauge\n${k} ${v}`);
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  }
}
