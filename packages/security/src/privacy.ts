/** Data masking, log redaction and export hardening. */

export function maskBvn(bvn: string): string {
  return bvn.length >= 4 ? `•••••••${bvn.slice(-4)}` : '•••••••••••';
}

export function maskAccountNumber(acct: string): string {
  return acct.length >= 4 ? `••••••${acct.slice(-4)}` : '••••••••••';
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return '•••••••';
  return `${phone.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}•••••${digits.slice(-3)}`;
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return '•••';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

const SENSITIVE_KEYS = [
  'bvn',
  'otp',
  'code',
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'accountnumber',
  'account_number',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'apikey',
  'api_key',
  'pin',
  'statement',
  'transactions',
  'salary',
  'income',
  'score',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-\s]/g, '');
  return SENSITIVE_KEYS.some((s) => k === s || k.endsWith(s) || k.includes(s.replace('_', '')));
}

/** Deep-redact sensitive values for logs and integration traces. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    // Scrub 11-digit sequences (possible BVN/NIN) and long digit runs (account numbers).
    return value.replace(/\b\d{10,11}\b/g, '[REDACTED_NUMBER]');
  }
  return value;
}

/** Neutralise spreadsheet formula injection (CSV/Excel exports). */
export function escapeSpreadsheetCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeSpreadsheetCell).join(',')).join('\r\n');
}
