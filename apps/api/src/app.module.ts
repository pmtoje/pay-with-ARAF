import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { CONFIG, loadConfig } from './config';
import { GlobalExceptionFilter } from './common/errors';
import { BigIntInterceptor } from './common/bigint.interceptor';
import { FeesService } from './fees/fees.service';
import { PrismaService } from './common/prisma.service';
import { CryptoService } from './common/crypto.service';
import { AuditService, IdempotencyService, OutboxService, RateLimitService, ReferenceService, StateService } from './common/core.services';
import { ProvidersService } from './common/providers.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController, AuthService } from './auth/auth.controller';
import { ApprovalsService } from './approvals/approvals.service';
import { PartnersService } from './partners/partners.service';
import { PartnerPortalController } from './partners/partner-portal.controller';
import { WebhooksService } from './webhooks/webhooks.service';
import { NotificationsService } from './notifications/notifications.service';
import { AppContextService } from './applications/app-context.service';
import { CheckoutService } from './checkout/checkout.service';
import { PartnerApiController } from './checkout/partner-api.controller';
import { JourneyService } from './customer/journey.service';
import { StatementsService } from './customer/statements.service';
import { CustomerController } from './customer/customer.controller';
import { EligibilityService } from './credit/eligibility.service';
import { ReviewsService } from './credit/reviews.service';
import { ArafService } from './araf/araf.service';
import { ArafReportingService } from './araf/araf-reporting.service';
import { OperationsService } from './operations/operations.service';
import { BackupCardService } from './operations/backup-card.service';
import { ReportsService } from './reports/reports.service';
import { AdminService } from './admin/admin.service';
import { AdminController } from './admin/admin.controller';
import { CallbacksController, SandboxController } from './sandbox/sandbox.controller';
import { HealthController } from './health/health.controller';
import { WorkerService } from './worker/worker.service';

const SERVICES = [
  PrismaService,
  FeesService,
  CryptoService,
  AuditService,
  OutboxService,
  StateService,
  ReferenceService,
  IdempotencyService,
  RateLimitService,
  ProvidersService,
  AuthService,
  ApprovalsService,
  PartnersService,
  WebhooksService,
  NotificationsService,
  AppContextService,
  CheckoutService,
  JourneyService,
  StatementsService,
  EligibilityService,
  ReviewsService,
  ArafService,
  ArafReportingService,
  OperationsService,
  BackupCardService,
  ReportsService,
  AdminService,
  WorkerService,
];

@Module({
  controllers: [AuthController, PartnerApiController, CustomerController, AdminController, PartnerPortalController, SandboxController, CallbacksController, HealthController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    ...SERVICES,
    { provide: 'ARAF_SERVICE', useExisting: ArafService },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor },
  ],
  exports: SERVICES,
})
export class AppModule implements NestModule {
  constructor(private readonly prismaService: PrismaService) {}

  configure(consumer: MiddlewareConsumer) {
    const prisma = this.prismaService;
    consumer
      .apply((req: Request & { correlationId?: string }, res: Response, next: NextFunction) => {
        const incoming = req.headers['x-correlation-id'];
        req.correlationId = typeof incoming === 'string' && /^[A-Za-z0-9_\-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Correlation-Id', req.correlationId);
        const started = Date.now();
        res.on('finish', () => {
          const r = req as Request & { api?: { partnerId: string; environment: 'SANDBOX' | 'PRODUCTION'; credentialId: string }; route?: { path?: string } };
          if (r.api) {
            void prisma.apiRequestLog
              .create({ data: { partnerId: r.api.partnerId, environment: r.api.environment, credentialId: r.api.credentialId, method: req.method, path: (r.route?.path as string | undefined) ?? req.path.slice(0, 120), statusCode: res.statusCode, durationMs: Date.now() - started, correlationId: req.correlationId!, idempotencyKey: (req.headers['idempotency-key'] as string | undefined)?.slice(0, 128) } })
              .catch(() => undefined);
          }
          // Structured access log: no bodies, no query strings (which could contain tokens).
          process.stdout.write(
            JSON.stringify({ level: 'info', msg: 'http', method: req.method, path: (req.route?.path as string | undefined) ?? req.path.replace(/[0-9a-f-]{36}|cs_(test|live)_[A-Za-z0-9]+/g, ':id'), status: res.statusCode, ms: Date.now() - started, correlationId: req.correlationId }) + '\n',
          );
        });
        next();
      })
      .forRoutes('*');
  }
}
