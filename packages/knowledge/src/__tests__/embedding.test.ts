import { describe, expect, it } from 'vitest';
import { chunkMarkdown, type Chunk } from '../chunk';
import { cosine, createHashEmbedder, createHybridChunkStore, createVectorChunkStore, type EmbeddingPort } from '../embedding';
import { createLexicalChunkStore } from '../store';

const chunk = (source: string, title: string, content: string, scope = 'user'): Chunk => chunkMarkdown(source, `# ${title}\n\n${content}`, { scope })[0]!;
const seed: Chunk[] = [
  chunk('policies/deposits.md', 'Refunds', 'Deposits are refundable within 7 days of the return inspection.'),
  chunk('policies/delivery.md', 'Delivery', 'Delivery is available within 40 miles for a flat fee each way.'),
  chunk('policies/safety.md', 'Harness rules', 'Aerial lifts require a harness and lanyard on the platform.'),
  chunk('ops/playbook.md', 'Refund overrides', 'Managers may override the refund window for returning customers.', 'admin'),
];

function counting(embedder: EmbeddingPort): EmbeddingPort & { calls: number; texts: number } {
  const wrapped = { ...embedder, calls: 0, texts: 0, embed: (texts: readonly string[]) => { wrapped.calls += 1; wrapped.texts += texts.length; return embedder.embed(texts); } };
  return wrapped;
}

describe('cosine', () => {
  it('handles identical, orthogonal, and zero vectors', () => {
    expect(cosine([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('createVectorChunkStore', () => {
  it('embeds on upsert once per changed chunk and ranks by cosine with filters', async () => {
    const embedder = counting(createHashEmbedder(64));
    const store = createVectorChunkStore({ embedder });
    expect(await store.upsert(seed)).toEqual({ created: 4, updated: 0, unchanged: 0 });
    expect(embedder.texts).toBe(4);
    await store.upsert(seed);
    expect(embedder.texts).toBe(4);
    const hits = await store.search('deposit refund days');
    expect(hits[0]!.title).toBe('Refunds');
    expect(hits.every((h) => h.score > 0)).toBe(true);
    expect((await store.search('refund', { scope: 'admin' })).map((h) => h.title)).toEqual(['Refund overrides']);
    expect((await store.search('refund', { limit: 1 })).length).toBe(1);
    expect(await store.search('')).toEqual([]);
    expect((await store.stats()).chunks).toBe(4);
    expect(await store.remove([seed[0]!.id])).toBe(1);
    expect((await store.list()).length).toBe(3);
  });
  it('drops results under minScore', async () => {
    const store = createVectorChunkStore({ embedder: createHashEmbedder(), minScore: 0.99 });
    await store.upsert(seed);
    expect(await store.search('unrelated words entirely')).toEqual([]);
  });
});

describe('createHybridChunkStore', () => {
  it('fuses both rankings and writes to both stores', async () => {
    const lexical = createLexicalChunkStore();
    const vector = createVectorChunkStore({ embedder: createHashEmbedder() });
    const hybrid = createHybridChunkStore({ lexical, vector });
    await hybrid.upsert(seed);
    expect((await lexical.stats()).chunks).toBe(4);
    expect((await vector.stats()).chunks).toBe(4);
    const hits = await hybrid.search('deposit refund');
    expect(hits[0]!.title).toBe('Refunds');
    expect(hits[0]!.score).toBeGreaterThan(hits[hits.length - 1]!.score);
    expect(new Set(hits.map((h) => h.id)).size).toBe(hits.length);
    expect((await hybrid.search('refund', { scope: 'admin' })).map((h) => h.title)).toEqual(['Refund overrides']);
    await hybrid.remove([seed[0]!.id]);
    expect((await lexical.list()).length).toBe(3);
    expect((await vector.list()).length).toBe(3);
    expect((await hybrid.stats()).chunks).toBe(3);
  });
});
