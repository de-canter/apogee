import type { Ref } from '@de_canter/apogee-kernel';
import type { FieldAssertion } from './extract';

export type Comparator = 'exact' | 'text' | 'name' | 'number' | 'date' | ((a: unknown, b: unknown) => boolean);

/** How one field is compared across documents; fields without a rule use 'text'. */
export interface FieldRule {
  field: string;
  compare?: Comparator;
  /** Relative tolerance for 'number'. Default 0.01. */
  tolerance?: number;
  severity?: 'error' | 'warning';
  /** When documents disagree, take this document type's value. */
  preferCode?: string;
}

export const DEFAULT_TOLERANCE = 0.01;
const NAME_SUFFIXES = /\s+(jr\.?|sr\.?|ii|iii|iv)$/i;
const ENTITY_SUFFIXES = /\s+(llc\.?|inc\.?|corp\.?|ltd\.?)$/i;

const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ');

/** Lifted: case and spacing insensitive; substring either way; ignores generational and entity suffixes. */
export function fuzzyMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const strip = (s: string): string => s.replace(NAME_SUFFIXES, '').replace(ENTITY_SUFFIXES, '').trim();
  return strip(x) === strip(y);
}

/** |a - b| / |b| within tolerance; a zero reference matches only zero. */
export function withinTolerance(a: number, b: number, tolerance: number): boolean {
  if (b === 0) return a === 0;
  return Math.abs(a - b) / Math.abs(b) <= tolerance;
}

export function sameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toISOString().slice(0, 10) === db.toISOString().slice(0, 10);
}

function compareWith(rule: FieldRule | undefined, a: unknown, b: unknown): boolean {
  const c = rule?.compare ?? 'text';
  if (typeof c === 'function') return c(a, b);
  switch (c) {
    case 'exact':
      return JSON.stringify(a) === JSON.stringify(b);
    case 'text':
      return norm(String(a)) === norm(String(b));
    case 'name':
      return typeof a === 'string' && typeof b === 'string' && fuzzyMatch(a, b);
    case 'number':
      return typeof a === 'number' && typeof b === 'number' && withinTolerance(a, b, rule?.tolerance ?? DEFAULT_TOLERANCE);
    case 'date':
      return typeof a === 'string' && typeof b === 'string' && sameDay(a, b);
  }
}

export interface ReconcileSource { code: string; subject: Ref; fields: readonly FieldAssertion[] }

export interface FieldValue { code: string; subject: Ref; value: unknown; confidence: number }

export interface FieldReconciliation {
  field: string;
  values: FieldValue[];
  agreed: boolean;
  chosen?: FieldValue & { reason: 'only' | 'agreed' | 'preferred' | 'highest-confidence' };
  severity?: 'error' | 'warning';
}

export interface ReconciliationReport {
  fields: FieldReconciliation[];
  conflicts: FieldReconciliation[];
  /** No error-severity conflicts. */
  valid: boolean;
  documents: number;
}

const highest = (values: readonly FieldValue[]): FieldValue => values.reduce((best, v) => (v.confidence > best.confidence ? v : best));

/** Compare the same field across documents; pick a value for each; report conflicts by the host's rules. */
export function reconcile(sources: readonly ReconcileSource[], rules: readonly FieldRule[] = []): ReconciliationReport {
  const ruleFor = new Map(rules.map((r) => [r.field, r]));
  const byField = new Map<string, FieldValue[]>();
  for (const s of sources) {
    for (const f of s.fields) {
      const list = byField.get(f.field) ?? [];
      list.push({ code: s.code, subject: s.subject, value: f.value, confidence: f.confidence.value });
      byField.set(f.field, list);
    }
  }
  const fields: FieldReconciliation[] = [];
  for (const [field, values] of byField) {
    const rule = ruleFor.get(field);
    if (values.length === 1) {
      fields.push({ field, values, agreed: true, chosen: { ...values[0]!, reason: 'only' } });
      continue;
    }
    const agreed = values.every((v) => compareWith(rule, values[0]!.value, v.value));
    if (agreed) {
      fields.push({ field, values, agreed: true, chosen: { ...highest(values), reason: 'agreed' } });
      continue;
    }
    const preferred = rule?.preferCode !== undefined ? values.find((v) => v.code === rule.preferCode) : undefined;
    fields.push({
      field,
      values,
      agreed: false,
      chosen: preferred ? { ...preferred, reason: 'preferred' } : { ...highest(values), reason: 'highest-confidence' },
      severity: rule?.severity ?? 'warning',
    });
  }
  const conflicts = fields.filter((f) => !f.agreed);
  return { fields, conflicts, valid: !conflicts.some((c) => c.severity === 'error'), documents: sources.length };
}
