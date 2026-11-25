'use client';

import type { ReactNode } from 'react';
import { cn } from '@araf/ui';

/** Horizontal bar list: label, proportional bar, value. Accessible as a plain list. */
export function HBarList({ items, format = (v) => v.toLocaleString('en-NG'), empty = 'No data in this period.', tone = 'gold', label }: { items: Array<{ label: ReactNode; value: number; key?: string; href?: string }>; format?: (v: number) => string; empty?: string; tone?: 'gold' | 'ink' | 'danger'; label: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {items.map((it, idx) => (
        <li key={it.key ?? idx} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted" title={typeof it.label === 'string' ? it.label : undefined}>
            {it.href ? <a href={it.href} className="hover:text-fg hover:underline">{it.label}</a> : it.label}
          </span>
          <span className="h-2 rounded-full bg-surface-2" aria-hidden="true">
            <span className={cn('block h-2 rounded-full', tone === 'ink' ? 'bg-fg/70' : tone === 'danger' ? 'bg-danger' : 'bg-gold')} style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
          </span>
          <span className="min-w-[3rem] text-right tabular-nums text-fg">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bar chart with y-axis max and labelled first / middle / last dates. */
export function ColumnChart({ data, label, format = (v) => String(v), height = 200 }: { data: Array<{ label: string; value: number }>; label: string; format?: (v: number) => string; height?: number }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const top = max || 1;
  const mid = data[Math.floor(data.length / 2)];
  return (
    <figure>
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex gap-3">
        <div className="flex flex-col justify-between py-0.5 text-right text-2xs tabular-nums text-subtle" style={{ height }} aria-hidden="true">
          <span>{format(max)}</span>
          <span>{format(0)}</span>
        </div>
        <div className="relative flex-1 border-b border-l border-border" style={{ height }}>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden="true" />
          <div className="absolute inset-0 flex items-end gap-[2px] px-[2px]" role="img" aria-label={label}>
            {data.map((d) => (
              <div key={d.label} className="group relative flex h-full flex-1 items-end">
                <div className={cn('w-full rounded-t-[2px]', d.value > 0 ? 'bg-gold' : 'bg-transparent')} style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value > 0 ? 2 : 0 }} />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink px-1.5 py-0.5 text-2xs text-ink-contrast group-hover:block">
                  {d.label}: {format(d.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-10 text-2xs text-subtle" aria-hidden="true">
        <span>{data[0]?.label}</span>
        {data.length > 4 && <span>{mid?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
