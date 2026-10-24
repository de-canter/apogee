import type { FilterFn } from '@tanstack/react-table';
import type { FilterType } from '../types/column';

export interface DateRangeValue { from?: string | undefined; to?: string | undefined }
export interface NumberRangeValue { min?: number | undefined; max?: number | undefined }

const textOf = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const dayOf = (v: unknown): string | null => {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
  return null;
};

/** Default column filter functions per `filterType`; a column's own `filterFn` still wins. */
export const filterFns: Record<'text' | 'select' | 'boolean' | 'dateRange' | 'numberRange', FilterFn<unknown>> = {
  text: (row, columnId, value) => {
    const needle = textOf(value).trim().toLowerCase();
    if (!needle) return true;
    return textOf(row.getValue(columnId)).toLowerCase().includes(needle);
  },
  select: (row, columnId, value) => {
    if (value === undefined || value === null || value === '') return true;
    const cell = textOf(row.getValue(columnId));
    if (Array.isArray(value)) return value.length === 0 || value.map(textOf).includes(cell);
    return cell === textOf(value);
  },
  boolean: (row, columnId, value) => {
    if (value === undefined || value === null) return true;
    return Boolean(row.getValue(columnId)) === Boolean(value);
  },
  dateRange: (row, columnId, value) => {
    const r = (value ?? {}) as DateRangeValue;
    if (!r.from && !r.to) return true;
    const day = dayOf(row.getValue(columnId));
    if (!day) return false;
    if (r.from && day < r.from) return false;
    if (r.to && day > r.to) return false;
    return true;
  },
  numberRange: (row, columnId, value) => {
    const r = (value ?? {}) as NumberRangeValue;
    if (r.min === undefined && r.max === undefined) return true;
    const raw = row.getValue(columnId);
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return false;
    if (r.min !== undefined && n < r.min) return false;
    if (r.max !== undefined && n > r.max) return false;
    return true;
  },
};

export function filterFnFor(type: FilterType | undefined): FilterFn<unknown> | undefined {
  switch (type) {
    case 'text': return filterFns.text;
    case 'select': return filterFns.select;
    case 'boolean': return filterFns.boolean;
    case 'date-range': return filterFns.dateRange;
    case 'number-range': return filterFns.numberRange;
    default: return undefined;
  }
}
