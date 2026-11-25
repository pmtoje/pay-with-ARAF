import { z } from 'zod';

const appEnvs = ['local', 'test', 'sandbox', 'uat', 'staging', 'production'] as const;

const schema = z.object({
  APP_ENV: z.enum(appEnvs),
  PLATFORM_ENVIRONMENT: z.enum(['SANDBOX', 'PRODUCTION']),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
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
  STORAGE_DIR: z.string().default('./storage'),
  COOKIE_SECURE: z.enum(['true', 'false']).transform((v) => v === 'true'),
  WEBHOOK_ALLOW_PRIVATE_NETWORKS: z.enum(['true', 'false']).transform((v) => v === 'true'),
  SANDBOX_ASYNC_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  LIVE_OPERATIONS_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema> & {
  isSandbox: boolean;
  sandboxToolsEnabled: boolean;
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
  if (problems.length) throw new Error(`Unsafe configuration refused: ${problems.join('; ')}`);
  const isSandbox = c.PLATFORM_ENVIRONMENT === 'SANDBOX';
  return { ...c, isSandbox, sandboxToolsEnabled: isSandbox && !isProd };
}

export const CONFIG = Symbol('CONFIG');
