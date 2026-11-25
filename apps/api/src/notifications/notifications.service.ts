import { Injectable, Logger } from '@nestjs/common';
import { maskEmail, maskPhone } from '@araf/security';
import type { Environment } from '@araf/database';
import { PrismaService, type Tx } from '../common/prisma.service';
import { OutboxService } from '../common/core.services';
import { ProvidersService } from '../common/providers.service';

export interface NotificationRequest {
  environment: Environment;
  audience: 'CUSTOMER' | 'PARTNER' | 'BANK';
  templateCode: string;
  channel: 'EMAIL' | 'SMS' | 'IN_APP';
  /** Destination: email/phone for customers, partnerId for partners, permission/queue for bank. */
  destination: string;
  partnerId?: string | null;
  applicationId?: string | null;
  applicationReference?: string | null;
  vars: Record<string, string>;
}

/**
 * Notifications are enqueued in the transactional outbox and delivered by the worker.
 * Templates never contain BVNs, statements or credit details.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly providers: ProvidersService,
  ) {}

  async enqueue(tx: Tx, req: NotificationRequest) {
    await this.outbox.add(tx, { aggregateType: 'NOTIFICATION', aggregateId: req.applicationId ?? req.partnerId ?? 'bank', type: 'notification.send', payload: req as unknown as Record<string, unknown> });
  }

  private render(text: string, vars: Record<string, string>) {
    return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? '');
  }

  async deliver(req: NotificationRequest): Promise<void> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { code: req.templateCode, active: true },
      orderBy: { version: 'desc' },
    });
    if (!template) {
      this.logger.warn(`missing template ${req.templateCode}`);
      return;
    }
    const subject = this.render(template.subject, req.vars);
    const body = this.render(template.body, req.vars);
    const recipientRef =
      req.audience === 'CUSTOMER' ? (req.channel === 'SMS' ? maskPhone(req.destination) : maskEmail(req.destination)) : req.destination;
    let status = 'SENT';
    let providerRef: string | undefined;
    if (req.channel !== 'IN_APP') {
      try {
        const res = await this.providers.for(req.environment).notifications.send(
          { channel: req.channel, destination: req.destination, subject, body, applicationReference: req.applicationReference ?? undefined },
          { correlationId: `notif-${Date.now()}`, applicationReference: req.applicationReference ?? undefined },
        );
        providerRef = res.providerRef;
      } catch (e) {
        status = 'FAILED';
        this.logger.warn(`notification failed: ${(e as Error).message}`);
      }
    }
    await this.prisma.notification.create({
      data: {
        environment: req.environment,
        audience: req.audience,
        recipientRef,
        partnerId: req.partnerId ?? null,
        applicationId: req.applicationId ?? null,
        channel: req.channel,
        templateCode: req.templateCode,
        subject,
        // OTP codes are never persisted in notification history.
        body: req.templateCode === 'IDENTITY_OTP' ? 'Verification code sent.' : body,
        status,
        providerRef,
        sentAt: status === 'SENT' ? new Date() : null,
      },
    });
  }
}
