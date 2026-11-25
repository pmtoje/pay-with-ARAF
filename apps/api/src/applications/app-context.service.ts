import { Inject, Injectable } from '@nestjs/common';
import { parsePolicyRules, type CreditPolicyRules } from '@araf/business-rules';
import { ERRORS, type ErrorCode } from '@araf/types';
import type { FinancingApplication } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, ReferenceService, toJsonRaw, type Actor } from '../common/core.services';

export interface ExceptionInput {
  code: string;
  category: 'ACCOUNT_OPENING' | 'STATEMENT' | 'ANALYSIS' | 'ARAF_SUBMISSION' | 'BOOKING' | 'MANDATE' | 'VENDOR_PAYMENT' | 'RECONCILIATION' | 'DELIVERY' | 'WEBHOOK' | 'REFUND' | 'CREDIT';
  application?: Pick<FinancingApplication, 'id' | 'partnerId' | 'environment'> | null;
  partnerId?: string | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  responsibleTeam: 'OPERATIONS' | 'CAD' | 'SETTLEMENT' | 'TECHNOLOGY' | 'CREDIT' | 'CUSTOMER_EXPERIENCE';
  retryEligible: boolean;
  detail: string;
  customerMessage?: string;
}

/** Shared application helpers used across journey, operations and ARAF modules. */
@Injectable()
export class AppContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refs: ReferenceService,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  get environment() {
    return this.config.PLATFORM_ENVIRONMENT;
  }

  async policyFor(policyVersionId: string, tx?: Tx): Promise<CreditPolicyRules> {
    const v = await (tx ?? this.prisma).creditPolicyVersion.findUniqueOrThrow({ where: { id: policyVersionId } });
    return parsePolicyRules(v.rules);
  }

  async activePolicyVersion(tx?: Tx) {
    const v = await (tx ?? this.prisma).creditPolicyVersion.findFirst({ where: { status: 'ACTIVE' }, orderBy: { version: 'desc' } });
    if (!v) throw new AppError('INTERNAL_ERROR');
    return v;
  }

  async partnerConfig(partnerId: string, tx?: Tx) {
    const c = await (tx ?? this.prisma).partnerConfiguration.findFirst({ where: { partnerId, status: 'ACTIVE' } });
    if (!c) throw new AppError('PARTNER_NOT_ACTIVE');
    return c;
  }

  /** Lock the application row for the rest of the transaction (serialises concurrent actions). */
  async lockApplication(tx: Tx, id: string): Promise<FinancingApplication> {
    await tx.$queryRawUnsafe('SELECT id FROM financing_applications WHERE id = $1 FOR UPDATE', id);
    const app = await tx.financingApplication.findUnique({ where: { id } });
    if (!app) throw new AppError('NOT_FOUND');
    return app;
  }

  async raiseException(tx: Tx, input: ExceptionInput, actor: Actor) {
    const open = input.application
      ? await tx.operationalException.findFirst({ where: { applicationId: input.application.id, code: input.code, status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } })
      : null;
    if (open) return open;
    const reference = await this.refs.next('EXC', { tx });
    const errorDef = (ERRORS as Record<string, { message: string }>)[input.code as ErrorCode];
    const exc = await tx.operationalException.create({
      data: {
        reference,
        code: input.code,
        category: input.category,
        applicationId: input.application?.id ?? null,
        partnerId: input.application?.partnerId ?? input.partnerId ?? null,
        environment: input.application?.environment ?? this.config.PLATFORM_ENVIRONMENT,
        severity: input.severity,
        responsibleTeam: input.responsibleTeam,
        retryEligible: input.retryEligible,
        customerMessage: input.customerMessage ?? errorDef?.message ?? 'We are resolving an issue with your application.',
        detail: input.detail,
        history: toJsonRaw([{ at: new Date().toISOString(), by: actor.label ?? actor.type, action: 'RAISED', note: input.detail }]),
      },
    });
    await this.audit.record(actor, { action: 'exception.raised', resourceType: 'OPERATIONAL_EXCEPTION', resourceId: exc.id, partnerId: exc.partnerId, after: { code: input.code, reference } }, tx);
    return exc;
  }

  async resolveExceptions(tx: Tx, applicationId: string, codes: string[], note: string, actor: Actor) {
    const open = await tx.operationalException.findMany({ where: { applicationId, code: { in: codes }, status: { in: ['OPEN', 'IN_PROGRESS', 'ESCALATED'] } } });
    for (const e of open) {
      const history = [...((e.history as unknown[]) ?? []), { at: new Date().toISOString(), by: actor.label ?? actor.type, action: 'RESOLVED', note }];
      await tx.operationalException.update({ where: { id: e.id }, data: { status: 'RESOLVED', resolution: note, resolvedAt: new Date(), history: toJsonRaw(history) } });
    }
  }
}
