import { IntegrationsError } from './errors';

/** Dot path over objects and arrays (`results.0.lat`); undefined when any segment is missing. */
export function resolvePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (part === '') continue;
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** What templates read: the host context, the pattern's variables, and resolved secrets. */
export interface InterpolationScope {
  ctx?: unknown;
  vars?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface InterpolateOptions {
  /** Leave `{{vault:key}}` in place when the secret is not in scope (for a dry run that never resolves secrets). */
  keepUnresolvedVault?: boolean;
  /** 'empty' renders missing values as ''; 'error' throws IntegrationsError('MISSING_VALUE'). */
  onMissing?: 'empty' | 'error';
}

export const TEMPLATE_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const VAULT_PREFIX = 'vault:';

const render = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : v === null || v === undefined ? '' : JSON.stringify(v));

/**
 * `{{ctx.a.b}}` and bare `{{a.b}}` read the context; `{{vars.x}}` reads the pattern's variables;
 * `{{vault:key}}` reads resolved secrets. Missing values render as '' unless onMissing is 'error'.
 */
export function interpolate(template: string, scope: InterpolationScope, opts: InterpolateOptions = {}): string {
  return template.replace(TEMPLATE_RE, (match, expr: string) => {
    if (expr.startsWith(VAULT_PREFIX)) {
      const key = expr.slice(VAULT_PREFIX.length).trim();
      const secret = scope.secrets?.[key];
      if (secret !== undefined) return secret;
      if (opts.keepUnresolvedVault) return match;
      if (opts.onMissing === 'error') throw new IntegrationsError(`No secret for vault:${key}`, 'MISSING_VALUE');
      return '';
    }
    let value: unknown;
    if (expr.startsWith('vars.')) value = scope.vars?.[expr.slice(5)];
    else if (expr.startsWith('ctx.')) value = resolvePath(scope.ctx, expr.slice(4));
    else value = resolvePath(scope.ctx, expr);
    if ((value === undefined || value === null) && opts.onMissing === 'error') throw new IntegrationsError(`No value for ${expr}`, 'MISSING_VALUE');
    return render(value);
  });
}

/** Unique vault keys referenced by a template, in order of first appearance. */
export function findVaultRefs(template: string): string[] {
  const keys: string[] = [];
  for (const m of template.matchAll(TEMPLATE_RE)) {
    const expr = m[1]!.trim();
    if (!expr.startsWith(VAULT_PREFIX)) continue;
    const key = expr.slice(VAULT_PREFIX.length).trim();
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Interpolates every string inside objects and arrays; other values pass through. */
export function interpolateObject<T>(value: T, scope: InterpolationScope, opts: InterpolateOptions = {}): T {
  if (typeof value === 'string') return interpolate(value, scope, opts) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => interpolateObject(v, scope, opts)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateObject(v, scope, opts)])) as T;
  }
  return value;
}
