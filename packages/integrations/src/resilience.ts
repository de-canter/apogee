import { createHash } from 'node:crypto';
import { nowIso, type ISODate, type Ref } from '@apogee/kernel';
import { IntegrationsError } from './errors';
import type { IntegrationPattern } from './pattern';

const MINUTE = 60_000;
const HOUR = 3_600_000;

export interface RateLimits { maxPerMinute?: number | undefined; maxPerHour?: number | undefined }
export interface RateLimiter {
  check(key: string, limits: RateLimits): { allowed: boolean; retryAfterMs?: number };
  record(key: string): void;
  reset(key?: string): void;
}

/** Sliding one-minute and one-hour windows per key. In memory; an adapter can back it with a shared store. */
export function createRateLimiter(opts: { clock?: () => number; defaultPerMinute?: number; defaultPerHour?: number } = {}): RateLimiter {
  const clock = opts.clock ?? (() => Date.now());
  const perMinute = opts.defaultPerMinute ?? 60;
  const perHour = opts.defaultPerHour ?? 1000;
  const stamps = new Map<string, number[]>();
  const within = (key: string, windowMs: number): number[] => {
    const now = clock();
    const kept = (stamps.get(key) ?? []).filter((t) => now - t < windowMs);
    return kept;
  };
  return {
    check(key, limits) {
      const now = clock();
      const all = (stamps.get(key) ?? []).filter((t) => now - t < HOUR);
      stamps.set(key, all);
      const minute = all.filter((t) => now - t < MINUTE);
      const maxMinute = limits.maxPerMinute ?? perMinute;
      const maxHour = limits.maxPerHour ?? perHour;
      if (minute.length >= maxMinute) return { allowed: false, retryAfterMs: Math.max(1, minute[0]! + MINUTE - now) };
      if (all.length >= maxHour) return { allowed: false, retryAfterMs: Math.max(1, all[0]! + HOUR - now) };
      return { allowed: true };
    },
    record(key) {
      stamps.set(key, [...within(key, HOUR), clock()]);
    },
    reset(key) {
      if (key === undefined) stamps.clear();
      else stamps.delete(key);
    },
  };
}

export type BreakerState = 'closed' | 'open' | 'half_open';
export interface BreakerSnapshot { state: BreakerState; consecutiveFailures: number; openedAt?: number; lastProbe?: 'success' | 'failure' }
export interface CircuitBreaker {
  check(key: string): { allowed: boolean } & BreakerSnapshot;
  success(key: string): void;
  failure(key: string): void;
  reset(key: string): void;
  state(key: string): BreakerSnapshot;
}

/** Opens after `failureThreshold` consecutive failures; after `cooldownMs` admits one probe at a time. */
export function createCircuitBreaker(opts: { failureThreshold?: number; cooldownMs?: number; clock?: () => number } = {}): CircuitBreaker {
  const threshold = opts.failureThreshold ?? 5;
  const cooldown = opts.cooldownMs ?? 60_000;
  const clock = opts.clock ?? (() => Date.now());
  const states = new Map<string, BreakerSnapshot & { probing?: boolean }>();
  const get = (key: string): BreakerSnapshot & { probing?: boolean } => states.get(key) ?? { state: 'closed', consecutiveFailures: 0 };
  const snapshot = (s: BreakerSnapshot & { probing?: boolean }): BreakerSnapshot => {
    const { probing: _probing, ...rest } = s;
    return rest;
  };
  return {
    check(key) {
      const s = get(key);
      if (s.state === 'closed') return { allowed: true, ...snapshot(s) };
      if (s.state === 'open') {
        if (s.openedAt !== undefined && clock() - s.openedAt >= cooldown) {
          const half = { ...s, state: 'half_open' as const, probing: true };
          states.set(key, half);
          return { allowed: true, ...snapshot(half) };
        }
        return { allowed: false, ...snapshot(s) };
      }
      if (s.probing) return { allowed: false, ...snapshot(s) };
      states.set(key, { ...s, probing: true });
      return { allowed: true, ...snapshot(s) };
    },
    success(key) {
      const s = get(key);
      states.set(key, { state: 'closed', consecutiveFailures: 0, ...(s.state === 'half_open' ? { lastProbe: 'success' } : {}) });
    },
    failure(key) {
      const s = get(key);
      if (s.state === 'half_open') {
        states.set(key, { state: 'open', consecutiveFailures: s.consecutiveFailures + 1, openedAt: clock(), lastProbe: 'failure' });
        return;
      }
      const failures = s.consecutiveFailures + 1;
      if (failures >= threshold) states.set(key, { ...snapshot(s), state: 'open', consecutiveFailures: failures, openedAt: clock() });
      else states.set(key, { ...snapshot(s), state: 'closed', consecutiveFailures: failures });
    },
    reset(key) {
      states.delete(key);
    },
    state: (key) => snapshot(get(key)),
  };
}

