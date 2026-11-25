import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { assertTransition, type ApplicationState, type MachineName } from '@araf/business-rules';
import { sha256Hex, redact } from '@araf/security';
import type { ApplicationStatus, Prisma } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { AppError, fail } from './errors';
import { PrismaService, type Tx } from './prisma.service';

// ---------------------------------------------------------------------------------------
// Actor context
// ---------------------------------------------------------------------------------------

export interface Actor {
  type: 'STAFF' | 'PARTNER_USER' | 'PARTNER_API' | 'CUSTOMER' | 'SYSTEM' | 'PROVIDER';
  id?: string;
  label?: string;
  roles?: string[];
  permissions?: string[];
  partnerId?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', id: 'system', label: 'Pay with ARAF' };

// ---------------------------------------------------------------------------------------
// Tamper-evident audit trail (hash chain, append-only table enforced by DB trigger)
// ---------------------------------------------------------------------------------------

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  partnerId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  approvalRef?: string | null;
  outcome?: 'SUCCESS' | 'DENIED' | 'FAILURE';
}

/** Canonical JSON (recursively sorted keys) — jsonb does not preserve key order, hashes must not depend on it. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

const toJson = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(redact(v), (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Write an audit record. Pass `tx` to make the audit record atomic with the action. */
  async record(actor: Actor, entry: AuditEntry, tx?: Tx): Promise<void> {
    const run = async (db: Tx) => {
      // Serialise chain appends so each record links to its predecessor.
      await db.$executeRawUnsafe('SELECT pg_advisory_xact_lock(727274)');
      const last = await db.auditLog.findFirst({ orderBy: { sequence: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash ?? 'GENESIS';
      const occurredAt = new Date();
      const body = {
        occurredAt: occurredAt.toISOString(),
        actorType: actor.type,
        actorId: actor.id ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        partnerId: entry.partnerId ?? actor.partnerId ?? null,
        before: toJson(entry.before) ?? null,
        after: toJson(entry.after) ?? null,
        reason: entry.reason ?? null,
        outcome: entry.outcome ?? 'SUCCESS',
      };
      const hash = sha256Hex(prevHash + canonicalJson(body));
      await db.auditLog.create({
        data: {
          occurredAt,
          actorType: actor.type,
          actorId: actor.id,
          actorLabel: actor.label,
          actorRoles: actor.roles ?? [],
          partnerId: body.partnerId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          correlationId: actor.correlationId,
          before: body.before ?? undefined,
          after: body.after ?? undefined,
          reason: entry.reason ?? null,
          approvalRef: entry.approvalRef ?? null,
          ipAddress: actor.ip,
          userAgent: actor.userAgent?.slice(0, 300),
          outcome: body.outcome,
          prevHash,
          hash,
        },
      });
    };
    if (tx) await run(tx);
    else await this.prisma.$transaction((t) => run(t));
  }

  /** Recompute the hash chain to detect tampering (used by the audit portal). */
  async verifyChain(limit = 5000): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { sequence: 'asc' }, take: limit });
    let prev = 'GENESIS';
    for (const r of rows) {
      if (r.prevHash !== prev) return { valid: false, checked: rows.length, brokenAt: r.id };
      const body = {
        occurredAt: r.occurredAt.toISOString(),
        actorType: r.actorType,
        actorId: r.actorId,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        partnerId: r.partnerId,
        before: r.before ?? null,
        after: r.after ?? null,
        reason: r.reason,
        outcome: r.outcome,
      };
      if (sha256Hex(prev + canonicalJson(body)) !== r.hash) return { valid: false, checked: rows.length, brokenAt: r.id };
      prev = r.hash;
    }
    return { valid: true, checked: rows.length };
  }
}

// ---------------------------------------------------------------------------------------
// Transactional outbox
// ---------------------------------------------------------------------------------------

export interface OutboxMessage {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  delayMs?: number;
}

@Injectable()
export class OutboxService {
  async add(tx: Tx, msg: OutboxMessage): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: msg.aggregateType,
        aggregateId: msg.aggregateId,
        type: msg.type,
        payload: toJsonRaw(msg.payload),
        availableAt: new Date(Date.now() + (msg.delayMs ?? 0)),
      },
    });
  }
}

export const toJsonRaw = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))) as Prisma.InputJsonValue;

// ---------------------------------------------------------------------------------------
// State transitions (optimistic concurrency + immutable history + outbox event)
// ---------------------------------------------------------------------------------------

@Injectable()
export class StateService {
  constructor(private readonly outbox: OutboxService) {}

