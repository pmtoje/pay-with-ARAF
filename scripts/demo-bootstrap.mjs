#!/usr/bin/env node
/**
 * Sandbox demo bootstrap — performs Definition-of-Done steps 1–4 through the REAL APIs:
 *   1. Onboarding officer creates AltMall (marketplace), configuration, vendors and settlement accounts
 *   2. A different user (partner approving officer) approves partner + vendor accounts (maker-checker)
 *   3. AltMall's administrator accepts the invitation, enrols TOTP MFA, signs in
 *   4. AltMall creates a sandbox secret key and configures its webhook endpoint
 * Writes apps/altmall-demo/.env.local and SANDBOX_CREDENTIALS.local.md (both git-ignored).
 *
 * Usage: node scripts/demo-bootstrap.mjs   (API must be running; refuses to run in production)
 */
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const envFile = process.env.ARAF_ENV_FILE ?? '.env';
const envPath = resolve(root, envFile);
if (!existsSync(envPath)) throw new Error(`Environment file not found: ${envFile} (create it or set ARAF_ENV_FILE)`);
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^'(.*)'$/, '$1')]),
);
if (env.APP_ENV === 'production') throw new Error('Refusing to bootstrap synthetic demo data in production.');
const API = process.env.ARAF_API_URL ?? env.PUBLIC_API_URL ?? 'http://localhost:4000';
const ALTMALL = (process.env.ALTMALL_URL ?? env.ALTMALL_URL ?? 'http://localhost:3005').replace(/\/$/, '');
const ALTMALL_DB =
  process.env.ALTMALL_DATABASE_URL ??
  env.ALTMALL_DATABASE_URL ??
  (env.DATABASE_URL ? env.DATABASE_URL.replace(/\/[^/]+$/, '/altmall') : 'postgresql://araf:araf_local_dev@localhost:5432/altmall');
const ALTMALL_DB_SCHEMA = (process.env.ALTMALL_DB_SCHEMA ?? env.ALTMALL_DB_SCHEMA ?? '').trim();
if (!process.env.ALTMALL_DATABASE_URL && !env.ALTMALL_DATABASE_URL && /supabase/i.test(env.DATABASE_URL ?? '')) {
  console.warn(
    'ALTMALL_DATABASE_URL is not set; deriving a /altmall database path. ' +
      'For a single Supabase project, set ALTMALL_DATABASE_URL to the altmall role/schema connection string.',
  );
}
const DOMAIN = 'sandbox.altbank.example';