export interface RetryOptions {
  max: number;
  backoffMs: number;
  maxBackoffMs: number;
  retryOn: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** 0..1; default Math.random. */
  jitter?: () => number;
}
export interface Attempt<T> { attempt: number; result?: T; status?: number; error?: string }
export interface RetryOutcome<T> { ok: boolean; value?: T; status?: number; error?: string; attempts: Attempt<T>[] }

/** Exponential backoff capped at maxBackoffMs, scaled by 0.5..1 with jitter. */
export function backoffFor(attempt: number, opts: Pick<RetryOptions, 'backoffMs' | 'maxBackoffMs'>, jitter: number): number {
  const base = Math.min(opts.backoffMs * 2 ** (attempt - 1), opts.maxBackoffMs);
  return Math.round(base * (0.5 + jitter / 2));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Calls fn until it succeeds, returns a status not in retryOn, or attempts run out. Thrown errors are retried. */
export async function retry<T>(fn: (attempt: number) => Promise<{ status: number; value: T }>, isSuccess: (status: number) => boolean, opts: RetryOptions): Promise<RetryOutcome<T>> {
  const sleep = opts.sleep ?? defaultSleep;
  const jitter = opts.jitter ?? Math.random;
  const attempts: Attempt<T>[] = [];
  for (let attempt = 1; attempt <= opts.max + 1; attempt++) {
    if (attempt > 1) await sleep(backoffFor(attempt - 1, opts, jitter()));
    try {
      const { status, value } = await fn(attempt);
      attempts.push({ attempt, status, result: value });
      if (isSuccess(status)) return { ok: true, value, status, attempts };
      if (!opts.retryOn.includes(status)) return { ok: false, value, status, error: `HTTP ${status}`, attempts };
    } catch (e) {
      attempts.push({ attempt, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const last = attempts[attempts.length - 1]!;
  return { ok: false, ...(last.result !== undefined ? { value: last.result } : {}), ...(last.status !== undefined ? { status: last.status } : {}), error: last.error ?? `HTTP ${String(last.status)}`, attempts };
}

export type DeadLetterSource = 'outbound_failure' | 'inbound_unmatched' | 'inbound_low_confidence' | 'correlation_timeout' | 'schema_drift';
export interface DeadLetter {
  id: string;
  at: ISODate;
  source: DeadLetterSource;
  patternId?: string;
  payload: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'replayed' | 'discarded';
  attempts: number;
  resolvedAt?: ISODate;
  resolvedBy?: Ref;
}
export type DeadLetterInput = Omit<DeadLetter, 'id' | 'at' | 'status' | 'attempts'>;
export interface DeadLetterQueue {
  enqueue(input: DeadLetterInput): Promise<DeadLetter>;
  list(filter?: { source?: DeadLetterSource; status?: DeadLetter['status']; patternId?: string }, opts?: { limit?: number; offset?: number }): Promise<{ entries: DeadLetter[]; total: number }>;
  get(id: string): Promise<DeadLetter | undefined>;
  /** Runs the handler: success marks the entry replayed; failure counts an attempt and keeps it pending with the new error. */
  replay(id: string, handler: (entry: DeadLetter) => Promise<void>, by?: Ref): Promise<DeadLetter>;
  discard(id: string, by?: Ref): Promise<DeadLetter | undefined>;
}

export function createInMemoryDeadLetterQueue(opts: { now?: () => ISODate } = {}): DeadLetterQueue {
  const now = opts.now ?? nowIso;
  const entries = new Map<string, DeadLetter>();
  const clone = (e: DeadLetter): DeadLetter => structuredClone(e);
  return {
    enqueue(input) {
      const entry: DeadLetter = { ...input, id: crypto.randomUUID(), at: now(), status: 'pending', attempts: 0 };
      entries.set(entry.id, entry);
      return Promise.resolve(clone(entry));
    },
    list(filter = {}, page = {}) {
      const all = [...entries.values()]
        .filter((e) => (filter.source === undefined || e.source === filter.source) && (filter.status === undefined || e.status === filter.status) && (filter.patternId === undefined || e.patternId === filter.patternId))
        .sort((a, b) => b.at.localeCompare(a.at));
      const offset = page.offset ?? 0;
      const limit = page.limit ?? 50;
      return Promise.resolve({ entries: all.slice(offset, offset + limit).map(clone), total: all.length });
    },
    get: (id) => Promise.resolve(entries.has(id) ? clone(entries.get(id)!) : undefined),
    async replay(id, handler, by) {
      const e = entries.get(id);
      if (!e) throw new IntegrationsError(`No dead letter ${id}`, 'DEAD_LETTER_MISSING');
      e.attempts += 1;
      try {
        await handler(clone(e));
        e.status = 'replayed';
        e.resolvedAt = now();
        if (by) e.resolvedBy = by;
        delete e.error;
      } catch (err) {
        e.error = err instanceof Error ? err.message : String(err);
      }
      return clone(e);
    },
    discard(id, by) {
      const e = entries.get(id);
      if (!e) return Promise.resolve(undefined);
      e.status = 'discarded';
      e.resolvedAt = now();
      if (by) e.resolvedBy = by;
      return Promise.resolve(clone(e));
    },
  };
}

function shapeLines(value: unknown, path: string, depth: number, maxDepth: number, out: string[]): void {
  if (Array.isArray(value)) {
    out.push(`${path}:array`);
    if (depth < maxDepth && value.length > 0) shapeLines(value[0], `${path}[]`, depth + 1, maxDepth, out);
    return;
  }
  if (value === null) {
    out.push(`${path}:null`);
    return;
  }
  if (typeof value === 'object') {
    if (path !== '') out.push(`${path}:object`);
    if (depth >= maxDepth) return;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) shapeLines(v, path === '' ? k : `${path}.${k}`, depth + 1, maxDepth, out);
    return;
  }
  out.push(`${path}:${typeof value}`);
}

/** sha256 of the sorted `path:type` lines to maxDepth; values do not matter, shapes do. */
export function fingerprint(data: unknown, maxDepth = 3): string {
  const lines: string[] = [];
  shapeLines(data, '', 0, maxDepth, lines);
  return createHash('sha256').update(lines.sort().join('|')).digest('hex');
}

export interface DriftCheck { drifted: boolean; fingerprint?: string; previous?: string }

/** Compares a response's shape to the pattern's stored fingerprint. Non-object data is never checked. */
export function checkDrift(pattern: IntegrationPattern, data: unknown): DriftCheck {
  if (data === null || typeof data !== 'object') return { drifted: false };
  const fp = fingerprint(data);
  const previous = pattern.drift.fingerprint;
  if (previous === undefined) return { drifted: false, fingerprint: fp };
  return { drifted: previous !== fp, fingerprint: fp, previous };
}
