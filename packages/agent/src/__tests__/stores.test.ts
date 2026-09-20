import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { SessionNotFoundError, createInMemoryMessageStore, createInMemorySessionStore, createSessionRegistry } from '../stores';

describe('in-memory stores', () => {
  it('session store creates, updates, lists newest first, deletes', async () => {
    let t = 0;
    const store = createInMemorySessionStore(() => isoDate(new Date(Date.UTC(2026, 0, 1, 0, 0, t++))));
    await store.create({ id: 'a', ownerId: 'u', title: 'A', context: {} });
    await store.create({ id: 'b', ownerId: 'u', title: 'B', context: {} });
    await store.create({ id: 'c', ownerId: 'other', title: 'C', context: {} });
    await store.update('a', { title: 'A2', messageCount: 3 });
    const list = await store.list('u');
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ title: 'A2', messageCount: 3 });
    await expect(store.update('zzz', {})).rejects.toBeInstanceOf(SessionNotFoundError);
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
  });
  it('message store appends, lists copies, replaces', async () => {
    const store = createInMemoryMessageStore();
    const m = { id: '1', role: 'user' as const, content: 'hi', at: isoDate('2026-01-01') };
    await store.append('s', m);
    const list = await store.list('s');
    expect(list).toEqual([m]);
    list.push({ ...m, id: '2' });
    expect(await store.list('s')).toHaveLength(1);
    await store.replace('s', [{ ...m, id: 'sum', role: 'summary' }]);
    expect((await store.list('s'))[0]?.role).toBe('summary');
  });
});

describe('session registry', () => {
  it('evicts by idle time, and get() touches', () => {
    let now = 0;
    const reg = createSessionRegistry<string>({ idleMs: 1000, now: () => now });
    reg.set('a', 'A');
    reg.set('b', 'B');
    now = 950;
    expect(reg.get('a')).toBe('A');
    now = 1901;
    expect(reg.sweep()).toEqual(['b']);
    expect(reg.size()).toBe(1);
    reg.delete('a');
    expect(reg.get('a')).toBeUndefined();
  });
});
