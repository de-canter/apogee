import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineDimensions } from '../dimensions';
import { defineRule, type Rule } from '../rule';
import { createInMemoryRuleStore, createRuleLoader, type RuleStore } from '../store';

const dims = defineDimensions({ event: z.enum(['created']) });
type D = typeof dims.shape;
const rule = (id: string, priority = 100): Rule<D> => defineRule(dims, { id, name: id, category: 'desk', conditions: {}, priority });

describe('createInMemoryRuleStore', () => {
  it('lists copies sorted by priority then id', async () => {
    const store = createInMemoryRuleStore([rule('b', 100), rule('a', 100), rule('c', 500)]);
    const listed = await store.list();
    expect(listed.map((r) => r.id)).toEqual(['c', 'a', 'b']);
    listed[0]!.name = 'mutated';
    expect((await store.get('c'))?.name).toBe('c');
  });
  it('upserts and removes', async () => {
    const store = createInMemoryRuleStore<D>();
    await store.upsert(rule('a'));
    await store.upsert({ ...rule('a'), name: 'A2' });
    expect((await store.get('a'))?.name).toBe('A2');
    expect(await store.remove('a')).toBe(true);
    expect(await store.remove('a')).toBe(false);
    expect(await store.get('a')).toBeUndefined();
  });
});

function counting(store: RuleStore<D>): RuleStore<D> & { listCalls: number } {
  const wrapped = { ...store, listCalls: 0, list: () => { wrapped.listCalls += 1; return store.list(); } };
  return wrapped;
}

describe('createRuleLoader', () => {
  it('loads from the store and caches for the TTL', async () => {
    let t = 0;
    const store = counting(createInMemoryRuleStore([rule('a'), rule('b')]));
    const loader = createRuleLoader({ store, ttlMs: 1000, clock: () => t });
    expect((await loader.rules()).map((r) => r.id)).toEqual(['a', 'b']);
    expect(loader.status()).toEqual({ source: 'store', loadedAt: 0, count: 2 });
    t = 999;
    await loader.rules();
    expect(store.listCalls).toBe(1);
    t = 1000;
    await loader.rules();
    expect(store.listCalls).toBe(2);
    loader.invalidate();
    await loader.rules();
    expect(store.listCalls).toBe(3);
  });
  it('falls back when the store is empty', async () => {
    const loader = createRuleLoader({ store: createInMemoryRuleStore<D>(), fallback: () => [rule('f')] });
    expect((await loader.rules()).map((r) => r.id)).toEqual(['f']);
    expect(loader.status().source).toBe('fallback');
  });
  it('falls back when the store throws and records the error', async () => {
    const store: RuleStore<D> = { list: () => Promise.reject(new Error('boom')), get: () => Promise.resolve(undefined), upsert: (r) => Promise.resolve(r), remove: () => Promise.resolve(false) };
    const loader = createRuleLoader({ store, fallback: () => Promise.resolve([rule('f')]) });
    expect((await loader.rules()).map((r) => r.id)).toEqual(['f']);
    expect(loader.status()).toMatchObject({ source: 'fallback', count: 1, lastError: 'boom' });
  });
  it('rethrows a store failure without a fallback', async () => {
    const store: RuleStore<D> = { list: () => Promise.reject(new Error('boom')), get: () => Promise.resolve(undefined), upsert: (r) => Promise.resolve(r), remove: () => Promise.resolve(false) };
    const loader = createRuleLoader({ store });
    await expect(loader.rules()).rejects.toThrow('boom');
    expect(loader.status().source).toBe('none');
  });
});
