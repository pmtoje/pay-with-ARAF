/**
 * Browser API helper for the portals and hosted checkout.
 *
 * Browser apps call the API through a same-origin proxy (`/api/...`), so session cookies are
 * HttpOnly, SameSite=Strict and never readable by scripts. State-changing requests send the
 * double-submit CSRF token from a readable companion cookie.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly correlationId?: string,
  ) {
    super(message);
  }
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export interface ApiClientOptions {
  /** Name of the readable CSRF cookie, e.g. araf_csrf_admin. */
  csrfCookie?: string;
  /** Explicit CSRF token (e.g. the hosted checkout keeps it in memory). */
  csrfToken?: () => string | null;
  onUnauthenticated?: (err: ApiError) => void;
  /**
   * Safe retries for state-changing requests on slow networks: each POST carries an
   * Idempotency-Key, and timeouts / dropped connections / 5xx / IDEMPOTENCY_IN_PROGRESS are retried
   * with the SAME key so the server can replay the first result instead of acting twice.
   */
  retryWrites?: { attempts?: number; timeoutMs?: number };
}

const newKey = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Thrown when a write could not be confirmed after retries — the caller should re-read state. */
export const NETWORK_UNCERTAIN = 'NETWORK_UNCERTAIN';

export function createApiClient(opts: ApiClientOptions = {}) {
  async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const retry = opts.retryWrites;
    if (!retry || method === 'GET') return once<T>(method, path, body, init);
    const key = newKey();
    const attempts = retry.attempts ?? 4;
    for (let i = 0; ; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), retry.timeoutMs ?? 25_000);
      try {
        return await once<T>(method, path, body, { ...init, signal: ctrl.signal, headers: { ...(init.headers as Record<string, string> | undefined), 'Idempotency-Key': key } });
      } catch (e) {
        const transient = !(e instanceof ApiError) || e.status >= 500 || e.code === 'IDEMPOTENCY_IN_PROGRESS';
        if (!transient) throw e;
        if (i + 1 >= attempts) throw new ApiError(0, NETWORK_UNCERTAIN, 'We could not confirm this step because the connection is slow or was interrupted.');
        await sleep(Math.min(8000, 1000 * 2 ** i));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function once<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      const token = opts.csrfToken?.() ?? (opts.csrfCookie ? readCookie(opts.csrfCookie) : null);
      if (token) headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!res.ok) {
      const e = (data as { error?: { code: string; message: string; details?: Record<string, unknown>; correlation_id?: string } } | null)?.error;
      const err = new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status})`, e?.details, e?.correlation_id);
      if (res.status === 401) opts.onUnauthenticated?.(err);
      throw err;
    }
    return data as T;
  }
  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
  };
}

/** Human-readable detail lines for validation errors. */
export function errorLines(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [(err as Error)?.message ?? 'Unexpected error'];
  const fields = (err.details?.fields as Array<{ path: string; message: string }> | undefined) ?? [];
  const extras = [
    ...fields.map((f) => `${f.path}: ${f.message}`),
    ...(((err.details?.blockers as string[] | undefined) ?? []).map((b) => `Blocked: ${b.replace(/_/g, ' ').toLowerCase()}`)),
    ...(((err.details?.pending as string[] | undefined) ?? []).map((b) => `Pending: ${b.replace(/_/g, ' ').toLowerCase()}`)),
    ...(((err.details?.errors as string[] | undefined) ?? []).map((b) => b.replace(/_/g, ' ').toLowerCase())),
  ];
  return [err.message, ...extras];
}
