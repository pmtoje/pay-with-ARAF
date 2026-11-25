'use client';

import { cn } from '@araf/ui';
import { FilterField, Segmented, filterControl } from './common';

export interface RangeValue { range: string; from: string; to: string }

export const DEFAULT_RANGE: RangeValue = { range: '30d', from: '', to: '' };

const OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export function rangeParams(v: RangeValue): Record<string, string> {
  if (v.range === 'custom') return v.from && v.to ? { range: 'custom', from: v.from, to: v.to } : { range: '30d' };
  return { range: v.range };
}

export function rangeLabel(v: RangeValue): string {
  if (v.range === 'custom') return v.from && v.to ? `${v.from} to ${v.to}` : 'Last 30 days';
  return OPTIONS.find((o) => o.id === v.range)?.label ?? v.range;
}

export function RangeFilter({ value, onChange, className }: { value: RangeValue; onChange: (v: RangeValue) => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>
      <Segmented label="Date range" value={value.range} onChange={(range) => onChange({ ...value, range })} options={OPTIONS} />
      {value.range === 'custom' && (
        <>
          <FilterField label="From">
            {(id) => <input id={id} type="date" className={filterControl} value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />}
          </FilterField>
          <FilterField label="To">
            {(id) => <input id={id} type="date" className={filterControl} value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />}
          </FilterField>
        </>
      )}
    </div>
  );
}
