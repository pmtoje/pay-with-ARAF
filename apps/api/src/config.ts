import { z } from 'zod';

const appEnvs = ['local', 'test', 'sandbox', 'uat', 'staging', 'production'] as const;

const schema = z.object({
  APP_ENV: z.enum(appEnvs),
  /** Reverse-proxy hops in front of the API (araf.ng: edge proxy + web app = 2). Proxies must overwrite X-Forwarded-For. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  PLATFORM_ENVIRONMENT: z.enum(['SANDBOX', 'PRODUCTION']),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  /** API listen port. Defaults to PORT (Render/Heroku-style hosts), then 4000. */
  API_PORT: z.coerce.number().int().optional(),
  PORT: z.coerce.number().int().optional(),
  PUBLIC_API_URL: z.string().url(),
  CHECKOUT_BASE_URL: z.string().url(),
  PARTNER_PORTAL_URL: z.string().url(),
  ADMIN_PORTAL_URL: z.string().url(),
  DEVELOPER_PORTAL_URL: z.string().url(),
  ENCRYPTION_KEYS: z.string().transform((s, ctx) => {
    try {
      return z.record(z.string(), z.string()).parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ENCRYPTION_KEYS must be a JSON object' });
      return z.NEVER;
    }
  }),
  ENCRYPTION_ACTIVE_KEY: z.string().min(1),
  BLIND_INDEX_KEY: z.string().min(32),
  API_KEY_PEPPER: z.string().min(32),
  OTP_PEPPER: z.string().min(32),
  STATE_TOKEN_KEY: z.string().min(32),
  INTERNAL_CALLBACK_SECRET: z.string().min(32),
  /** Resend (email) — set both to deliver EMAIL notifications/OTP through Resend instead of the sandbox inbox. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** A verified Resend sender, e.g. `no-reply@araf.ng` or `Pay with ARAF <no-reply@araf.ng>`. */
  EMAIL_FROM: z.string().min(3).optional(),
  STORAGE_DIR: z.string().default('./storage'),
  COOKIE_SECURE: z.enum(['true', 'false']).transform((v) => v === 'true'),
  WEBHOOK_ALLOW_PRIVATE_NETWORKS: z.enum(['true', 'false']).transform((v) => v === 'true'),
  SANDBOX_ASYNC_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  LIVE_OPERATIONS_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
  /**
   * Connection to the AltBank Retail Asset Factory (ARAF), a separate application.
   *  - simulator: the built-in sandbox workflow simulator (default)
   *  - connected: applications are submitted to the real ARAF over its signed integration API,
   *    ARAF's decisions come back as signed callbacks, and execution reports are sent to it.
   */
  ARAF_MODE: z.enum(['simulator', 'connected']).default('simulator'),
  ARAF_BASE_URL: z.string().url().optional(),
  /** Shared HMAC secret for the ARAF integration (both directions). From the secrets manager. */
  ARAF_INTEGRATION_SECRET: z.string().min(32).optional(),
  /** Bank staff sign in to the admin portal with their ARAF (@altbank.ng) account. */
  ARAF_SSO_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Comma-separated email domains allowed for Bank staff (e.g. altbank.ng). */
  STAFF_EMAIL_DOMAINS: z.string().default('altbank.ng,sandbox.altbank.example'),
  /**
   * SANDBOX ONLY, for demo deployments without an SMS gateway: send customer one-time codes to the email the
   * merchant supplied instead of the BVN-linked phone. Never allowed for production records — the code sent
   * to the BVN-linked phone is what proves the shopper holds the BVN.
   */
  SANDBOX_OTP_VIA_MERCHANT_EMAIL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema> & {
  API_PORT: number;
  isSandbox: boolean;
  sandboxToolsEnabled: boolean;
  staffEmailDomains: string[];
};

/**
 * Load configuration. Production FAILS CLOSED on any unsafe setting rather than
 * degrading silently (spec §52, §68).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}`);
  }
  const c = parsed.data;
  const apiPort = c.API_PORT ?? c.PORT ?? 4000;
  const isProd = c.APP_ENV === 'production';
  const problems: string[] = [];
  if (isProd) {
    if (c.PLATFORM_ENVIRONMENT !== 'PRODUCTION') problems.push('production deployments must serve PRODUCTION records');
    if (!c.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true');
    if (c.WEBHOOK_ALLOW_PRIVATE_NETWORKS) problems.push('WEBHOOK_ALLOW_PRIVATE_NETWORKS must be false');
    if (Number(env.RATE_LIMIT_MULTIPLIER ?? 1) !== 1) problems.push('RATE_LIMIT_MULTIPLIER must not be set in production');
    for (const url of [c.PUBLIC_API_URL, c.CHECKOUT_BASE_URL, c.PARTNER_PORTAL_URL, c.ADMIN_PORTAL_URL]) {
      if (!url.startsWith('https://')) problems.push(`${url} must use https`);
    }
  }
  if (c.PLATFORM_ENVIRONMENT === 'PRODUCTION' && !isProd) problems.push('PRODUCTION records may only be served by APP_ENV=production');
  if (c.LIVE_OPERATIONS_ENABLED && !isProd) problems.push('LIVE_OPERATIONS_ENABLED is only valid in production');
  if (!(c.ENCRYPTION_ACTIVE_KEY in c.ENCRYPTION_KEYS)) problems.push('ENCRYPTION_ACTIVE_KEY not present in ENCRYPTION_KEYS');
  if (c.RESEND_API_KEY && !c.EMAIL_FROM) problems.push('EMAIL_FROM is required when RESEND_API_KEY is set');
  if (!c.RESEND_API_KEY && c.EMAIL_FROM) problems.push('RESEND_API_KEY is required when EMAIL_FROM is set');
  if ((c.ARAF_MODE === 'connected' || c.ARAF_SSO_ENABLED) && (!c.ARAF_BASE_URL || !c.ARAF_INTEGRATION_SECRET)) problems.push('ARAF_BASE_URL and ARAF_INTEGRATION_SECRET are required to connect to ARAF');
  if (isProd && c.ARAF_BASE_URL && !c.ARAF_BASE_URL.startsWith('https://')) problems.push('ARAF_BASE_URL must use https');
  if (isProd && c.STAFF_EMAIL_DOMAINS.split(',').some((d) => d.trim().endsWith('.example'))) problems.push('STAFF_EMAIL_DOMAINS must not include example domains in production');
  if (c.SANDBOX_OTP_VIA_MERCHANT_EMAIL && (isProd || c.PLATFORM_ENVIRONMENT === 'PRODUCTION')) problems.push('SANDBOX_OTP_VIA_MERCHANT_EMAIL is sandbox-only');
  if (problems.length) throw new Error(`Unsafe configuration refused: ${problems.join('; ')}`);
  const isSandbox = c.PLATFORM_ENVIRONMENT === 'SANDBOX';
  return { ...c, API_PORT: apiPort, isSandbox, sandboxToolsEnabled: isSandbox && !isProd, staffEmailDomains: c.STAFF_EMAIL_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) };
}

export const CONFIG = Symbol('CONFIG');
