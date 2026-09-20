import { tokenize, type Chunk } from './chunk';

export interface SearchOptions {
  limit?: number;
  scope?: string | string[];
  section?: string;
  source?: string;
}

export interface ScoredChunk extends Chunk { score: number }

export interface UpsertStats { created: number; updated: number; unchanged: number }

export interface StoreStats { chunks: number; sources: string[]; sections: Record<string, number>; scopes: Record<string, number> }

/** Retrieval port. Adapters (Mongo text index, a vector database) live in separate packages. */
export interface ChunkStore {
  /** By id; an equal hash counts as unchanged. */
  upsert(chunks: readonly Chunk[]): Promise<UpsertStats>;
  remove(ids: readonly string[]): Promise<number>;
  list(filter?: { source?: string; scope?: string }): Promise<Chunk[]>;
  search(query: string, opts?: SearchOptions): Promise<ScoredChunk[]>;
  stats(): Promise<StoreStats>;
}

export const DEFAULT_LIMIT = 5;

export interface LexicalOptions {
  /** Weight of title tokens relative to content tokens. */
  titleWeight?: number;
  k1?: number;
  b?: number;
}

export function matchesFilter(c: Chunk, opts: { scope?: string | string[]; section?: string; source?: string }): boolean {
  if (opts.scope !== undefined) {
    const scopes = Array.isArray(opts.scope) ? opts.scope : [opts.scope];
    if (!scopes.includes(c.scope)) return false;
  }
  if (opts.section !== undefined && c.section !== opts.section) return false;
  if (opts.source !== undefined && c.source !== opts.source) return false;
  return true;
}

export function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

interface Indexed { chunk: Chunk; tf: Map<string, number>; length: number }

/** In-memory BM25 over title (weighted) and content. Deterministic; ties break by id. */
export function createLexicalChunkStore(opts: LexicalOptions = {}): ChunkStore {
  const titleWeight = opts.titleWeight ?? 2;
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const docs = new Map<string, Indexed>();

  const index = (chunk: Chunk): Indexed => {
    const tf = new Map<string, number>();
    let length = 0;
    for (const t of tokenize(chunk.title)) {
      tf.set(t, (tf.get(t) ?? 0) + titleWeight);
      length += titleWeight;
    }
    for (const t of tokenize(chunk.content)) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
      length += 1;
    }
    return { chunk, tf, length };
  };

  return {
    upsert(chunks) {
      const stats: UpsertStats = { created: 0, updated: 0, unchanged: 0 };
      for (const c of chunks) {
        const existing = docs.get(c.id);
        if (existing && existing.chunk.hash === c.hash) {
          stats.unchanged += 1;
          continue;
        }
        docs.set(c.id, index(structuredClone(c)));
        if (existing) stats.updated += 1;
        else stats.created += 1;
      }
      return Promise.resolve(stats);
    },
    remove(ids) {
      let n = 0;
      for (const id of ids) if (docs.delete(id)) n += 1;
      return Promise.resolve(n);
    },
    list(filter = {}) {
      return Promise.resolve([...docs.values()].map((d) => structuredClone(d.chunk)).filter((c) => matchesFilter(c, filter)));
    },
    search(query, searchOpts = {}) {
      const terms = tokenize(query);
      const candidates = [...docs.values()].filter((d) => matchesFilter(d.chunk, searchOpts));
      if (terms.length === 0 || candidates.length === 0) return Promise.resolve([]);
      const n = candidates.length;
      const avg = candidates.reduce((s, d) => s + d.length, 0) / n;
      const df = new Map<string, number>();
      for (const t of new Set(terms)) df.set(t, candidates.filter((d) => d.tf.has(t)).length);
      const scored: ScoredChunk[] = [];
      for (const d of candidates) {
        let score = 0;
        for (const t of new Set(terms)) {
          const f = d.tf.get(t) ?? 0;
          if (f === 0) continue;
          const idf = Math.log(1 + (n - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
          score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / (avg || 1))));
        }
        if (score > 0) scored.push({ ...structuredClone(d.chunk), score });
      }
      scored.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
      return Promise.resolve(scored.slice(0, searchOpts.limit ?? DEFAULT_LIMIT));
    },
    stats() {
      const all = [...docs.values()].map((d) => d.chunk);
      return Promise.resolve({
        chunks: all.length,
        sources: [...new Set(all.map((c) => c.source))].sort(),
        sections: tally(all.map((c) => c.section)),
        scopes: tally(all.map((c) => c.scope)),
      });
    },
  };
}

/** Upsert a source's current chunks and remove the ones that vanished. */
export async function reingest(store: ChunkStore, source: string, chunks: readonly Chunk[]): Promise<UpsertStats & { removed: number }> {
  const keep = new Set(chunks.map((c) => c.id));
  const stale = (await store.list({ source })).filter((c) => !keep.has(c.id)).map((c) => c.id);
  const stats = await store.upsert(chunks);
  const removed = stale.length > 0 ? await store.remove(stale) : 0;
  return { ...stats, removed };
}
