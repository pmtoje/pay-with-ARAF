import { Inject, Injectable, Logger } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { EVENT_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, UnsafeUrlError, buildSignatureHeader, randomToken, resolveSafeTarget } from '@araf/security';
import { WEBHOOK_SCHEMA_VERSION, type WebhookEventType } from '@araf/types';
import type { Environment } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { CryptoService } from '../common/crypto.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { toJsonRaw } from '../common/core.services';

export const MAX_WEBHOOK_ATTEMPTS = 8;
const SUSPEND_AFTER_CONSECUTIVE_FAILURES = 25;

export interface WebhookTarget {
  url: string;
  address: string;
  family: 4 | 6;
}

/** POST without following redirects, to the pre-resolved (pinned) address. */
export function postPinned(target: WebhookTarget & { parsed: URL }, body: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; snippet: string }> {
  return new Promise((resolve, reject) => {
    const isHttps = target.parsed.protocol === 'https:';
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        protocol: target.parsed.protocol,
        hostname: target.parsed.hostname,
        port: target.parsed.port || (isHttps ? 443 : 80),
        path: `${target.parsed.pathname}${target.parsed.search}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString(), 'user-agent': 'PayWithARAF-Webhooks/1.0', ...headers },
        // Connect to the address we validated, defeating DNS rebinding; SNI/Host stay the original hostname.
        // Node ≥ 20 calls lookup with { all: true } and expects an array of addresses.
        lookup: ((_host: string, opts: { all?: boolean }, cb: (err: Error | null, address: unknown, family?: number) => void) =>
          opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)) as never,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => {
          if (data.length < 500) data += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, snippet: data.slice(0, 300) }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  urlPolicy() {
    return { allowHttp: this.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS, allowPrivateNetworks: this.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS };
  }

  /**
   * Create an event and fan out deliveries to subscribed endpoints, inside the caller's
   * transaction (so the event exists iff the state change committed).
   */
  async emit(
    tx: Tx,
    input: {
      partnerId: string;
      environment: Environment;
      type: WebhookEventType;
      applicationReference?: string | null;
      merchantOrderReference?: string | null;
      resourceVersion: number;
      data: Record<string, unknown>;
      test?: boolean;
    },
  ): Promise<string> {
    const id = randomToken('evt_', 24);
    const createdAt = new Date();
    const envelope = {
      event_id: id,
      event: input.type,
      version: WEBHOOK_SCHEMA_VERSION,
      created_at: createdAt.toISOString(),
      livemode: input.environment === 'PRODUCTION',
      ...(input.test ? { test: true } : {}),
      partner_id: input.partnerId,
      resource_version: input.resourceVersion,
      data: { application_reference: input.applicationReference ?? null, merchant_order_reference: input.merchantOrderReference ?? null, ...input.data },
    };
    await tx.webhookEvent.create({
      data: {
        id,
        partnerId: input.partnerId,
        environment: input.environment,
        type: input.type,
        schemaVersion: WEBHOOK_SCHEMA_VERSION,
        applicationRef: input.applicationReference ?? null,
        merchantOrderReference: input.merchantOrderReference ?? null,
        resourceVersion: input.resourceVersion,
        payload: toJsonRaw(envelope),
        createdAt,
      },
    });
    const endpoints = await tx.webhookEndpoint.findMany({ where: { partnerId: input.partnerId, environment: input.environment, status: 'ACTIVE' } });
    const subscribed = endpoints.filter((e) => e.events.length === 0 || e.events.includes(input.type));
    if (subscribed.length) {
      await tx.webhookDelivery.createMany({ data: subscribed.map((e) => ({ eventId: id, endpointId: e.id, status: 'PENDING', nextAttemptAt: createdAt })) });
    }
    return id;
  }

  private backoffMs(attempt: number): number {
    // Sandbox: seconds-scale for demonstrability; production: minutes→hours. Exponential with full jitter.
    const base = this.config.isSandbox ? 4_000 : 60_000;
    const cap = this.config.isSandbox ? 120_000 : 12 * 3600_000;
    const exp = Math.min(cap, base * 2 ** (attempt - 1));
    return Math.floor(exp / 2 + Math.random() * (exp / 2));
  }

  /** Deliver due webhooks. Uses SKIP LOCKED so multiple workers can run safely. */
  async deliverDue(batch = 20): Promise<number> {
    const due = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM webhook_deliveries WHERE status IN ('PENDING','RETRYING') AND "nextAttemptAt" <= now()
       ORDER BY "nextAttemptAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED`,
    );
    for (const { id } of due) await this.deliverOne(id).catch((e) => this.logger.error(`delivery ${id}: ${(e as Error).message}`));
    return due.length;
  }

  async deliverOne(deliveryId: string): Promise<void> {
    // Claim: push nextAttemptAt forward so a concurrent worker does not double-send.
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: { id: deliveryId, status: { in: ['PENDING', 'RETRYING'] } },
      data: { nextAttemptAt: new Date(Date.now() + 60_000) },
    });
    if (claimed.count !== 1) return;
    const delivery = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { endpoint: true, event: true } });
    const endpoint = delivery.endpoint;
    if (endpoint.status !== 'ACTIVE') {
      await this.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'SKIPPED', lastError: `Endpoint ${endpoint.status}` } });
      return;
    }
    const attemptNumber = delivery.attemptCount + 1;
    const body = JSON.stringify(delivery.event.payload);
    const ts = Math.floor(Date.now() / 1000);
    const secrets = [this.crypto.decrypt(endpoint.secretEncrypted, `whsec:${endpoint.id}`)];
    if (endpoint.previousSecretEncrypted && endpoint.previousSecretExpiresAt && endpoint.previousSecretExpiresAt.getTime() > Date.now()) {
      secrets.push(this.crypto.decrypt(endpoint.previousSecretEncrypted, `whsec:${endpoint.id}`));
    }
    const started = Date.now();
    let statusCode: number | null = null;
    let error: string | null = null;
    let snippet: string | null = null;
    try {
      const target = await resolveSafeTarget(endpoint.url, this.urlPolicy());
      const res = await postPinned(
        { url: endpoint.url, address: target.address, family: target.family, parsed: target.url },
        body,
        { [SIGNATURE_HEADER]: buildSignatureHeader(secrets, ts, body), [TIMESTAMP_HEADER]: String(ts), [EVENT_ID_HEADER]: delivery.eventId },
        10_000,
      );
      statusCode = res.status;
      snippet = res.snippet;
      if (res.status >= 300 && res.status < 400) error = 'Redirects are not followed';
      else if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof UnsafeUrlError ? `Unsafe URL: ${e.code}` : (e as Error).message === 'TIMEOUT' ? 'Timed out after 10s' : `Connection error: ${(e as Error).message}`.slice(0, 200);
    }
    const durationMs = Date.now() - started;
    const ok = error === null;
    await this.prisma.$transaction(async (tx) => {
      await tx.webhookDeliveryAttempt.create({ data: { deliveryId, attemptNumber, statusCode, durationMs, error, responseSnippet: snippet } });
      if (ok) {
        await tx.webhookDelivery.update({ where: { id: deliveryId }, data: { status: 'SUCCEEDED', attemptCount: attemptNumber, lastStatusCode: statusCode, lastError: null, succeededAt: new Date(), nextAttemptAt: null } });
        await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0 } });
      } else {
        const dead = attemptNumber >= MAX_WEBHOOK_ATTEMPTS;
        await tx.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: dead ? 'DEAD_LETTERED' : 'RETRYING', attemptCount: attemptNumber, lastStatusCode: statusCode, lastError: error, nextAttemptAt: dead ? null : new Date(Date.now() + this.backoffMs(attemptNumber)) },
        });
        const failures = endpoint.consecutiveFailures + 1;
        await tx.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { consecutiveFailures: failures, ...(failures >= SUSPEND_AFTER_CONSECUTIVE_FAILURES ? { status: 'SUSPENDED', suspendedAt: new Date() } : {}) },
        });
      }
    });
  }

  /** Manual retry / redelivery of an event to the partner's endpoints (tenant-scoped by caller). */
  async retryEvent(partnerId: string, environment: Environment, eventId: string): Promise<number> {
    const event = await this.prisma.webhookEvent.findFirst({ where: { id: eventId, partnerId, environment } });
    if (!event) return -1;
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { partnerId, environment, status: 'ACTIVE' } });
    let n = 0;
    for (const e of endpoints.filter((x) => x.events.length === 0 || x.events.includes(event.type))) {
      await this.prisma.webhookDelivery.upsert({
        where: { eventId_endpointId: { eventId, endpointId: e.id } },
        create: { eventId, endpointId: e.id, status: 'PENDING', nextAttemptAt: new Date() },
        update: { status: 'PENDING', nextAttemptAt: new Date(), attemptCount: 0 },
      });
      n++;
    }
    return n;
  }
}
