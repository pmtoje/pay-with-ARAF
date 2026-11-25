import { createHmac } from 'node:crypto';
import { safeEqual } from './crypto';

/**
 * Webhook signing scheme (documented in the developer portal):
 *
 *   ARAF-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *   ARAF-Event-Id:  evt_...
 *   ARAF-Timestamp: <unix seconds>
 *
 * During secret rotation, multiple v1 signatures may be present (one per active secret).
 * Receivers MUST verify against the exact raw request body, use constant-time comparison,
 * enforce a timestamp tolerance and de-duplicate by event ID.
 */

export const SIGNATURE_HEADER = 'ARAF-Signature';
export const EVENT_ID_HEADER = 'ARAF-Event-Id';
export const TIMESTAMP_HEADER = 'ARAF-Timestamp';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function buildSignatureHeader(secrets: string[], timestamp: number, rawBody: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${computeSignature(s, timestamp, rawBody)}`)].join(',');
}

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

export function parseSignatureHeader(header: string | undefined | null): ParsedSignature | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && /^\d+$/.test(v ?? '')) timestamp = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v ?? '')) signatures.push(v);
  }
  return timestamp !== null && signatures.length ? { timestamp, signatures } : null;
}

export type WebhookVerification =
  | { valid: true; timestamp: number }
  | { valid: false; reason: 'MISSING_OR_MALFORMED_HEADER' | 'TIMESTAMP_OUTSIDE_TOLERANCE' | 'SIGNATURE_MISMATCH' };

export function verifyWebhookSignature(
  rawBody: string,
  header: string | undefined | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): WebhookVerification {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { valid: false, reason: 'MISSING_OR_MALFORMED_HEADER' };
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return { valid: false, reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' };
  const expected = computeSignature(secret, parsed.timestamp, rawBody);
  return parsed.signatures.some((s) => safeEqual(s, expected))
    ? { valid: true, timestamp: parsed.timestamp }
    : { valid: false, reason: 'SIGNATURE_MISMATCH' };
}
