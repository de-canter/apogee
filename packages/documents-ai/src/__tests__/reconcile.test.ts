import { assertion, isoDate, ref } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { confidence } from '../confidence';
import type { FieldAssertion } from '../extract';
import { fuzzyMatch, reconcile, sameDay, withinTolerance, type ReconcileSource } from '../reconcile';

const at = isoDate('2026-09-19T12:00:00Z');
function source(code: string, id: string, values: Record<string, [unknown, number]>): ReconcileSource {
  const subject = ref('Document', id);
  const fields: FieldAssertion[] = Object.entries(values).map(([field, [value, c]]) => ({
    field, value, confidence: confidence(c),
    assertion: assertion({ id: `${id}-${field}`, subject, predicate: `field:${field}`, object: value, provenance: { source: { kind: 'ai' }, confidence: c, recordedAt: at } }),
  }));
  return { code, subject, fields };
}

describe('helpers', () => {
  it('fuzzyMatch tolerates case, spacing, substrings, and suffixes', () => {
    expect(fuzzyMatch('Northside Builders', 'NORTHSIDE  builders')).toBe(true);
    expect(fuzzyMatch('Northside Builders', 'Northside Builders LLC')).toBe(true);
    expect(fuzzyMatch('Sam Ortiz Jr.', 'Sam Ortiz')).toBe(true);
    expect(fuzzyMatch('Northside Builders', 'Ridge Landscaping')).toBe(false);
  });
  it('withinTolerance is relative and handles zero', () => {
    expect(withinTolerance(2260, 2250, 0.01)).toBe(true);
    expect(withinTolerance(2400, 2250, 0.01)).toBe(false);
    expect(withinTolerance(0, 0, 0.01)).toBe(true);
    expect(withinTolerance(1, 0, 0.01)).toBe(false);
  });
  it('sameDay compares calendar days', () => {
    expect(sameDay('2026-09-21', '2026-09-21T00:00:00Z')).toBe(true);
    expect(sameDay('2026-09-21', '2026-09-22')).toBe(false);
  });
});

describe('reconcile', () => {
  const agreement = source('agreement', 'a1', { customerName: ['Northside Builders', 0.95], total: [2250, 0.8], startDate: ['2026-09-21', 0.9], serial: ['EXC-1000', 0.99] });
  const invoice = source('invoice', 'i1', { customerName: ['NORTHSIDE BUILDERS LLC', 0.9], total: [2260, 0.85], startDate: ['2026-09-21T00:00:00Z', 0.7] });

  it('agrees with the right comparators and reports single-source fields', () => {
    const r = reconcile([agreement, invoice], [{ field: 'customerName', compare: 'name' }, { field: 'total', compare: 'number' }, { field: 'startDate', compare: 'date' }]);
    expect(r.documents).toBe(2);
    expect(r.valid).toBe(true);
    expect(r.conflicts).toEqual([]);
    const byField = Object.fromEntries(r.fields.map((f) => [f.field, f]));
    expect(byField['customerName']).toMatchObject({ agreed: true, chosen: { code: 'agreement', value: 'Northside Builders', reason: 'agreed' } });
    expect(byField['total']).toMatchObject({ agreed: true, chosen: { code: 'invoice', value: 2260, reason: 'agreed' } });
    expect(byField['startDate']!.agreed).toBe(true);
    expect(byField['serial']).toMatchObject({ agreed: true, chosen: { code: 'agreement', value: 'EXC-1000', reason: 'only' } });
    expect(byField['total']!.values).toEqual([{ code: 'agreement', subject: agreement.subject, value: 2250, confidence: 0.8 }, { code: 'invoice', subject: invoice.subject, value: 2260, confidence: 0.85 }]);
  });

  it('reports conflicts with severity, prefers a code, and falls back to confidence', () => {
    const far = source('invoice', 'i2', { total: [2400, 0.85], customerName: ['Ridge Landscaping', 0.6] });
    const r = reconcile([agreement, far], [{ field: 'total', compare: 'number', severity: 'error', preferCode: 'agreement' }, { field: 'customerName', compare: 'name' }]);
    expect(r.valid).toBe(false);
    expect(r.conflicts.map((c) => c.field).sort()).toEqual(['customerName', 'total']);
    const total = r.conflicts.find((c) => c.field === 'total')!;
    expect(total).toMatchObject({ agreed: false, severity: 'error', chosen: { code: 'agreement', value: 2250, reason: 'preferred' } });
    const name = r.conflicts.find((c) => c.field === 'customerName')!;
    expect(name).toMatchObject({ severity: 'warning', chosen: { code: 'agreement', value: 'Northside Builders', reason: 'highest-confidence' } });
  });

  it('defaults to trimmed case-insensitive text and accepts a custom comparator', () => {
    const a = source('a', 'a', { x: [' Hello ', 0.9], y: [10, 0.9] });
    const b = source('b', 'b', { x: ['hello', 0.9], y: [12, 0.9] });
    const r = reconcile([a, b], [{ field: 'y', compare: (p, q) => Math.abs((p as number) - (q as number)) <= 2 }]);
    expect(r.fields.every((f) => f.agreed)).toBe(true);
    const exact = reconcile([a, b], [{ field: 'x', compare: 'exact' }]);
    expect(exact.conflicts.map((c) => c.field)).toEqual(['x', 'y']);
  });
});
