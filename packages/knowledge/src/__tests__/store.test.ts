import { describe, expect, it } from 'vitest';
import { chunkMarkdown, type Chunk } from '../chunk';
import { createLexicalChunkStore, reingest } from '../store';

const chunk = (source: string, title: string, content: string, scope = 'user'): Chunk =>
  chunkMarkdown(source, `# ${title}\n\n${content}`, { scope })[0]!;

const seed: Chunk[] = [
  chunk('policies/deposits.md', 'Refunds', 'Deposits are refundable within 7 days of the return inspection.'),
  chunk('policies/deposits.md', 'Deposit amounts', 'A deposit of 20 percent is held on high-value rentals.'),
  chunk('policies/delivery.md', 'Delivery', 'Delivery is available within 40 miles for a flat fee each way.'),
  chunk('policies/safety.md', 'Harness rules', 'Aerial lifts require a harness and lanyard on the platform.'),
  chunk('ops/playbook.md', 'Refund overrides', 'Managers may override the refund window for returning customers.', 'admin'),
  chunk('ops/playbook.md', 'Escalation', 'Escalate damage disputes above 500 dollars to the owner.', 'admin'),
];

async function seeded() {
  const store = createLexicalChunkStore();
  await store.upsert(seed);
  return store;
}

describe('createLexicalChunkStore', () => {
  it('ranks by BM25 with title weight and excludes zero scores', async () => {
    const store = await seeded();
    const hits = await store.search('deposit refund');
    expect(hits[0]!.title).toBe('Refunds');
    expect(hits.map((h) => h.title)).not.toContain('Harness rules');
    expect(hits.every((h) => h.score > 0)).toBe(true);
    const byTitle = await store.search('delivery');
    expect(byTitle[0]!.title).toBe('Delivery');
  });
  it('filters by scope, section, source, and limit', async () => {
    const store = await seeded();
    expect((await store.search('refund', { scope: 'user' })).map((h) => h.scope)).toEqual(['user']);
    expect((await store.search('refund', { scope: 'admin' })).map((h) => h.title)).toEqual(['Refund overrides']);
    expect((await store.search('refund', { scope: ['user', 'admin'] })).length).toBe(2);
    expect((await store.search('refund', { section: 'ops', scope: ['user', 'admin'] })).map((h) => h.section)).toEqual(['ops']);
    expect((await store.search('deposit', { source: 'policies/deposits.md', limit: 1 })).length).toBe(1);
  });
  it('returns nothing for empty or stopword-only queries', async () => {
    const store = await seeded();
    expect(await store.search('')).toEqual([]);
    expect(await store.search('the and of')).toEqual([]);
  });
  it('upserts by id with hash-based change detection', async () => {
    const store = await seeded();
    const changed = { ...seed[0]!, content: 'Deposits are refundable within 14 days.', hash: 'changed000000000' };
    expect(await store.upsert([...seed.slice(1), changed])).toEqual({ created: 0, updated: 1, unchanged: 5 });
    expect((await store.search('refundable'))[0]!.content).toContain('14 days');
    expect(await store.remove([seed[3]!.id, 'missing'])).toBe(1);
    expect((await store.list({ source: 'policies/safety.md' })).length).toBe(0);
  });
  it('lists and reports stats', async () => {
    const store = await seeded();
    expect((await store.list({ scope: 'admin' })).map((c) => c.title)).toEqual(['Refund overrides', 'Escalation']);
    expect(await store.stats()).toEqual({ chunks: 6, sources: ['ops/playbook.md', 'policies/delivery.md', 'policies/deposits.md', 'policies/safety.md'], sections: { policies: 4, ops: 2 }, scopes: { user: 4, admin: 2 } });
  });
});

describe('reingest', () => {
  it('upserts the new chunks and removes the ones that vanished', async () => {
    const store = await seeded();
    const next = chunkMarkdown('policies/deposits.md', '# Refunds\n\nDeposits are refundable within 7 days of the return inspection.\n\n# Late fees\n\nLate returns cost a day.');
    const stats = await reingest(store, 'policies/deposits.md', next);
    expect(stats).toEqual({ created: 1, updated: 0, unchanged: 1, removed: 1 });
    expect((await store.list({ source: 'policies/deposits.md' })).map((c) => c.title)).toEqual(['Refunds', 'Late fees']);
    expect((await store.stats()).chunks).toBe(6);
  });
});
