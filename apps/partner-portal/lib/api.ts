'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createApiClient } from '@araf/ui';

const PUBLIC_PATHS = ['/login', '/invite'];

/** Browser API client: same-origin proxy, HttpOnly session cookie, double-submit CSRF. */
export const api = createApiClient({
  csrfCookie: 'araf_csrf_partner',
  onUnauthenticated: (err) => {
    if (typeof window === 'undefined') return;
    if (PUBLIC_PATHS.some((p) => window.location.pathname.startsWith(p))) return;
    if (!['UNAUTHENTICATED', 'SESSION_EXPIRED', 'MFA_REQUIRED'].includes(err.code)) return;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  },
});

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** Fetch `path` (null = skip). Keeps the previous data while reloading so tables don't flash. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    const id = ++latest.current;
    setLoading(true);
    setError(undefined);
    api
      .get<T>(path)
      .then((d) => {
        if (id === latest.current) setData(d);
      })
      .catch((e) => {
        if (id === latest.current) setError(e);
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (!code || e.code === code);
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
