import type { ISODate } from '@apogee/kernel';
import type { ModelCatalog, ModelId, RawUsage } from './catalog';
import type { ModelRole } from './models';
import type { Usage } from './types';

export type UsageOperation = 'generate' | 'generateObject' | 'stream';

export interface UsageRecord extends Usage {
  at: ISODate;
  operation: UsageOperation;
  role: ModelRole;
  label?: string;
}

/** Host-supplied persistence for usage records (per tenant, per user, per feature). */
export type UsageSink = (record: UsageRecord) => void | Promise<void>;

export interface UsageTotals extends RawUsage { costUsd: number; calls: number }

export interface UsageLedger {
  record(r: UsageRecord): void;
  total(): UsageTotals;
  byModel(): Record<ModelId, UsageTotals>;
  records(): UsageRecord[];
  /** Rejections from an async sink, so they are never silently dropped. */
  sinkErrors(): unknown[];
  clear(): void;
}

interface SdkUsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageFromSdk(model: ModelId, catalog: ModelCatalog, u: SdkUsageLike): Usage {
  const raw: RawUsage = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  return { model, ...raw, costUsd: catalog.costOf(model, raw) };
}

const empty = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, calls: 0 });

function addInto(t: UsageTotals, u: Usage): void {
  t.input += u.input;
  t.output += u.output;
  t.cacheRead += u.cacheRead;
  t.cacheWrite += u.cacheWrite;
  t.costUsd += u.costUsd;
  t.calls += 1;
}

export function createUsageLedger(sink?: UsageSink): UsageLedger {
  let records: UsageRecord[] = [];
  const errors: unknown[] = [];
  return {
    record(r) {
      records.push(r);
      if (!sink) return;
      try {
        const out = sink(r);
        if (out instanceof Promise) out.catch((e: unknown) => { errors.push(e); });
      } catch (e) {
        errors.push(e);
      }
    },
    total() {
      const t = empty();
      for (const r of records) addInto(t, r);
      return t;
    },
    byModel() {
      const out: Record<ModelId, UsageTotals> = {};
      for (const r of records) addInto((out[r.model] ??= empty()), r);
      return out;
    },
    records: () => [...records],
    sinkErrors: () => [...errors],
    clear() { records = []; },
  };
}
