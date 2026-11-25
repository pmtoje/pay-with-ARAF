/** Pure formatting helpers (safe to import from server components). */

/** Format integer kobo as Naira. Uses integer maths for the kobo part (no float drift). */
export function formatNaira(kobo: number | null | undefined, opts: { compact?: boolean; noKobo?: boolean } = {}): string {
  if (kobo === null || kobo === undefined || Number.isNaN(kobo)) return '—';
  const negative = kobo < 0;
  const abs = Math.abs(Math.trunc(kobo));
  const naira = Math.trunc(abs / 100);
  const k = abs % 100;
  if (opts.compact && naira >= 1_000_000) {
    const v = naira / 1_000_000;
    return `${negative ? '-' : ''}₦${v >= 100 ? v.toFixed(0) : v.toFixed(1)}m`;
  }
  const body = naira.toLocaleString('en-NG');
  return `${negative ? '-' : ''}₦${body}${opts.noKobo ? '' : `.${String(k).padStart(2, '0')}`}`;
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

