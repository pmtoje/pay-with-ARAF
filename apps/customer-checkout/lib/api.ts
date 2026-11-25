import { ApiError, createApiClient, errorLines } from '@araf/ui';

export type Api = ReturnType<typeof createApiClient>;

export const base = (sessionId: string) => `/api/checkout/sessions/${encodeURIComponent(sessionId)}`;

export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

/** Codes that mean the browser session must be re-established (re-open and/or re-verify). */
export const SESSION_CODES = new Set(['SESSION_EXPIRED', 'CSRF_FAILED', 'UNAUTHENTICATED']);

/** Retry-after hint carried in error details (e.g. OTP_RESEND_COOLDOWN). */
export function retryAfter(err: unknown): number | null {
  if (!(err instanceof ApiError)) return null;
  const v = err.details?.retry_after_seconds;
  return typeof v === 'number' ? v : null;
}

const CHANNEL_LABEL: Record<string, string> = {
  ALTBANK: 'your Alternative Bank account',
  MONO: 'connecting another bank',
  PDF_UPLOAD: 'uploading a bank-issued PDF statement',
};

/**
 * Plain-language description of an API error for customers. Starts from the API's own
 * customer-safe message (errorLines) and adds guidance for the codes the journey expects.
 */
export function describeError(err: unknown): { title: string; lines: string[] } {
  const lines = errorLines(err);
  const code = errorCode(err);
  const [first, ...rest] = lines;
  const extra: string[] = [];
  switch (code) {
    case 'STATEMENT_COVERAGE_INSUFFICIENT': {
      const alts = ((err as ApiError).details?.alternatives as string[] | undefined) ?? [];
      if (alts.length) extra.push(`You can try ${alts.map((a) => CHANNEL_LABEL[a] ?? a.toLowerCase()).join(' or ')} instead.`);
      break;
    }
    case 'STATEMENT_OWNERSHIP_MISMATCH':
      extra.push('Please use a statement for an account held in your own name.');
      break;
    case 'PDF_INVALID':
      extra.push('Download the statement directly from your bank (not a scan, photo or edited copy) and try again.');
      return { title: first, lines: extra };
    case 'PDF_ENCRYPTED':
    case 'PDF_TOO_LARGE':
    case 'DUPLICATE_DOCUMENT':
      break;
    case 'MALWARE_DETECTED':
      extra.push('Please download a fresh copy of the statement from your bank, or choose another option.');
      break;
    case 'OTP_INVALID': {
      const left = (err as ApiError).details?.attempts_remaining;
      if (typeof left === 'number') extra.push(`${left} attempt${left === 1 ? '' : 's'} remaining.`);
      break;
    }
    case 'OTP_RESEND_COOLDOWN': {
      const s = retryAfter(err);
      if (s) extra.push(`You can request a new code in ${s} seconds.`);
      break;
    }
    case 'PRECONDITIONS_NOT_MET':
      return { title: 'Not ready yet', lines: [first] };
    case 'RATE_LIMITED':
      break;
    case 'HTTP_ERROR':
      return { title: 'Something went wrong', lines: ['We could not reach the service. Please check your connection and try again.'] };
    default:
      break;
  }
  if (err instanceof TypeError) return { title: 'Connection problem', lines: ['We could not reach the service. Please check your connection and try again.'] };
  return { title: first, lines: [...rest, ...extra] };
}

/**
 * Multipart upload with progress (fetch cannot report upload progress). Mirrors the shared
 * client: same-origin, CSRF header, error envelope → ApiError.
 */
export function uploadWithProgress<T>(path: string, form: FormData, csrf: string | null, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new TypeError('Network error'));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T);
      const e = (data as { error?: { code: string; message: string; details?: Record<string, unknown>; correlation_id?: string } } | null)?.error;
      reject(new ApiError(xhr.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Upload failed (${xhr.status})`, e?.details, e?.correlation_id));
    };
    xhr.send(form);
  });
}

/** Only allow navigation to http(s) URLs (merchant return/cancel links, provider redirects). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
