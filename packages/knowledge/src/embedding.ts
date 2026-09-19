import { createHash } from 'node:crypto';
import { tokenize, type Chunk } from './chunk';
import { DEFAULT_LIMIT, matchesFilter, tally, type ChunkStore, type ScoredChunk, type SearchOptions, type UpsertStats } from './store';

/** Host-supplied embeddings; Anthropic has no embeddings endpoint. */
export interface EmbeddingPort {
  embed(texts: readonly string[]): Promise<number[][]>;
  dimensions?: number;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const embeddingText = (c: Chunk): string => `${c.title}\n${c.content}`;

/** In-memory vector store: chunks are embedded on upsert; search embeds the query and ranks by cosine. */
export function createVectorChunkStore(opts: { embedder: EmbeddingPort; minScore?: number }): ChunkStore {
  const minScore = opts.minScore ?? 0;
  const docs = new Map<string, { chunk: Chunk; vector: number[] }>();
  return {
    async upsert(chunks) {
      const stats: UpsertStats = { created: 0, updated: 0, unchanged: 0 };
      const pending: Chunk[] = [];
      for (const c of chunks) {
        const existing = docs.get(c.id);
        if (existing && existing.chunk.hash === c.hash) {
          stats.unchanged += 1;
          continue;
        }
        if (existing) stats.updated += 1;
        else stats.created += 1;
        pending.push(c);
      }
      if (pending.length > 0) {
        const vectors = await opts.embedder.embed(pending.map(embeddingText));
        pending.forEach((c, i) => docs.set(c.id, { chunk: structuredClone(c), vector: vectors[i] ?? [] }));
      }
      return stats;
    },
    remove(ids) {
      let n = 0;
      for (const id of ids) if (docs.delete(id)) n += 1;
      return Promise.resolve(n);
    },
    list(filter = {}) {
      return Promise.resolve([...docs.values()].map((d) => structuredClone(d.chunk)).filter((c) => matchesFilter(c, filter)));
    },
    async search(query, searchOpts = {}) {
      if (query.trim() === '') return [];
      const candidates = [...docs.values()].filter((d) => matchesFilter(d.chunk, searchOpts));
      if (candidates.length === 0) return [];
      const [q] = await opts.embedder.embed([query]);
      const scored: ScoredChunk[] = [];
      for (const d of candidates) {
        const score = cosine(q ?? [], d.vector);
        if (score > minScore) scored.push({ ...structuredClone(d.chunk), score });
      }
      scored.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
      return scored.slice(0, searchOpts.limit ?? DEFAULT_LIMIT);
    },
    stats() {
      const all = [...docs.values()].map((d) => d.chunk);
      return Promise.resolve({ chunks: all.length, sources: [...new Set(all.map((c) => c.source))].sort(), sections: tally(all.map((c) => c.section)), scopes: tally(all.map((c) => c.scope)) });
    },
  };
}

export interface HybridOptions {
  lexical: ChunkStore;
  vector: ChunkStore;
  /** Reciprocal rank fusion constant. */
  k?: number;
}

/** Reciprocal rank fusion of both stores' results; writes go to both. */
export function createHybridChunkStore(opts: HybridOptions): ChunkStore {
  const k = opts.k ?? 60;
  return {
    async upsert(chunks) {
      const [a] = await Promise.all([opts.lexical.upsert(chunks), opts.vector.upsert(chunks)]);
      return a;
    },
    async remove(ids) {
      const [a] = await Promise.all([opts.lexical.remove(ids), opts.vector.remove(ids)]);
      return a;
    },
    list: (filter) => opts.lexical.list(filter),
    async search(query, searchOpts: SearchOptions = {}) {
      const limit = searchOpts.limit ?? DEFAULT_LIMIT;
      const wide = { ...searchOpts, limit: limit * 3 };
      const [lex, vec] = await Promise.all([opts.lexical.search(query, wide), opts.vector.search(query, wide)]);
      const fused = new Map<string, ScoredChunk>();
      for (const list of [lex, vec]) {
        list.forEach((c, rank) => {
          const prev = fused.get(c.id);
          const score = 1 / (k + rank + 1);
          fused.set(c.id, prev ? { ...prev, score: prev.score + score } : { ...c, score });
        });
      }
      return [...fused.values()].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, limit);
    },
    stats: () => opts.lexical.stats(),
  };
}

/** Test double: deterministic bag-of-words vectors from token hashes, so tests need no model. */
export function createHashEmbedder(dimensions = 64): EmbeddingPort {
  const slot = (token: string): number => createHash('sha256').update(token).digest().readUInt32BE(0) % dimensions;
  return {
    dimensions,
    embed(texts) {
      return Promise.resolve(
        texts.map((t) => {
          const v = new Array<number>(dimensions).fill(0);
          for (const token of tokenize(t)) v[slot(token)] = (v[slot(token)] ?? 0) + 1;
          return v;
        }),
      );
    },
  };
}
