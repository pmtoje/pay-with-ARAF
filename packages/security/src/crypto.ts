import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(key: string | Buffer, input: string | Buffer): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still perform a comparison of equal length to avoid an early-exit timing signal.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Unbiased random base62 string. */
export function randomBase62(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE62[randomInt(0, 62)];
  return out;
}

export function randomToken(prefix: string, length = 24): string {
  return `${prefix}${randomBase62(length)}`;
}

// ---- Passwords (scrypt, OWASP-recommended parameters) ------------------------------

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new RangeError('Password must be at least 12 characters');
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Basic password policy (length + not trivially weak). */
export function passwordPolicyErrors(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push('Use at least 12 characters.');
  if (password.length > 128) errors.push('Use at most 128 characters.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    errors.push('Use upper-case, lower-case letters and numbers.');
  }
  return errors;
}

// ---- Field-level encryption (AES-256-GCM with key versioning) ---------------------

/**
 * Keyring for envelope-style field encryption. In production the data keys must come
 * from the Bank's managed KMS/HSM; locally they come from environment configuration.
 * Ciphertext format: `enc:<keyId>:<iv b64>:<tag b64>:<ciphertext b64>`
 */
export class FieldEncryptor {
  private readonly keys: Map<string, Buffer>;

  constructor(
    keys: Record<string, string>,
    private readonly activeKeyId: string,
  ) {
    this.keys = new Map(
      Object.entries(keys).map(([id, b64]) => {
        const buf = Buffer.from(b64, 'base64');
        if (buf.length !== 32) throw new RangeError(`Encryption key ${id} must be 32 bytes (base64)`);
        return [id, buf];
      }),
    );
    if (!this.keys.has(activeKeyId)) throw new RangeError('Active encryption key missing from keyring');
  }

  encrypt(plaintext: string, associatedData = ''): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    if (associatedData) cipher.setAAD(Buffer.from(associatedData));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `enc:${this.activeKeyId}:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
  }

  decrypt(payload: string, associatedData = ''): string {
    const parts = payload.split(':');
    if (parts.length !== 5 || parts[0] !== 'enc') throw new Error('Malformed ciphertext');
    const key = this.keys.get(parts[1]);
    if (!key) throw new Error('Unknown encryption key id');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64'));
    if (associatedData) decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64')), decipher.final()]).toString('utf8');
  }

  encryptBuffer(data: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    const ct = Buffer.concat([cipher.update(data), cipher.final()]);
    const header = Buffer.from(`${this.activeKeyId}\n`);
    return Buffer.concat([Buffer.from([header.length]), header, iv, cipher.getAuthTag(), ct]);
  }

  decryptBuffer(blob: Buffer): Buffer {
    const headerLen = blob[0];
    const keyId = blob.subarray(1, 1 + headerLen).toString().trim();
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Unknown encryption key id');
    const off = 1 + headerLen;
    const iv = blob.subarray(off, off + 12);
    const tag = blob.subarray(off + 12, off + 28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(blob.subarray(off + 28)), decipher.final()]);
  }
}

/** Deterministic keyed lookup index (blind index) for exact-match search on encrypted values. */
export function blindIndex(indexKey: string, value: string): string {
  return hmacSha256Hex(indexKey, value.trim());
}

// ---- One-time passwords --------------------------------------------------------------

export function generateNumericOtp(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

export function hashOtp(code: string, challengeId: string, pepper: string): string {
  return hmacSha256Hex(pepper, `${challengeId}:${code}`);
}

export function verifyOtp(code: string, challengeId: string, pepper: string, storedHash: string): boolean {
  if (!/^\d{4,8}$/.test(code)) return false;
  return safeEqual(hashOtp(code, challengeId, pepper), storedHash);
}

// ---- Signed, short-lived state tokens -----------------------------------------------

export function signStateToken(payload: Record<string, unknown>, key: string, ttlSeconds: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

export function verifyStateToken<T = Record<string, unknown>>(token: string, key: string, now = Date.now()): T | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { exp: number } & T;
    if (typeof data.exp !== 'number' || data.exp < Math.floor(now / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}
