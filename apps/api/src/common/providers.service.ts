import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ArafHttpProvider,
  EncryptedFileStorage,
  IntegrationNotConfiguredError,
  ProviderError,
  SandboxAccountOpeningProvider,
  SandboxAltBankProvider,
  SandboxIdentityProvider,
  SandboxMalwareScanner,
  SandboxMonoProvider,
  SandboxNotificationProvider,
  SandboxPaymentProvider,
  SandboxPericulumProvider,
  SandboxRemitaProvider,
  SandboxSeedFiProvider,
  liveProviders,
  FORCED,
  type ArafStatusReport,
  type ArafWorkflowProvider,
  type CallContext,
  type ProviderSet,
  type SimStore,
} from '@araf/integrations';
import { randomBase62 } from '@araf/security';
import type { Environment } from '@araf/database';
import { CONFIG, type AppConfig } from '../config';
import { CryptoService } from './crypto.service';
import { toJsonRaw } from './core.services';
import { PrismaService } from './prisma.service';

/** SimStore backed by the sim_records table (sandbox simulators only). */
class PrismaSimStore implements SimStore {
  constructor(private readonly prisma: PrismaService) {}
  async get<T>(kind: string, key: string): Promise<T | null> {
    const r = await this.prisma.simRecord.findUnique({ where: { kind_key: { kind, key } } });
    return (r?.data as T) ?? null;
  }
  async put<T>(kind: string, key: string, data: T): Promise<void> {
    const json = toJsonRaw(data);
    await this.prisma.simRecord.upsert({ where: { kind_key: { kind, key } }, create: { kind, key, data: json }, update: { data: json } });
  }
}

/**
 * Sandbox ARAF workflow: creates a case in the simulator tables (operated by Bank staff in
 * the admin portal's "ARAF Workflow Simulator"). Submission is idempotent on the key.
 */
class SandboxArafProvider implements ArafWorkflowProvider {
  readonly name = 'ARAF workflow (sandbox simulator)';
  constructor(private readonly prisma: PrismaService) {}
  async submit(payload: Record<string, unknown>, idempotencyKey: string) {
    const existing = await this.prisma.simArafCase.findUnique({ where: { idempotencyKey } });
    if (existing) return { arafReference: existing.arafReference };
    const arafReference = `ARAF-SBX-${randomBase62(8).toUpperCase()}`;
    await this.prisma.simArafCase.create({
      data: { arafReference, applicationRef: String(payload.application_reference), idempotencyKey, stage: 'RECEIVED', submission: toJsonRaw(payload) },
    });
    return { arafReference };
  }
  async findByIdempotencyKey(idempotencyKey: string) {
    const c = await this.prisma.simArafCase.findUnique({ where: { idempotencyKey } });
    return c ? { arafReference: c.arafReference } : null;
  }
  /** Simulated ARAF receipt of execution status: idempotent on eventId, visible in the case history. */
  async reportStatus(report: ArafStatusReport) {
    const c = await this.prisma.simArafCase.findUnique({ where: { arafReference: report.arafReference } });
    if (!c) throw new ProviderError('ARAF', 'NOT_FOUND', 'Unknown ARAF case');
    const forced = await this.prisma.simRecord.findUnique({ where: { kind_key: { kind: FORCED, key: c.applicationRef } } });
    if ((forced?.data as { outcomes?: string[] } | undefined)?.outcomes?.includes('ARAF_REPORTING_FAILURE')) throw new ProviderError('ARAF', 'UNAVAILABLE', 'ARAF reporting endpoint unavailable (simulated)');
    const seen = await this.prisma.simRecord.findUnique({ where: { kind_key: { kind: 'ARAF_REPORT', key: report.eventId } } });
    if (seen) return { acknowledged: true as const, arafEventReference: (seen.data as { ref: string }).ref };
    const ref = `ARAF-EVT-${randomBase62(10).toUpperCase()}`;
    await this.prisma.$transaction([
      this.prisma.simRecord.create({ data: { kind: 'ARAF_REPORT', key: report.eventId, data: toJsonRaw({ ref, sequence: report.sequence, type: report.type }) } }),
      this.prisma.simArafAction.create({ data: { caseId: c.id, stage: c.stage, action: `REPORTED:${report.type}`, actorId: 'pay-with-araf', actorName: 'Pay with ARAF (execution report)', note: JSON.stringify(report.data).slice(0, 1000) } }),
    ]);
    return { acknowledged: true as const, arafEventReference: ref };
  }
}

