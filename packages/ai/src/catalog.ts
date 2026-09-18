export type ModelId = string;

export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ModelSpec {
  id: ModelId;
  family: string;
  contextWindow: number;
  maxOutput: number;
  /** USD per million tokens. */
  pricePerMTok: ModelPrice;
}
export interface RawUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export class UnknownModelError extends Error {
  constructor(id: string) {
    super(`Unknown model: ${id}`);
    this.name = 'UnknownModelError';
  }
}

const price = (input: number, output: number, cacheRead = input * 0.1, cacheWrite = input * 1.25): ModelPrice =>
  ({ input, output, cacheRead, cacheWrite });

/** Current Claude models as of 2026-09-18. Cache read is 10% of input and cache write 125% unless stated. */
export const DEFAULT_MODELS: readonly ModelSpec[] = [
  { id: 'claude-fable-5-1', family: 'fable', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(10, 50, 0.25) },
  { id: 'claude-fable-5', family: 'fable', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(10, 50) },
  { id: 'claude-opus-5', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-opus-4-8', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-opus-4-7', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-opus-4-6', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-sonnet-5', family: 'sonnet', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(2, 10) },
  { id: 'claude-sonnet-4-6', family: 'sonnet', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(3, 15) },
  { id: 'claude-haiku-4-5', family: 'haiku', contextWindow: 200_000, maxOutput: 64_000, pricePerMTok: price(1, 5) },
];

export interface ModelCatalog {
  get(id: ModelId): ModelSpec;
  has(id: ModelId): boolean;
  list(): ModelSpec[];
  costOf(id: ModelId, usage: RawUsage): number;
}

export function createCatalog(overrides: readonly ModelSpec[] = []): ModelCatalog {
  const specs = new Map<ModelId, ModelSpec>();
  for (const s of DEFAULT_MODELS) specs.set(s.id, s);
  for (const s of overrides) specs.set(s.id, s);
  const get = (id: ModelId): ModelSpec => {
    const s = specs.get(id);
    if (!s) throw new UnknownModelError(id);
    return s;
  };
  return {
    get,
    has: (id) => specs.has(id),
    list: () => [...specs.values()],
    costOf: (id, u) => {
      const p = get(id).pricePerMTok;
      return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
    },
  };
}