// ---- Minimal TOTP (RFC 6238) ---------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32encode = (buf) => {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
const b32decode = (s) => {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
const used = new Map();
function totp(secret) {
  let step = Math.floor(Date.now() / 30000);
  if ((used.get(secret) ?? -1) >= step) step = used.get(secret) + 1;
  used.set(secret, step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const staffSecret = (email) => b32encode(Buffer.from(createHash('sha256').update(`araf-sandbox-totp:${email}`).digest('hex').slice(0, 40), 'hex'));

// ---- HTTP session helper -----------------------------------------------------------------------
class Session {
  cookies = new Map();
  csrf = '';
  async req(method, path, body, headers = {}) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  async login(portal, email, password, secret) {
    await this.req('POST', `/api/auth/${portal}/login`, { email, password });
    this.csrf = decodeURIComponent(this.cookies.get(`araf_csrf_${portal}`) ?? '');
    const r = await this.req('POST', `/api/auth/${portal}/mfa`, { code: totp(secret) });
    this.csrf = r.csrf_token;
    return this;
  }
}

const staff = (who) => new Session().login('admin', `${who}@${DOMAIN}`, 'Sandbox-Pass-2026!', staffSecret(`${who}@${DOMAIN}`));

async function main() {
  const health = await fetch(`${API}/health/ready`).then((r) => r.json()).catch(() => null);
  if (!health || health.status !== 'ready') throw new Error(`API not ready at ${API}`);
  console.log(`API ready (${health.environment}).`);

  const maker = await staff('onboarding');
  const checker = await staff('partner.approver');
  const existing = (await maker.req('GET', '/api/admin/partners?q=AltMall')).find((p) => p.trading_name === 'AltMall');
  if (existing && existing.status === 'SANDBOX_ACTIVE' && existsSync(resolve(root, 'apps/altmall-demo/.env.local'))) {
    // Upgrade sandboxes onboarded before customer equity and per-annum product pricing (maker-checker).
    const detail = await maker.req('GET', `/api/admin/partners/${existing.id}`);
    const active = detail.configurations.find((c) => c.status === 'ACTIVE');
    if (active && (!active.partial_financing_enabled || active.annual_profit_rate_percent !== 25)) {
      const proposed = await maker.req('POST', `/api/admin/partners/${existing.id}/configuration`, {
        min_transaction_naira: active.min_transaction_kobo / 100,
        max_transaction_naira: active.max_transaction_kobo / 100,
        permitted_products: active.permitted_products,
        permitted_tenors: active.permitted_tenors.filter((t) => t <= 24),
        eligible_categories: active.eligible_categories,
        application_expiry_minutes: active.application_expiry_minutes,
        order_reservation_minutes: active.order_reservation_minutes,
        partial_financing_enabled: true,
        annual_profit_rate_percent: 25,
        allow_multiple_vendors: active.allow_multiple_vendors,
        settlement_arrangement: active.settlement_arrangement,
        return_url_origins: detail.domains.filter((d) => d.kind === 'RETURN_URL_ORIGIN').map((d) => d.value),
      });
      const approval = (await checker.req('GET', '/api/admin/approvals?status=PENDING')).find((x) => x.resource_id === proposed.id);
      if (approval) await checker.req('POST', `/api/admin/approvals/${approval.id}/decide`, { decision: 'APPROVE', comment: 'Customer equity and 25% p.a. product rate for the sandbox demo (checker).' });
      console.log(`AltMall configuration v${proposed.version}: customer equity enabled, 25% p.a. (maker-checker approved).`);
      return;
    }
    console.log('AltMall is already onboarded and configured. Nothing to do.');
    return;
  }
  const adminEmail = `admin@altmall-demo.example`;
  let partnerId = existing?.id;
  if (!partnerId) {
    const p = await maker.req('POST', '/api/admin/partners', {
      registered_name: 'AltMall Online Marketplace Ltd (Demo)',
      trading_name: 'AltMall',
      registration_number: 'RC-DEMO-000001',
      business_type: 'Limited liability company',
      partner_type: 'MARKETPLACE',
      website_url: ALTMALL,
      business_address: '1 Demo Avenue, Victoria Island, Lagos',
      business_category: 'E-commerce marketplace',
      contact_name: 'AltMall Demo Administrator',
      contact_email: adminEmail,
      contact_phone: '+2348000000001',
      technical_contact_name: 'AltMall Engineering',
      technical_contact_email: 'engineering@altmall-demo.example',
      risk_classification: 'LOW',
    });
    partnerId = p.id;
    await maker.req('POST', `/api/admin/partners/${partnerId}/configuration`, {
      min_transaction_naira: 20000,
      max_transaction_naira: 5000000,
      permitted_products: ['MURABAHA_ASSET_FINANCING'],
      permitted_tenors: [3, 6, 9, 12, 18, 24],
      eligible_categories: ['smartphones', 'laptops', 'televisions', 'refrigerators', 'washing-machines', 'furniture', 'solar', 'electronics', 'appliances'],
      application_expiry_minutes: 1440,
      order_reservation_minutes: 4320,
      partial_financing_enabled: true, // customer equity (down payment to AltMall)
      annual_profit_rate_percent: 25, // AltMall product rate: 25% per annum
      allow_multiple_vendors: false,
      settlement_arrangement: 'DIRECT_TO_VENDOR',
      return_url_origins: [ALTMALL],
    });
    const vendors = [
      { vendor_reference: 'VENDOR-LEKKI-ELEC', name: 'Lekki Electronics Ltd', categories: ['smartphones', 'laptops', 'televisions', 'electronics'], acct: '0123456781' },
      { vendor_reference: 'VENDOR-IKEJA-HOME', name: 'Ikeja Home Appliances Ltd', categories: ['refrigerators', 'washing-machines', 'appliances'], acct: '0123456782' },
      { vendor_reference: 'VENDOR-ABUJA-FURN', name: 'Abuja Fine Furniture Ltd', categories: ['furniture'], acct: '0123456783' },
      { vendor_reference: 'VENDOR-KANO-SOLAR', name: 'Kano Solar Systems Ltd', categories: ['solar'], acct: '0123456784' },
    ];
    for (const v of vendors) {
      const created = await maker.req('POST', `/api/admin/partners/${partnerId}/vendors`, { vendor_reference: v.vendor_reference, name: v.name, categories: v.categories });
      await maker.req('POST', `/api/admin/partners/${partnerId}/vendors/${created.id}/settlement-accounts`, { bank_code: '058', bank_name: 'Sandbox Bank', account_number: v.acct, account_name: v.name.toUpperCase() });
    }
    await maker.req('POST', `/api/admin/partners/${partnerId}/submit`, { comment: 'Demo onboarding: KYB documents verified (synthetic).' });
    console.log('1. AltMall created and submitted by the onboarding officer (maker).');
  }
  const pending = (await checker.req('GET', '/api/admin/approvals?status=PENDING')).filter((a) => a.partner_id === partnerId);
  for (const a of pending.sort((x) => (x.type === 'PARTNER_APPROVAL' ? 1 : -1))) {
    await checker.req('POST', `/api/admin/approvals/${a.id}/decide`, { decision: 'APPROVE', comment: 'Approved for sandbox demonstration (checker).' });
  }
  console.log('2. Partner and vendor settlement accounts approved by the partner approving officer (checker).');

  // 3. Invitation (delivered to the sandbox inbox) → accept → enrol MFA → sign in.
  const inbox = await checker.req('GET', `/api/sandbox/inbox?destination=${encodeURIComponent(adminEmail)}`);
  const token = /invite\/(inv_[A-Za-z0-9]+)/.exec(inbox[0]?.body ?? '')?.[1];
  if (!token) throw new Error('Invitation not found in sandbox inbox');
  const anon = new Session();
  const password = 'AltMall-Demo-2026!';
  const { totp_secret } = await anon.req('POST', `/api/auth/invitations/${token}/accept`, { password });
  await anon.req('POST', `/api/auth/invitations/${token}/activate`, { code: totp(totp_secret) });
  await new Promise((r) => setTimeout(r, 31000)); // next TOTP step (replay protection)
  const partner = await new Session().login('partner', adminEmail, password, totp_secret);
  console.log('3. AltMall administrator accepted the invitation, enrolled TOTP and signed in.');

  // 4. API key + webhook endpoint.
  const key = await partner.req('POST', '/api/partner-portal/credentials', {
    name: 'AltMall storefront server',
    scopes: ['checkout:write', 'checkout:read', 'applications:read', 'orders:read', 'orders:write', 'settlements:read', 'webhooks:read', 'webhooks:write'],
  });
  const hook = await partner.req('POST', '/api/partner-portal/webhooks', { url: `${ALTMALL}/api/araf/webhooks`, description: 'AltMall order updates', events: [] });
  console.log('4. Sandbox secret key created and webhook endpoint configured.');

  writeFileSync(
    resolve(root, 'apps/altmall-demo/.env.local'),
    [
      '# Generated by scripts/demo-bootstrap.mjs — SANDBOX credentials only. Never commit.',
      `ARAF_API_URL=${API}`,
      `ARAF_SECRET_KEY=${key.secret}`,
      `ARAF_WEBHOOK_SECRET=${hook.signing_secret}`,
      `ALTMALL_URL=${ALTMALL}`,
      `ALTMALL_DATABASE_URL=${ALTMALL_DB}`,
      ...(ALTMALL_DB_SCHEMA ? [`ALTMALL_DB_SCHEMA=${ALTMALL_DB_SCHEMA}`] : []),
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  writeFileSync(
    resolve(root, 'SANDBOX_CREDENTIALS.local.md'),
    [
      '# Sandbox credentials (local only — git-ignored)',
      '',
      `Partner portal: ${env.PARTNER_PORTAL_URL}`,
      `- Email: ${adminEmail}`,
      `- Password: ${password}`,
      `- TOTP secret (add to an authenticator app, or run \`node scripts/totp.mjs ${totp_secret}\`): ${totp_secret}`,
      '',
      `AltMall API key prefix: ${key.prefix}… (full key in apps/altmall-demo/.env.local)`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  console.log('Wrote apps/altmall-demo/.env.local and SANDBOX_CREDENTIALS.local.md');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
