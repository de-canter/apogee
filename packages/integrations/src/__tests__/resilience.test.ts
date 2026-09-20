import { isoDate, ref } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { definePattern } from '../pattern';
import { backoffFor, checkDrift, createCircuitBreaker, createInMemoryDeadLetterQueue, createRateLimiter, fingerprint, retry } from '../resilience';

describe('createRateLimiter', () => {
  it('enforces per-minute and per-hour windows with a retry hint', () => {
    let t = 0;
    const limiter = createRateLimiter({ clock: () => t });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check('p', { maxPerMinute: 3 }).allowed).toBe(true);
      limiter.record('p');
    }
    const blocked = limiter.check('p', { maxPerMinute: 3 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);
    t = 60_000;
    expect(limiter.check('p', { maxPerMinute: 3 }).allowed).toBe(true);
    expect(limiter.check('q', { maxPerMinute: 3 }).allowed).toBe(true);
    for (let i = 0; i < 5; i++) limiter.record('h');
    expect(limiter.check('h', { maxPerHour: 5 }).allowed).toBe(false);
    limiter.reset('h');
    expect(limiter.check('h', { maxPerHour: 5 }).allowed).toBe(true);
    const defaults = createRateLimiter({ clock: () => 0, defaultPerMinute: 1 });
    defaults.record('d');
    expect(defaults.check('d', {}).allowed).toBe(false);
  });
});

describe('createCircuitBreaker', () => {
  it('opens after the threshold, admits one probe after cooldown, closes on success', () => {
    let t = 0;
    const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, clock: () => t });
    expect(breaker.check('p')).toMatchObject({ allowed: true, state: 'closed', consecutiveFailures: 0 });
    breaker.failure('p');
    breaker.failure('p');
    expect(breaker.check('p').allowed).toBe(true);
    breaker.failure('p');
    expect(breaker.check('p')).toMatchObject({ allowed: false, state: 'open', consecutiveFailures: 3, openedAt: 0 });
    t = 999;
    expect(breaker.check('p').allowed).toBe(false);
    t = 1000;
    expect(breaker.check('p')).toMatchObject({ allowed: true, state: 'half_open' });
    expect(breaker.check('p').allowed).toBe(false);
    breaker.success('p');
    expect(breaker.state('p')).toMatchObject({ state: 'closed', consecutiveFailures: 0, lastProbe: 'success' });
    for (let i = 0; i < 3; i++) breaker.failure('p');
    t = 3000;
    expect(breaker.check('p').state).toBe('half_open');
    breaker.failure('p');
    expect(breaker.state('p')).toMatchObject({ state: 'open', lastProbe: 'failure', openedAt: 3000 });
    breaker.reset('p');
    expect(breaker.check('p')).toMatchObject({ allowed: true, state: 'closed' });
  });
});

describe('retry', () => {
  const sleeps: number[] = [];
  const opts = { max: 2, backoffMs: 1000, maxBackoffMs: 3000, retryOn: [503], sleep: (ms: number) => { sleeps.push(ms); return Promise.resolve(); }, jitter: () => 1 };
  const ok = (status: number) => status >= 200 && status < 300;

  it('stops on success and retries only listed statuses', async () => {
    sleeps.length = 0;
    const statuses = [503, 200];
    const r = await retry((attempt) => Promise.resolve({ status: statuses[attempt - 1]!, value: `v${attempt}` }), ok, opts);
    expect(r).toMatchObject({ ok: true, value: 'v2', status: 200 });
    expect(r.attempts).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
    const nope = await retry(() => Promise.resolve({ status: 400, value: 'bad' }), ok, opts);
    expect(nope).toMatchObject({ ok: false, status: 400 });
    expect(nope.attempts).toHaveLength(1);
  });
  it('retries thrown errors and exhausts with the last error', async () => {
    sleeps.length = 0;
    const r = await retry(() => Promise.reject(new Error('timeout')), ok, opts);
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
    expect(r.attempts).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
    const s = await retry(() => Promise.resolve({ status: 503, value: 'busy' }), ok, { ...opts, max: 3 });
    expect(s).toMatchObject({ ok: false, status: 503, error: 'HTTP 503' });
    expect(s.attempts).toHaveLength(4);
  });
  it('computes capped, jittered backoff', () => {
    expect([1, 2, 3, 4].map((a) => backoffFor(a, { backoffMs: 1000, maxBackoffMs: 3000 }, 1))).toEqual([1000, 2000, 3000, 3000]);
    expect(backoffFor(1, { backoffMs: 1000, maxBackoffMs: 3000 }, 0)).toBe(500);
  });
});

describe('createInMemoryDeadLetterQueue', () => {
  it('enqueues, lists, replays with a handler, and discards', async () => {
    let n = 0;
    const q = createInMemoryDeadLetterQueue({ now: () => isoDate(`2026-09-19T12:0${n++}:00Z`) });
    const a = await q.enqueue({ source: 'outbound_failure', patternId: 'P', payload: { url: 'x' }, error: 'HTTP 503' });
    const b = await q.enqueue({ source: 'inbound_unmatched', payload: { body: 1 } });
    expect(a).toMatchObject({ status: 'pending', attempts: 0, at: '2026-09-19T12:00:00.000Z' });
    expect((await q.list({ source: 'outbound_failure' })).entries.map((e) => e.id)).toEqual([a.id]);
    expect((await q.list()).total).toBe(2);
    const failed = await q.replay(a.id, () => Promise.reject(new Error('still down')));
    expect(failed).toMatchObject({ status: 'pending', attempts: 1, error: 'still down' });
    const jeff = ref('User', 'jeff');
    const replayed = await q.replay(a.id, () => Promise.resolve(), jeff);
    expect(replayed).toMatchObject({ status: 'replayed', attempts: 2, resolvedBy: jeff });
    expect(replayed.resolvedAt).toBeDefined();
    await expect(q.replay('nope', () => Promise.resolve())).rejects.toThrow(/nope/);
    expect((await q.discard(b.id, jeff))?.status).toBe('discarded');
    expect((await q.list({ status: 'pending' })).total).toBe(0);
    expect(await q.get(b.id)).toMatchObject({ status: 'discarded' });
  });
});

describe('fingerprint and checkDrift', () => {
  it('depends on key paths and types, not values or order', () => {
    const a = fingerprint({ current: { temp_c: 21, condition: { text: 'Sunny' } }, results: [{ lat: 1 }] });
    expect(a).toHaveLength(64);
    expect(fingerprint({ results: [{ lat: 2 }], current: { condition: { text: 'Rain' }, temp_c: 19 } })).toBe(a);
    expect(fingerprint({ current: { temp_c: '21', condition: { text: 'Sunny' } }, results: [{ lat: 1 }] })).not.toBe(a);
    expect(fingerprint({ current: { temp_c: 21 } })).not.toBe(a);
  });
  it('reports a baseline and a drift', () => {
    const p = definePattern({ id: 'P', name: 'p', direction: 'outbound' });
    const first = checkDrift(p, { a: 1 });
    expect(first).toEqual({ drifted: false, fingerprint: fingerprint({ a: 1 }) });
    const stored = { ...p, drift: { fingerprint: first.fingerprint! } };
    expect(checkDrift(stored, { a: 2 })).toEqual({ drifted: false, fingerprint: first.fingerprint, previous: first.fingerprint });
    const drifted = checkDrift(stored, { a: 'x', b: true });
    expect(drifted.drifted).toBe(true);
    expect(drifted.previous).toBe(first.fingerprint);
    expect(checkDrift(stored, 'text')).toEqual({ drifted: false });
  });
});
