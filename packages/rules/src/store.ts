import type { DimensionShape } from './dimensions';
import type { Rule } from './rule';

/** Persistence port for rules. Adapters (Mongoose, files) live in separate packages. */
export interface RuleStore<S extends DimensionShape> {
  list(): Promise<Rule<S>[]>;
  get(id: string): Promise<Rule<S> | undefined>;
  upsert(rule: Rule<S>): Promise<Rule<S>>;
  remove(id: string): Promise<boolean>;
}

const clone = <T>(v: T): T => structuredClone(v);
const byPriority = <S extends DimensionShape>(a: Rule<S>, b: Rule<S>): number => b.priority - a.priority || a.id.localeCompare(b.id);

export function createInMemoryRuleStore<S extends DimensionShape>(initial: readonly Rule<S>[] = []): RuleStore<S> {
  const rules = new Map<string, Rule<S>>(initial.map((r) => [r.id, clone(r)]));
  return {
    list: () => Promise.resolve([...rules.values()].map(clone).sort(byPriority)),
    get: (id) => Promise.resolve(rules.has(id) ? clone(rules.get(id)!) : undefined),
    upsert(rule) {
      rules.set(rule.id, clone(rule));
      return Promise.resolve(clone(rule));
    },
    remove: (id) => Promise.resolve(rules.delete(id)),
  };
}

export interface RuleLoaderOptions<S extends DimensionShape> {
  store: RuleStore<S>;
  /** Used when the store is empty or fails (for example, static rules shipped with the product). */
  fallback?: () => readonly Rule<S>[] | Promise<readonly Rule<S>[]>;
  ttlMs?: number;
  clock?: () => number;
}

export interface RuleLoaderStatus { source: 'store' | 'fallback' | 'none'; loadedAt?: number; count: number; lastError?: string }

export interface RuleLoader<S extends DimensionShape> {
  /** Cached rules; reloads after the TTL or an invalidate(). */
  rules(): Promise<Rule<S>[]>;
  refresh(): Promise<Rule<S>[]>;
  invalidate(): void;
  status(): RuleLoaderStatus;
}

export const DEFAULT_LOADER_TTL_MS = 30_000;

/** DB-first with a TTL cache and a fallback: the pattern products use for rules that can be edited live. */
export function createRuleLoader<S extends DimensionShape>(opts: RuleLoaderOptions<S>): RuleLoader<S> {
  const ttl = opts.ttlMs ?? DEFAULT_LOADER_TTL_MS;
  const clock = opts.clock ?? (() => Date.now());
  let cache: Rule<S>[] | undefined;
  let expiresAt = -Infinity;
  let status: RuleLoaderStatus = { source: 'none', count: 0 };

  const useFallback = async (lastError?: string): Promise<Rule<S>[]> => {
    const rules = [...(await opts.fallback!())];
    status = { source: 'fallback', loadedAt: clock(), count: rules.length, ...(lastError !== undefined ? { lastError } : {}) };
    return rules;
  };

  const refresh = async (): Promise<Rule<S>[]> => {
    let loaded: Rule<S>[];
    try {
      const fromStore = await opts.store.list();
      if (fromStore.length > 0) {
        loaded = fromStore;
        status = { source: 'store', loadedAt: clock(), count: loaded.length };
      } else if (opts.fallback) {
        loaded = await useFallback();
      } else {
        loaded = [];
        status = { source: 'store', loadedAt: clock(), count: 0 };
      }
    } catch (e) {
      if (!opts.fallback) throw e;
      loaded = await useFallback(e instanceof Error ? e.message : String(e));
    }
    cache = loaded;
    expiresAt = clock() + ttl;
    return loaded;
  };

  return {
    rules: () => (cache !== undefined && clock() < expiresAt ? Promise.resolve(cache) : refresh()),
    refresh,
    invalidate() {
      cache = undefined;
      expiresAt = -Infinity;
    },
    status: () => ({ ...status }),
  };
}