  async transitionApplication(
    tx: Tx,
    app: { id: string; status: ApplicationStatus; version: number },
    to: ApplicationState,
    actor: Actor,
    opts: { reason?: string; data?: Prisma.FinancingApplicationUncheckedUpdateManyInput; metadata?: Record<string, unknown> } = {},
  ): Promise<{ version: number }> {
    if (app.status === to) return { version: app.version };
    assertTransition('APPLICATION', app.status, to);
    const result = await tx.financingApplication.updateMany({
      where: { id: app.id, version: app.version },
      data: { ...(opts.data ?? {}), status: to, version: { increment: 1 }, lastActivityAt: new Date() },
    });
    if (result.count !== 1) throw new AppError('CONFLICT');
    await tx.stateTransition.create({
      data: {
        applicationId: app.id,
        machine: 'APPLICATION',
        entityId: app.id,
        fromState: app.status,
        toState: to,
        actorType: actor.type,
        actorId: actor.id,
        reason: opts.reason,
        metadata: opts.metadata ? toJsonRaw(opts.metadata) : undefined,
      },
    });
    await this.outbox.add(tx, {
      aggregateType: 'APPLICATION',
      aggregateId: app.id,
      type: 'application.state_changed',
      payload: { applicationId: app.id, from: app.status, to, reason: opts.reason ?? null, version: app.version + 1 },
    });
    app.status = to;
    app.version += 1;
    return { version: app.version };
  }

  /** Validate and record a sub-process transition (payment, release, mandate, …). */
  async recordTransition(
    tx: Tx,
    machine: MachineName,
    entityId: string,
    from: string | null,
    to: string,
    actor: Actor,
    applicationId?: string | null,
    reason?: string,
  ): Promise<void> {
    if (from !== null && from !== to) assertTransition(machine, from, to);
    await tx.stateTransition.create({
      data: { applicationId: applicationId ?? null, machine, entityId, fromState: from, toState: to, actorType: actor.type, actorId: actor.id, reason },
    });
  }
}

// ---------------------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------------------

@Injectable()
export class ReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(prefix: string, opts: { yearly?: boolean; pad?: number; tx?: Tx } = {}): Promise<string> {
    const year = new Date().getUTCFullYear();
    const key = opts.yearly ? `${prefix}-${year}` : prefix;
    const db = opts.tx ?? this.prisma;
    const rows = await db.$queryRawUnsafe<Array<{ value: number }>>(
      `INSERT INTO reference_sequences (key, value) VALUES ($1, 1)
       ON CONFLICT (key) DO UPDATE SET value = reference_sequences.value + 1 RETURNING value`,
      key,
    );
    const n = String(rows[0].value).padStart(opts.pad ?? 6, '0');
    return opts.yearly ? `${prefix}-${year}-${n}` : `${prefix}-${n}`;
  }
}

// ---------------------------------------------------------------------------------------
// Idempotency (partner API and internal financial operations)
// ---------------------------------------------------------------------------------------

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Execute `fn` at most once per (scope, key). Replays return the stored response.
   * A different request body with the same key is rejected.
   */
  async run<T extends object>(scope: string, key: string, requestBody: unknown, fn: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T; replayed: boolean }> {
    if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(key)) fail('VALIDATION_FAILED', { fields: [{ path: 'Idempotency-Key', message: 'Use 8–128 characters [A-Za-z0-9_-:.]' }] });
    const requestHash = sha256Hex(JSON.stringify(requestBody ?? null));
    const now = new Date();
    let record = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (!record) {
      try {
        record = await this.prisma.idempotencyRecord.create({
          data: { scope, key, requestHash, lockedUntil: new Date(now.getTime() + 30_000), expiresAt: new Date(now.getTime() + 24 * 3600_000) },
        });
      } catch {
        record = await this.prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
        if (!record) throw new AppError('CONFLICT');
        return this.replay(record, requestHash);
      }
      try {
        const result = await fn();
        await this.prisma.idempotencyRecord.update({
          where: { id: record.id },
          data: { statusCode: result.status, responseBody: toJsonRaw(result.body), lockedUntil: null },
        });
        return { ...result, replayed: false };
      } catch (e) {
        // Failed requests release the key so the client may retry with the same key.
        await this.prisma.idempotencyRecord.delete({ where: { id: record.id } }).catch(() => undefined);
        throw e;
      }
    }
    return this.replay(record, requestHash);
  }

  private replay<T>(record: { requestHash: string; statusCode: number | null; responseBody: unknown; lockedUntil: Date | null }, requestHash: string) {
    if (record.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
    if (record.statusCode === null) throw new AppError('IDEMPOTENCY_IN_PROGRESS');
    return { status: record.statusCode, body: record.responseBody as T, replayed: true };
  }
}

// ---------------------------------------------------------------------------------------
// Rate limiting (Redis fixed window)
// ---------------------------------------------------------------------------------------

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger('RateLimit');

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', (e) => this.logger.warn(`redis: ${e.message}`));
  }

  /** Throws RATE_LIMITED when `limit` hits occur within `windowSeconds`. Fails closed for auth-critical keys. */
  private readonly multiplier = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER ?? 1));

  async hit(key: string, limit: number, windowSeconds: number, failClosed = true): Promise<void> {
    // RATE_LIMIT_MULTIPLIER exists only so automated test suites (one IP, many journeys) can run;
    // config refuses it in production.
    limit = limit * this.multiplier;
    try {
      const k = `rl:${key}`;
      const count = await this.redis.incr(k);
      if (count === 1) await this.redis.expire(k, windowSeconds);
      if (count > limit) throw new AppError('RATE_LIMITED');
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.logger.error(`rate limiter unavailable: ${(e as Error).message}`);
      if (failClosed) throw new AppError('RATE_LIMITED');
    }
  }

  async reset(key: string) {
    await this.redis.del(`rl:${key}`).catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping().catch(() => 'ERR')) === 'PONG';
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
