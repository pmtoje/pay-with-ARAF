import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { config } from './config';
import { one, query } from './db';
import { newToken, sha256 } from './passwords';

export const SESSION_COOKIE = 'altmall_session';
export const VENDOR_COOKIE = 'altmall_vendor';
const SESSION_DAYS = 7;
const VENDOR_HOURS = 8;

export interface Customer {
  id: string;
  email: string;
  name: string;
  phone: string | null;
}

export async function createSession(customerId: string): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await query('INSERT INTO sessions (token_hash, customer_id, expires_at) VALUES ($1,$2,$3)', [sha256(token), customerId, expires]);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', expires });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  jar.delete(SESSION_COOKIE);
}

export async function currentCustomer(): Promise<Customer | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  try {
    return await one<Customer>(
      `SELECT c.id::text AS id, c.email, c.name, c.phone FROM sessions s JOIN customers c ON c.id = s.customer_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
  } catch (err) {
    console.error('[altmall] session lookup failed', (err as Error).message);
    return null;
  }
}

export async function requireCustomer(next: string): Promise<Customer> {
  const c = await currentCustomer();
  if (!c) redirect(`/login?next=${encodeURIComponent(next)}`);
  return c;
}

/** Only allow same-site relative redirects after sign-in (prevents open redirects). */
export function safeNext(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
}

// ---- Vendor back-office (demo) ----------------------------------------------------------

export async function createVendorSession(): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + VENDOR_HOURS * 3600_000);
  await query('INSERT INTO vendor_sessions (token_hash, expires_at) VALUES ($1,$2)', [sha256(token), expires]);
  (await cookies()).set(VENDOR_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/vendor', expires });
}

export async function isVendor(): Promise<boolean> {
  const token = (await cookies()).get(VENDOR_COOKIE)?.value;
  if (!token || token.length > 100) return false;
  const row = await one('SELECT 1 AS ok FROM vendor_sessions WHERE token_hash = $1 AND expires_at > now()', [sha256(token)]);
  return !!row;
}

export async function requireVendor(): Promise<void> {
  if (!(await isVendor())) redirect('/vendor/login');
}

export async function destroyVendorSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(VENDOR_COOKIE)?.value;
  if (token) await query('DELETE FROM vendor_sessions WHERE token_hash = $1', [sha256(token)]);
  jar.set(VENDOR_COOKIE, '', { httpOnly: true, sameSite: 'strict', path: '/vendor', maxAge: 0 });
}
