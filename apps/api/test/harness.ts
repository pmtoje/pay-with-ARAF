import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { totpAt, verifyWebhookSignature } from '@araf/security';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { WorkerService } from '../src/worker/worker.service';

export const STAFF_PASSWORD = 'Sandbox-Pass-2026!';
export const staffEmail = (who: string) => `${who}@sandbox.altbank.example`;

export interface Harness {
  app: NestExpressApplication;
  http: ReturnType<NestExpressApplication['getHttpServer']>;
  prisma: PrismaService;
  worker: WorkerService;
  receiver: WebhookReceiver;
  close(): Promise<void>;
}

export interface ReceivedWebhook {
  raw: string;
  headers: Record<string, string | string[] | undefined>;
  body: { event_id: string; event: string; data: Record<string, unknown>; resource_version: number };
  valid: boolean;
}

export class WebhookReceiver {
  server!: Server;
  received: ReceivedWebhook[] = [];
  secret = '';
  failNext = 0;
  async start() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (this.failNext > 0) {
          this.failNext--;
          res.statusCode = 500;
          return res.end('simulated failure');
        }
        const valid = verifyWebhookSignature(raw, req.headers['araf-signature'] as string, this.secret).valid;
        this.received.push({ raw, headers: req.headers, body: JSON.parse(raw), valid });
        res.statusCode = valid ? 200 : 400;
        res.end('ok');
      });
    });
    // Bind the unspecified IPv6 address (dual-stack) so both 127.0.0.1 and ::1 reach the
    // receiver. CI resolves `localhost` to ::1 first, which previously failed when this
    // server listened on 127.0.0.1 only.
    await new Promise<void>((r) => this.server.listen(0, () => r()));
  }
  get url() {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/webhooks/araf`;
  }
  events(type?: string) {
    return this.received.filter((r) => !type || r.body.event === type);
  }
}

export async function createHarness(): Promise<Harness> {
  const app = await createApp();
  await app.init();
  const receiver = new WebhookReceiver();
  await receiver.start();
  return {
    app,
    http: app.getHttpServer(),
    prisma: app.get(PrismaService),
    worker: app.get(WorkerService),
    receiver,
    async close() {
      receiver.server.close();
      await app.close();
    },
  };
}

/** Compute a TOTP for a sandbox staff user at a time-step not used before (replay protection). */
const usedSteps = new Map<string, number>();
export function nextTotp(secret: string): string {
  let t = Date.now();
  const last = usedSteps.get(secret) ?? 0;
  if (Math.floor(t / 30_000) <= last) t = (last + 1) * 30_000; // verifier accepts ±1 step
  usedSteps.set(secret, Math.floor(t / 30_000));
  return totpAt(secret, t);
}

export function csrfFrom(res: request.Response, name: string): string {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
  const c = cookies.find((x) => x.startsWith(`${name}=`));
  return c ? decodeURIComponent(c.split(';')[0].split('=')[1]) : '';
}

export interface PortalAgent {
  agent: TestAgent;
  csrf: string;
  post(path: string, body?: unknown): request.Test;
  get(path: string): request.Test;
}

export async function loginPortal(h: Harness, portal: 'admin' | 'partner', email: string, password: string, totpSecret: string): Promise<PortalAgent> {
  const agent = request.agent(h.http);
  const login = await agent.post(`/api/auth/${portal}/login`).send({ email, password });
  if (login.status !== 200) throw new Error(`login ${email}: ${login.status} ${JSON.stringify(login.body)}`);
  const csrf1 = csrfFrom(login, `araf_csrf_${portal}`);
  // Test files share one database but not memory: start after the last step the server accepted
  // for this user (replay protection), waiting for the clock if that step is not yet valid.
  const cred = await h.prisma.mfaCredential.findFirst({ where: { user: { email: email.toLowerCase() }, verifiedAt: { not: null } }, orderBy: { createdAt: 'desc' } });
  const dbStep = cred?.lastUsedStep !== null && cred?.lastUsedStep !== undefined ? Number(cred.lastUsedStep) : 0;
  usedSteps.set(totpSecret, Math.max(usedSteps.get(totpSecret) ?? 0, dbStep));
  const code = nextTotp(totpSecret);
  const step = usedSteps.get(totpSecret)!;
  const waitMs = step * 30_000 - 30_000 - Date.now(); // the verifier accepts one step ahead
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs + 200));
  const mfa = await agent.post(`/api/auth/${portal}/mfa`).set('x-csrf-token', csrf1).send({ code });
  if (mfa.status !== 200) throw new Error(`mfa ${email}: ${mfa.status} ${JSON.stringify(mfa.body)}`);
  const csrf = mfa.body.csrf_token as string;
  return {
    agent,
    csrf,
    post: (path, body) => agent.post(path).set('x-csrf-token', csrf).send(body as object),
    get: (path) => agent.get(path),
  };
}

export async function staff(h: Harness, who: string): Promise<PortalAgent> {
  const { sandboxTotpSecret } = await import('@araf/database/dist/seed');
  return loginPortal(h, 'admin', staffEmail(who), STAFF_PASSWORD, sandboxTotpSecret(staffEmail(who)));
}

export async function drain(h: Harness, rounds = 4) {
  for (let i = 0; i < rounds; i++) await h.worker.tick();
}

export const N = (naira: number) => naira * 100;
