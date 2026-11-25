'use client';

import { useId, useState, type ReactNode } from 'react';
import { cn } from './primitives';
import { formatNaira } from './format';

export function Money({ kobo, className, compact }: { kobo: number | null | undefined; className?: string; compact?: boolean }) {
  return <span className={cn('tabular-nums', className)}>{formatNaira(kobo, { compact })}</span>;
}

// ---- Tables -------------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  className?: string;
}

/** Accessible data table with optional client-side sorting; scrolls horizontally on small screens. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, caption, empty, dense }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; onRowClick?: (row: T) => void; caption?: string; empty?: ReactNode; dense?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sorted = col?.sortValue ? [...rows].sort((a, b) => (col.sortValue!(a) > col.sortValue!(b) ? sort!.dir : col.sortValue!(a) < col.sortValue!(b) ? -sort!.dir : 0)) : rows;
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className={cn('whitespace-nowrap px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-subtle', c.align === 'right' ? 'text-right' : 'text-left')}>
                {c.sortValue ? (
                  <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                    {c.header}
                    <span aria-hidden="true" className="text-[10px]">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(r)) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-4 align-middle text-fg', dense ? 'py-2' : 'py-3', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted">
      <span>
        {total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <div className="flex gap-2">
        <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

// ---- Charts (accessible SVG; every chart has a data-table fallback) ------------------------

export function BarChart({ data, label, format = (v) => String(v), height = 180 }: { data: Array<{ label: string; value: number }>; label: string; format?: (v: number) => string; height?: number }) {
  const id = useId();
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / Math.max(1, data.length);
  return (
    <figure aria-labelledby={id}>
      <figcaption id={id} className="sr-only">
        {label}
      </figcaption>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={label}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 3 - 2);
          return <rect key={d.label} x={i * barW + barW * 0.18} y={height / 3 - h} width={barW * 0.64} height={Math.max(h, d.value > 0 ? 0.6 : 0)} rx="0.6" className="fill-gold">
            <title>{`${d.label}: ${format(d.value)}`}</title>
          </rect>;
        })}
      </svg>
      <div className="mt-2 flex justify-between text-2xs text-subtle" aria-hidden="true">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th>{d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function FunnelChart({ steps }: { steps: Array<{ label: string; count: number }> }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <ol className="space-y-2" aria-label="Financing funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null;
        const conv = prev ? (s.count / Math.max(prev, 1)) * 100 : null;
        return (
          <li key={s.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-muted">{s.label}</span>
            <span className="h-6 rounded-sm bg-surface-2">
              <span className="block h-6 rounded-sm bg-gold/80" style={{ width: `${(s.count / max) * 100}%` }} />
            </span>
            <span className="w-24 text-right tabular-nums text-fg">
              {s.count}
              {conv !== null && <span className="ml-1 text-2xs text-subtle">{conv.toFixed(0)}%</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums">{(pct * 100).toFixed(0)}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label={label}>
        <div className="h-2 rounded-full bg-gold" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
