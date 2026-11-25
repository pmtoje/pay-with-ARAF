import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FieldEncryptor,
  UnsafeUrlError,
  buildSignatureHeader,
  escapeSpreadsheetCell,
  generateApiKey,
  generateNumericOtp,
  hashOtp,
  hashPassword,
  isPrivateAddress,
  isWellFormedApiKey,
  maskBvn,
  redact,
  resolveSafeTarget,
  signStateToken,
  totpAt,
  validateUrlSyntax,
  verifyApiKey,
  verifyOtp,
  verifyPassword,
  verifyStateToken,
  verifyTotp,
  verifyWebhookSignature,
  generateTotpSecret,
} from '../src';

describe('webhook signatures', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ event_id: 'evt_1', event: 'goods.release_authorized' });
  const now = 1_800_000_000;

  it('verifies a valid signature over the exact raw body', () => {
    const header = buildSignatureHeader([secret], now, body);
    expect(verifyWebhookSignature(body, header, secret, now)).toEqual({ valid: true, timestamp: now });
  });
  it('rejects a modified body', () => {
    const header = buildSignatureHeader([secret], now, body);
    expect(verifyWebhookSignature(body.replace('goods', 'g00ds'), header, secret, now)).toMatchObject({ valid: false, reason: 'SIGNATURE_MISMATCH' });
  });
  it('rejects forged signatures with another secret', () => {
    const header = buildSignatureHeader(['whsec_attacker'], now, body);
    expect(verifyWebhookSignature(body, header, secret, now).valid).toBe(false);
  });
  it('rejects replays outside the tolerance window', () => {
    const header = buildSignatureHeader([secret], now - 301, body);
    expect(verifyWebhookSignature(body, header, secret, now)).toMatchObject({ reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' });
  });
  it('accepts any of multiple signatures during secret rotation', () => {
    const header = buildSignatureHeader(['whsec_old', secret], now, body);
    expect(verifyWebhookSignature(body, header, secret, now).valid).toBe(true);
  });
  it('rejects malformed headers', () => {
    expect(verifyWebhookSignature(body, 't=abc,v1=zz', secret, now)).toMatchObject({ reason: 'MISSING_OR_MALFORMED_HEADER' });
    expect(verifyWebhookSignature(body, undefined, secret, now).valid).toBe(false);
  });
});

describe('API keys', () => {
  const pepper = 'pepper';
  it('generates environment-prefixed keys and verifies by hash only', () => {
    const k = generateApiKey('SANDBOX', pepper);
    expect(k.secret.startsWith('sk_test_')).toBe(true);
    expect(isWellFormedApiKey(k.secret)).toBe(true);
    expect(k.hash).not.toContain(k.secret);
    expect(verifyApiKey(k.secret, pepper, k.hash)).toBe(true);
    expect(verifyApiKey(k.secret + 'x', pepper, k.hash)).toBe(false);
    expect(generateApiKey('PRODUCTION', pepper).secret.startsWith('sk_live_')).toBe(true);
  });
});

describe('field encryption', () => {
  const keyA = randomBytes(32).toString('base64');
  const keyB = randomBytes(32).toString('base64');
  it('round-trips and authenticates', () => {
    const enc = new FieldEncryptor({ k1: keyA }, 'k1');
    const ct = enc.encrypt('22212345678', 'customer:1');
    expect(ct).not.toContain('22212345678');
    expect(enc.decrypt(ct, 'customer:1')).toBe('22212345678');
    expect(() => enc.decrypt(ct, 'customer:2')).toThrow();
    const tampered = ct.slice(0, -4) + (ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => enc.decrypt(tampered, 'customer:1')).toThrow();
  });
  it('supports key rotation (old ciphertexts remain readable)', () => {
    const old = new FieldEncryptor({ k1: keyA }, 'k1').encrypt('x');
    const rotated = new FieldEncryptor({ k1: keyA, k2: keyB }, 'k2');
    expect(rotated.decrypt(old)).toBe('x');
    expect(rotated.encrypt('y').startsWith('enc:k2:')).toBe(true);
  });
  it('encrypts binary blobs', () => {
    const enc = new FieldEncryptor({ k1: keyA }, 'k1');
    const data = Buffer.from('%PDF-1.4 test');
    expect(enc.decryptBuffer(enc.encryptBuffer(data)).equals(data)).toBe(true);
  });
});

