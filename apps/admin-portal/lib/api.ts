'use client';

import { createApiClient, type ApiError } from '@araf/ui';

function redirectToLogin(err: ApiError) {
  if (typeof window === 'undefined') return;
  const p = window.location.pathname;
  if (p.startsWith('/login') || p.startsWith('/invite')) return;
  const next = encodeURIComponent(p + window.location.search);
  window.location.assign(`/login?next=${next}&reason=${encodeURIComponent(err.code)}`);
}

/** API client for signed-in pages: a 401 (session expired / revoked) sends the user to sign in. */
export const api = createApiClient({ csrfCookie: 'araf_csrf_admin', onUnauthenticated: redirectToLogin });

/** API client for the sign-in and invitation flows (401s are handled inline). */
export const authApi = createApiClient({ csrfCookie: 'araf_csrf_admin' });

export function qs(params: Record<string, string | number | boolean | null | undefined | string[]>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}
