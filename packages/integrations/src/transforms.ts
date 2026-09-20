import { IntegrationsError } from './errors';
import type { ResponseMapping } from './pattern';
import { resolvePath } from './template';

export type Transform = (value: unknown, args: Record<string, unknown>) => unknown;

const str = (v: unknown): v is string => typeof v === 'string';
/** Text for any value: primitives as-is, objects as JSON, nothing for null and undefined. */
const asText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : v === null || v === undefined ? '' : JSON.stringify(v));
const toNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isNaN(n) ? undefined : n;
};

/** The transforms a mapping may name. Unknown names are an error, never a silent pass-through. */
export const TRANSFORMS: Readonly<Record<string, Transform>> = {
  uppercase: (v) => (str(v) ? v.toUpperCase() : v),
  lowercase: (v) => (str(v) ? v.toLowerCase() : v),
  trim: (v) => (str(v) ? v.trim() : v),
  to_number: (v) => toNumber(v) ?? v,
  to_boolean: (v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'y'].includes(asText(v).trim().toLowerCase())),
  date_format: (v, a) => {
    if (!str(v) && typeof v !== 'number') return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return a['format'] === 'date' ? d.toISOString().slice(0, 10) : d.toISOString();
  },
  cents_to_units: (v) => {
    const n = toNumber(v);
    return n === undefined ? v : n / 100;
  },
  units_to_cents: (v) => {
    const n = toNumber(v);
    return n === undefined ? v : Math.round(n * 100);
  },
  split: (v, a) => {
    if (!str(v)) return v;
    const parts = v.split(str(a['delimiter']) ? a['delimiter'] : ',');
    return typeof a['index'] === 'number' ? parts[a['index']] : parts;
  },
  concat: (v, a) => {
    if (Array.isArray(v)) return v.map(asText).join(str(a['separator']) ? a['separator'] : '');
    return `${str(a['prefix']) ? a['prefix'] : ''}${asText(v)}${str(a['suffix']) ? a['suffix'] : ''}`;
  },
  default_value: (v, a) => (v === undefined || v === null || v === '' ? a['default'] : v),
  lookup: (v, a) => {
    const map = a['map'];
    if (map && typeof map === 'object' && asText(v) in (map as Record<string, unknown>)) return (map as Record<string, unknown>)[asText(v)];
    return 'default' in a ? a['default'] : v;
  },
  conditional: (v, a) => {
    const c = a['condition'];
    const n = toNumber(v);
    const m = toNumber(a['compareTo']);
    const result =
      c === 'truthy' ? Boolean(v) : c === 'falsy' ? !v : c === 'equals' ? v === a['compareTo'] : c === 'not_equals' ? v !== a['compareTo'] : c === 'gt' ? n !== undefined && m !== undefined && n > m : c === 'lt' ? n !== undefined && m !== undefined && n < m : false;
    return result ? ('ifTrue' in a ? a['ifTrue'] : v) : 'ifFalse' in a ? a['ifFalse'] : v;
  },
  jsonpath: (v, a) => (str(a['path']) ? resolvePath(v, a['path']) : v),
  regex_extract: (v, a) => {
    if (!str(v) || !str(a['pattern'])) return v;
    const m = new RegExp(a['pattern']).exec(v);
    if (!m) return 'default' in a ? a['default'] : v;
    return m[typeof a['group'] === 'number' ? a['group'] : 0] ?? ('default' in a ? a['default'] : v);
  },
  to_json: (v) => JSON.stringify(v),
  from_json: (v) => {
    if (!str(v)) return v;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return v;
    }
  },
};

export function applyTransform(name: string, value: unknown, args: Record<string, unknown> = {}, registry: Readonly<Record<string, Transform>> = TRANSFORMS): unknown {
  const t = registry[name];
  if (!t) throw new IntegrationsError(`Unknown transform "${name}"`, 'UNKNOWN_TRANSFORM');
  return t(value, args);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = target;
  for (const part of parts.slice(0, -1)) {
    const next = cur[part];
    if (next === null || typeof next !== 'object') cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/** Maps sources to (dot-path) targets with transforms; missing sources are skipped. An empty mapping returns the data as a record. */
export function applyMapping(data: unknown, mapping: readonly ResponseMapping[], registry: Readonly<Record<string, Transform>> = TRANSFORMS): Record<string, unknown> {
  if (mapping.length === 0) return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : { value: data };
  const out: Record<string, unknown> = {};
  for (const m of mapping) {
    const raw = resolvePath(data, m.source);
    if (raw === undefined) continue;
    setPath(out, m.target, m.transform ? applyTransform(m.transform, raw, m.args ?? {}, registry) : raw);
  }
  return out;
}
