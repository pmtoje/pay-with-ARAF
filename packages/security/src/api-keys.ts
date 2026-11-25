import { hmacSha256Hex, randomBase62, safeEqual } from './crypto';

/**
 * Partner API secret keys.
 *
 *   sk_test_<40 base62>   sandbox
 *   sk_live_<40 base62>   production
 *
 * Only an HMAC-SHA256 digest (keyed with a server-side pepper) is stored. The first
 * 16 characters are stored as a non-secret lookup prefix. Secrets are displayed once.
 */

export type KeyEnvironment = 'SANDBOX' | 'PRODUCTION';

export const KEY_PREFIX: Record<KeyEnvironment, string> = { SANDBOX: 'sk_test_', PRODUCTION: 'sk_live_' };

export interface GeneratedApiKey {
  secret: string;
  lookupPrefix: string;
  hash: string;
  last4: string;
}

export function generateApiKey(env: KeyEnvironment, pepper: string): GeneratedApiKey {
  const secret = `${KEY_PREFIX[env]}${randomBase62(40)}`;
  return { secret, lookupPrefix: secret.slice(0, 16), hash: hmacSha256Hex(pepper, secret), last4: secret.slice(-4) };
}

export function apiKeyEnvironment(secret: string): KeyEnvironment | null {
  if (secret.startsWith(KEY_PREFIX.SANDBOX)) return 'SANDBOX';
  if (secret.startsWith(KEY_PREFIX.PRODUCTION)) return 'PRODUCTION';
  return null;
}

export function isWellFormedApiKey(secret: string): boolean {
  return /^sk_(test|live)_[0-9A-Za-z]{40}$/.test(secret);
}

export function verifyApiKey(secret: string, pepper: string, storedHash: string): boolean {
  return safeEqual(hmacSha256Hex(pepper, secret), storedHash);
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBase62(40)}`;
}
