import type { CheckOperator, StructuredCheck } from './rule';

export interface CheckResult {
  field: string;
  check: CheckOperator;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning';
  actual?: unknown;
}

/** Dot path over objects and arrays (`parties.0.name`); undefined when any segment is missing. */
export function resolvePath(subject: unknown, path: string): unknown {
  let cur: unknown = subject;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

function compare(actual: unknown, expected: unknown, op: (a: number, b: number) => boolean): boolean {
  const b = asNumber(expected);
  return typeof actual === 'number' && b !== undefined && op(actual, b);
}

function count(actual: unknown, expected: unknown, op: (len: number, n: number) => boolean): boolean {
  const n = asNumber(expected);
  return Array.isArray(actual) && n !== undefined && op(actual.length, n);
}

function evaluateOperator(op: CheckOperator, actual: unknown, expected: string | number | undefined): boolean {
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_empty':
      if (actual === undefined || actual === null) return false;
      if (typeof actual === 'string') return actual.trim().length > 0;
      if (Array.isArray(actual)) return actual.length > 0;
      return true;
    case 'eq':
      return String(actual) === String(expected);
    case 'neq':
      return String(actual) !== String(expected);
    case 'gt':
      return compare(actual, expected, (a, b) => a > b);
    case 'gte':
      return compare(actual, expected, (a, b) => a >= b);
    case 'lt':
      return compare(actual, expected, (a, b) => a < b);
    case 'lte':
      return compare(actual, expected, (a, b) => a <= b);
    case 'matches': {
      if (typeof actual !== 'string' || expected === undefined) return false;
      try {
        return new RegExp(String(expected)).test(actual);
      } catch {
        return false;
      }
    }
    case 'min_count':
      return count(actual, expected, (len, n) => len >= n);
    case 'max_count':
      return count(actual, expected, (len, n) => len <= n);
  }
}

export function evaluateCheck(check: StructuredCheck, subject: unknown): CheckResult {
  const actual = resolvePath(subject, check.field);
  return {
    field: check.field,
    check: check.check,
    passed: evaluateOperator(check.check, actual, check.value),
    message: check.message,
    severity: check.severity,
    ...(actual !== undefined ? { actual } : {}),
  };
}

export function evaluateChecks(checks: readonly StructuredCheck[], subject: unknown): CheckResult[] {
  return checks.map((c) => evaluateCheck(c, subject));
}
