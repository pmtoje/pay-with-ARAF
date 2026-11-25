import 'server-only';

/** Server-side configuration. The ARAF secret key and webhook secret never leave the server. */
export const config = {
  arafApiUrl: (process.env.ARAF_API_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
  arafSecretKey: process.env.ARAF_SECRET_KEY ?? '',
  arafWebhookSecret: process.env.ARAF_WEBHOOK_SECRET ?? '',
  altmallUrl: (process.env.ALTMALL_URL ?? 'http://localhost:3005').replace(/\/$/, ''),
  databaseUrl: process.env.ALTMALL_DATABASE_URL ?? 'postgresql://araf:araf_local_dev@localhost:5432/altmall',
  /** Demo back-office password (sandbox only). Override with ALTMALL_VENDOR_PASSWORD. */
  vendorPassword: process.env.ALTMALL_VENDOR_PASSWORD ?? 'Vendor-Demo-2026!',
  webhookToleranceSeconds: 300,
  secureCookies: (process.env.ALTMALL_URL ?? '').startsWith('https://'),
};
