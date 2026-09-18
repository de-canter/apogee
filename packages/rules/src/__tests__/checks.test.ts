import { describe, expect, it } from 'vitest';
import { evaluateCheck, evaluateChecks, resolvePath } from '../checks';
import type { StructuredCheck } from '../rule';

const check = (c: Partial<StructuredCheck> & Pick<StructuredCheck, 'field' | 'check'>): StructuredCheck => ({ message: 'm', severity: 'error', ...c });

describe('resolvePath', () => {
  it('walks objects and arrays by dot path', () => {
    expect(resolvePath({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    expect(resolvePath({ a: { b: [{ c: 1 }] } }, 'a.b')).toEqual([{ c: 1 }]);
  });
  it('returns undefined for missing segments and non-objects', () => {
    expect(resolvePath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(resolvePath({ a: null }, 'a.b')).toBeUndefined();
    expect(resolvePath(undefined, 'a')).toBeUndefined();
  });
});

describe('evaluateCheck', () => {
  const cases: Array<[StructuredCheck, unknown, boolean]> = [
    [check({ field: 'x', check: 'exists' }), { x: 0 }, true],
    [check({ field: 'x', check: 'exists' }), { x: null }, false],
    [check({ field: 'x', check: 'not_empty' }), { x: '  ' }, false],
    [check({ field: 'x', check: 'not_empty' }), { x: ['a'] }, true],
    [check({ field: 'x', check: 'not_empty' }), { x: [] }, false],
    [check({ field: 'x', check: 'not_empty' }), { x: 5 }, true],
    [check({ field: 'x', check: 'eq', value: 'open' }), { x: 'open' }, true],
    [check({ field: 'x', check: 'eq', value: 3 }), { x: '3' }, true],
    [check({ field: 'x', check: 'neq', value: 'open' }), { x: 'open' }, false],
    [check({ field: 'x', check: 'gt', value: 2000 }), { x: 2100 }, true],
    [check({ field: 'x', check: 'gt', value: '2000' }), { x: 2100 }, true],
    [check({ field: 'x', check: 'gt', value: 2000 }), { x: '2100' }, false],
    [check({ field: 'x', check: 'gte', value: 5 }), { x: 5 }, true],
    [check({ field: 'x', check: 'lt', value: 5 }), { x: 5 }, false],
    [check({ field: 'x', check: 'lte', value: 5 }), { x: 5 }, true],
    [check({ field: 'x', check: 'matches', value: '^R-\\d+$' }), { x: 'R-12' }, true],
    [check({ field: 'x', check: 'matches', value: '[' }), { x: 'R-12' }, false],
    [check({ field: 'x', check: 'matches', value: 'a' }), { x: 1 }, false],
    [check({ field: 'x', check: 'min_count', value: 2 }), { x: [1, 2] }, true],
    [check({ field: 'x', check: 'min_count', value: 2 }), { x: [1] }, false],
    [check({ field: 'x', check: 'min_count', value: 1 }), { x: 'no' }, false],
    [check({ field: 'x', check: 'max_count', value: 1 }), { x: [1, 2] }, false],
  ];
  it.each(cases)('%o on %o → %s', (c, subject, passed) => {
    expect(evaluateCheck(c, subject).passed).toBe(passed);
  });

  it('carries the actual value, message, and severity', () => {
    const r = evaluateCheck(check({ field: 'notes', check: 'not_empty', message: 'Need a note', severity: 'warning' }), { notes: [] });
    expect(r).toEqual({ field: 'notes', check: 'not_empty', passed: false, message: 'Need a note', severity: 'warning', actual: [] });
  });
});

describe('evaluateChecks', () => {
  it('evaluates each check in order', () => {
    const rs = evaluateChecks([check({ field: 'a', check: 'exists' }), check({ field: 'b', check: 'exists' })], { a: 1 });
    expect(rs.map((r) => r.passed)).toEqual([true, false]);
  });
});
