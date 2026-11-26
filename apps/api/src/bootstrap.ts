import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { CONFIG, type AppConfig } from './config';

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: false, logger: ['error', 'warn', 'log'] });
  const config = app.get<AppConfig>(CONFIG);
  // Client IPs drive rate limits and audit records. Behind araf.ng the edge proxy OVERWRITES
  // X-Forwarded-For with the real client address, so trusting a fixed number of hops cannot be spoofed.
  app.set('trust proxy', config.APP_ENV === 'local' || config.APP_ENV === 'test' ? 'loopback' : config.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity: config.COOKIE_SECURE ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  // No CORS: browser apps reach the API through same-origin proxies; partners call server-to-server.
  app.enableShutdownHooks();
  return app;
}
