import type { ReactNode } from 'react';

/** The display string of an unknown value; objects and functions become '' rather than "[object Object]". */
export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

/** Renders an unknown cell value as text; objects and functions render empty rather than "[object Object]". */
export function asText(value: unknown): ReactNode {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return '';
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asDateInput(value: unknown): string | number | Date | null {
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value;
  return null;
}