describe('passwords, OTP, TOTP, state tokens', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(await verifyPassword('Correct-Horse-9', h)).toBe(true);
    expect(await verifyPassword('Correct-Horse-8', h)).toBe(false);
  });
  it('OTPs are hashed per challenge and verified in constant time', () => {
    const code = generateNumericOtp();
    expect(code).toMatch(/^\d{6}$/);
    const h = hashOtp(code, 'ch_1', 'pep');
    expect(verifyOtp(code, 'ch_1', 'pep', h)).toBe(true);
    expect(verifyOtp(code, 'ch_2', 'pep', h)).toBe(false); // bound to the challenge
    expect(verifyOtp('abc', 'ch_1', 'pep', h)).toBe(false);
  });
  it('TOTP matches RFC 6238 test vector', () => {
    // RFC 6238 SHA1 secret "12345678901234567890" at T=59s → 94287082 (8 digits) → 287082 (6 digits)
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(verifyTotp(secret, '287082', 59_000)).not.toBeNull();
    expect(verifyTotp(secret, '000000', 59_000)).toBeNull();
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('state tokens are signed and expire', () => {
    const t = signStateToken({ ref: 'AO-1' }, 'k', 60, 1_000_000);
    expect(verifyStateToken<{ ref: string }>(t, 'k', 1_000_000)?.ref).toBe('AO-1');
    expect(verifyStateToken(t, 'other', 1_000_000)).toBeNull();
    expect(verifyStateToken(t, 'k', 1_000_000 + 61_000)).toBeNull();
    expect(verifyStateToken(t.replace(/^./, 'x'), 'k', 1_000_000)).toBeNull();
  });
});

describe('SSRF protection', () => {
  const strict = { allowHttp: false, allowPrivateNetworks: false };
  it.each(['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    '%s is private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it('8.8.8.8 is public', () => expect(isPrivateAddress('8.8.8.8')).toBe(false));
  it.each([
    ['http://example.com/hook', 'HTTPS_REQUIRED'],
    ['https://user:pw@example.com/hook', 'CREDENTIALS_IN_URL'],
    ['https://localhost/hook', 'PRIVATE_HOSTNAME'],
    ['https://169.254.169.254/latest/meta-data', 'PRIVATE_ADDRESS'],
    ['https://example.com:22/hook', 'PORT_NOT_ALLOWED'],
    ['gopher://example.com', 'HTTPS_REQUIRED'],
  ])('rejects %s', (url, code) => {
    expect(() => validateUrlSyntax(url, strict)).toThrow(new UnsafeUrlError(code));
  });
  it('rejects hostnames that resolve to private addresses (DNS rebinding)', async () => {
    const rebinding = async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '127.0.0.1', family: 4 as const }];
    await expect(resolveSafeTarget('https://partner.example/hook', strict, rebinding)).rejects.toThrow('RESOLVES_TO_PRIVATE_ADDRESS');
    const ok = async () => [{ address: '93.184.216.34', family: 4 as const }];
    await expect(resolveSafeTarget('https://partner.example/hook', strict, ok)).resolves.toMatchObject({ address: '93.184.216.34' });
  });
  it('permits private targets only when explicitly allowed (local sandbox)', async () => {
    const t = await resolveSafeTarget('http://127.0.0.1:3005/hook', { allowHttp: true, allowPrivateNetworks: true });
    expect(t.address).toBe('127.0.0.1');
  });
});

describe('privacy', () => {
  it('masks BVNs', () => expect(maskBvn('22212345678')).toBe('•••••••5678'));
  it('redacts sensitive keys and digit runs', () => {
    const out = redact({ bvn: '22212345678', nested: { otp: '123456', note: 'acct 0123456789' }, amount: 5 }) as any;
    expect(out.bvn).toBe('[REDACTED]');
    expect(out.nested.otp).toBe('[REDACTED]');
    expect(out.nested.note).toBe('acct [REDACTED_NUMBER]');
    expect(out.amount).toBe(5);
  });
  it('neutralises spreadsheet formula injection', () => {
    expect(escapeSpreadsheetCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeSpreadsheetCell('+1')).toBe(`'+1`);
    expect(escapeSpreadsheetCell('@SUM')).toBe(`'@SUM`);
    expect(escapeSpreadsheetCell('plain')).toBe('plain');
  });
});
