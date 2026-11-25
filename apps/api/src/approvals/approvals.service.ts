import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@araf/types';
import type { ApprovalRequest } from '@araf/database';
import { AppError } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService, ReferenceService, toJsonRaw, type Actor } from '../common/core.services';

export type ApprovalType =
  | 'PARTNER_APPROVAL'
  | 'PARTNER_CONFIG'
  | 'PARTNER_PRODUCTION'
  | 'PARTNER_REACTIVATION'
  | 'VENDOR_ACCOUNT'
  | 'CREDIT_POLICY'
  | 'REVIEW_DECISION'
  | 'VENDOR_PAYMENT'
  | 'REFUND'
  | 'ROLE_ASSIGNMENT';

export const APPROVAL_PERMISSION: Record<ApprovalType, PermissionCode> = {
  PARTNER_APPROVAL: 'partner.approve',
  PARTNER_CONFIG: 'partner.approve',
  PARTNER_PRODUCTION: 'partner.production.approve',
  PARTNER_REACTIVATION: 'partner.approve',
  VENDOR_ACCOUNT: 'vendor.approve',
  CREDIT_POLICY: 'policy.approve',
  REVIEW_DECISION: 'review.approve',
  VENDOR_PAYMENT: 'payment.approve',
  REFUND: 'refund.approve',
  ROLE_ASSIGNMENT: 'user.approve',
};

export interface ApprovalHandler {
  /** Runs inside the approval transaction when the checker approves. */
  onApprove(tx: Tx, request: ApprovalRequest, checker: Actor): Promise<void>;
  /** Runs inside the transaction when rejected. */
  onReject?(tx: Tx, request: ApprovalRequest, checker: Actor): Promise<void>;
  /** Optional work after commit (e.g. calling an external system). */
  afterApprove?(request: ApprovalRequest, checker: Actor): Promise<void>;
}

/**
 * Generic maker-checker. The checker must hold the type's approval permission and must not
 * be the maker (also enforced by a database CHECK constraint).
 */
@Injectable()
export class ApprovalsService {
  private readonly handlers = new Map<ApprovalType, ApprovalHandler>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refs: ReferenceService,
  ) {}

  register(type: ApprovalType, handler: ApprovalHandler) {
    this.handlers.set(type, handler);
  }

  async create(
    tx: Tx,
    input: { type: ApprovalType; resourceType: string; resourceId: string; partnerId?: string | null; payload: Record<string, unknown>; summary: string; comment?: string },
    maker: Actor,
  ): Promise<ApprovalRequest> {
    const pending = await tx.approvalRequest.findFirst({ where: { type: input.type, resourceId: input.resourceId, status: 'PENDING' } });
    if (pending) throw new AppError('CONFLICT', { approval: pending.reference }, 'An approval request is already pending for this item.');
    const reference = await this.refs.next('APR', { tx });
    const req = await tx.approvalRequest.create({
      data: {
        reference,
        type: input.type,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        partnerId: input.partnerId ?? null,
        payload: toJsonRaw(input.payload),
        summary: input.summary,
        makerId: maker.id!,
        makerComment: input.comment,
      },
    });
    await this.audit.record(maker, { action: 'approval.requested', resourceType: input.resourceType, resourceId: input.resourceId, partnerId: input.partnerId, after: { type: input.type, reference }, reason: input.comment }, tx);
    return req;
  }

  async decide(id: string, decision: 'APPROVE' | 'REJECT', comment: string, checker: Actor) {
    if (!comment || comment.trim().length < 3) throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'comment', message: 'A reason is required' }] });
    const request = await this.prisma.approvalRequest.findUnique({ where: { id } });
    if (!request) throw new AppError('NOT_FOUND');
    if (request.status !== 'PENDING') throw new AppError('INVALID_STATE');
    const type = request.type as ApprovalType;
    if (!checker.permissions?.includes(APPROVAL_PERMISSION[type])) throw new AppError('FORBIDDEN');
    if (request.makerId === checker.id) {
      await this.audit.record(checker, { action: 'approval.self_approval_blocked', resourceType: 'APPROVAL', resourceId: request.id, outcome: 'DENIED' });
      throw new AppError('MAKER_CHECKER_VIOLATION');
    }
    const handler = this.handlers.get(type);
    if (!handler) throw new AppError('INTERNAL_ERROR');
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', checkerId: checker.id, checkerComment: comment, decidedAt: new Date() },
      });
      if (claimed.count !== 1) throw new AppError('CONFLICT');
      const fresh = (await tx.approvalRequest.findUnique({ where: { id } }))!;
      if (decision === 'APPROVE') await handler.onApprove(tx, fresh, checker);
      else await handler.onReject?.(tx, fresh, checker);
      await this.audit.record(
        checker,
        { action: decision === 'APPROVE' ? 'approval.approved' : 'approval.rejected', resourceType: request.resourceType, resourceId: request.resourceId, partnerId: request.partnerId, reason: comment, approvalRef: request.reference, after: { type } },
        tx,
      );
      return fresh;
    });
    if (decision === 'APPROVE') await handler.afterApprove?.(updated, checker);
    return updated;
  }

  async list(filter: { status?: string; types?: string[]; partnerId?: string }, actor: Actor) {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { status: (filter.status as never) ?? undefined, type: filter.types ? { in: filter.types } : undefined, partnerId: filter.partnerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.makerId, r.checkerId ?? '']) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      type: r.type,
      resource_type: r.resourceType,
      resource_id: r.resourceId,
      partner_id: r.partnerId,
      summary: r.summary,
      status: r.status,
      maker: users.get(r.makerId) ?? r.makerId,
      maker_comment: r.makerComment,
      checker: r.checkerId ? users.get(r.checkerId) ?? r.checkerId : null,
      checker_comment: r.checkerComment,
      created_at: r.createdAt,
      decided_at: r.decidedAt,
      can_decide: r.status === 'PENDING' && r.makerId !== actor.id && !!actor.permissions?.includes(APPROVAL_PERMISSION[r.type as ApprovalType]),
      payload: r.payload,
    }));
  }
}
