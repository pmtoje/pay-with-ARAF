'use server';

import { redirect } from 'next/navigation';
import { createSession, destroySession, safeNext } from '@/lib/auth';
import { one } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/passwords';
import { toE164 } from '@/lib/orders';

export interface AuthState {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const email = str(form, 'email').toLowerCase();
  const password = String(form.get('password') ?? '');
  const next = safeNext(form.get('next'));
  const fields: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
  if (!password) fields.password = 'Enter your password.';
  if (Object.keys(fields).length) return { fields, values: { email } };
  const row = await one<{ id: string; password_hash: string }>('SELECT id::text AS id, password_hash FROM customers WHERE email = $1', [email]);
  // Always run scrypt to keep timing similar for unknown accounts.
  const ok = row ? await verifyPassword(password, row.password_hash) : (await verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'), false);
  if (!row || !ok) return { error: 'The email or password is incorrect.', values: { email } };
  await createSession(row.id);
  redirect(next);
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const name = str(form, 'name');
  const email = str(form, 'email').toLowerCase();
  const phone = str(form, 'phone');
  const password = String(form.get('password') ?? '');
  const next = safeNext(form.get('next'));
  const values = { name, email, phone };
  const fields: Record<string, string> = {};
  if (name.length < 2 || name.length > 80) fields.name = 'Enter your full name.';
  if (!EMAIL_RE.test(email) || email.length > 254) fields.email = 'Enter a valid email address.';
  if (phone && !toE164(phone)) fields.phone = 'Enter a Nigerian mobile number, e.g. 0803 123 4567.';
  if (password.length < 10) fields.password = 'Use at least 10 characters.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) fields.password = 'Include at least one letter and one number.';
  if (Object.keys(fields).length) return { fields, values };
  const created = await one<{ id: string }>('INSERT INTO customers (email, name, phone, password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING RETURNING id::text AS id', [
    email,
    name,
    phone ? toE164(phone) : null,
    await hashPassword(password),
  ]);
  if (!created) return { fields: { email: 'An account with this email already exists. Sign in instead.' }, values };
  await createSession(created.id);
  redirect(next);
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect('/');
}