export interface SandboxProviderSet extends ProviderSet {
  accountOpening: SandboxAccountOpeningProvider;
  mono: SandboxMonoProvider;
  remita: SandboxRemitaProvider;
  payments: SandboxPaymentProvider;
}

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger('Integrations');
  readonly simStore: SimStore;
  readonly sandbox: SandboxProviderSet;
  private readonly live: ProviderSet;
  private connectedAraf: ArafHttpProvider | null = null;
  readonly storage: EncryptedFileStorage;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    crypto: CryptoService,
  ) {
    this.simStore = new PrismaSimStore(prisma);
    const deps = {
      store: this.simStore,
      now: () => new Date(),
      checkoutBaseUrl: config.CHECKOUT_BASE_URL,
      asyncDelayMs: config.SANDBOX_ASYNC_DELAY_MS,
      onSandboxMessage: async (m: { channel: string; destination: string; body: string; applicationReference?: string }) => {
        const app = m.applicationReference ? await prisma.financingApplication.findUnique({ where: { reference: m.applicationReference }, select: { id: true } }) : null;
        await prisma.sandboxMessage.create({ data: { applicationId: app?.id, channel: m.channel, destination: m.destination, body: m.body } });
      },
    };
    const altbank = new SandboxAltBankProvider(deps);
    this.sandbox = {
      identity: new SandboxIdentityProvider(),
      credit: new SandboxSeedFiProvider(),
      bankAccounts: altbank,
      coreBanking: altbank,
      accountOpening: new SandboxAccountOpeningProvider(deps),
      mono: new SandboxMonoProvider(deps),
      periculum: new SandboxPericulumProvider(deps),
      araf: new SandboxArafProvider(prisma),
      remita: new SandboxRemitaProvider(deps),
      payments: new SandboxPaymentProvider(deps),
      notifications: new SandboxNotificationProvider(deps),
      malware: new SandboxMalwareScanner(),
    };
    this.live = liveProviders();
    // Connected to the real AltBank Retail Asset Factory: both environments use it instead of the simulator.
    if (config.ARAF_MODE === 'connected' && config.ARAF_BASE_URL && config.ARAF_INTEGRATION_SECRET) {
      this.connectedAraf = new ArafHttpProvider({ baseUrl: config.ARAF_BASE_URL, secret: config.ARAF_INTEGRATION_SECRET });
    }
    this.storage = new EncryptedFileStorage(config.STORAGE_DIR, crypto.encryptor);
  }

  /**
   * Provider set for a record environment. SANDBOX records always use simulators;
   * PRODUCTION records always use live adapters (which fail closed until configured).
   * There is no code path that serves a PRODUCTION record with a simulator.
   */
  for(environment: Environment): ProviderSet {
    if (environment === 'SANDBOX') {
      if (!this.config.isSandbox) throw new IntegrationNotConfiguredError('Sandbox simulators are disabled in this deployment');
      return this.connectedAraf ? { ...this.sandbox, araf: this.connectedAraf } : this.sandbox;
    }
    if (!this.config.LIVE_OPERATIONS_ENABLED) throw new IntegrationNotConfiguredError('Live operations');
    return this.connectedAraf ? { ...this.live, araf: this.connectedAraf } : this.live;
  }

  isSimulated(environment: Environment): boolean {
    return environment === 'SANDBOX';
  }

  /** Wrap a provider call with timing, normalised errors and a payload-free integration log. */
  async call<T>(
    environment: Environment,
    provider: string,
    operation: string,
    ctx: CallContext & { applicationId?: string },
    fn: () => Promise<T>,
    timeoutMs = 15_000,
  ): Promise<T> {
    const started = Date.now();
    let outcome = 'SUCCESS';
    let errorCode: string | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_r, reject) => setTimeout(() => reject(new ProviderError(provider, 'TIMEOUT')), timeoutMs)),
      ]);
    } catch (e) {
      outcome = e instanceof ProviderError ? (e.code === 'TIMEOUT' ? 'TIMEOUT' : e.code === 'INVALID_RESPONSE' ? 'INVALID_RESPONSE' : 'FAILURE') : 'FAILURE';
      errorCode = e instanceof ProviderError ? e.code : e instanceof IntegrationNotConfiguredError ? 'NOT_CONFIGURED' : 'UNEXPECTED';
      throw e;
    } finally {
      const latencyMs = Date.now() - started;
      this.prisma.integrationLog
        .create({
          data: { provider, operation, environment, isSimulated: environment === 'SANDBOX' && !(provider === 'ARAF' && this.connectedAraf), applicationId: ctx.applicationId, correlationId: ctx.correlationId, outcome, errorCode, latencyMs },
        })
        .catch((err) => this.logger.warn(`integration log failed: ${(err as Error).message}`));
    }
  }
}
