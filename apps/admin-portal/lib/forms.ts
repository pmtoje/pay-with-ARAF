import { ApiError } from '@araf/ui';

/** Map API validation errors (details.fields[].path) to a field → message record. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const fields = (err.details?.fields as Array<{ path: string; message: string }> | undefined) ?? [];
  const out: Record<string, string> = {};
  for (const f of fields) {
    const key = f.path.split('.')[0];
    if (!out[key]) out[key] = f.message;
  }
  return out;
}

export function toInt(v: string): number | undefined {
  const n = Number(v.replace(/[,\s]/g, ''));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : Math.trunc(n);
}
