import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../catalog';
import { createUsageLedger, usageFromSdk } from '../usage';

const base = { at: isoDate('2026-01-01'), operation: 'generate' as const, role: 'default' };

describe('usage', () => {
  it('converts SDK usage with nulls treated as zero and prices it', () => {
    const u = usageFromSdk('claude-opus-5', createCatalog(), { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: null, cache_creation_input_tokens: 2000 });
    expect(u).toEqual({ model: 'claude-opus-5', input: 1000, output: 100, cacheRead: 0, cacheWrite: 2000, costUsd: (1000 * 5 + 100 * 25 + 2000 * 6.25) / 1e6 });
  });
  it('ledger totals, groups by model, and forwards to the sink', () => {
    const sink = vi.fn();
    const ledger = createUsageLedger(sink);
    ledger.record({ ...base, model: 'claude-opus-5', input: 10, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 });
    ledger.record({ ...base, model: 'claude-haiku-4-5', input: 20, output: 5, cacheRead: 4, cacheWrite: 0, costUsd: 0.0005 });
    expect(ledger.total()).toEqual({ input: 30, output: 10, cacheRead: 4, cacheWrite: 0, costUsd: 0.0015, calls: 2 });
    expect(ledger.byModel()['claude-haiku-4-5']?.calls).toBe(1);
    expect(sink).toHaveBeenCalledTimes(2);
    ledger.clear();
    expect(ledger.records()).toEqual([]);
  });
  it('captures sink failures instead of dropping them', async () => {
    const ledger = createUsageLedger(() => Promise.reject(new Error('db down')));
    ledger.record({ ...base, model: 'claude-opus-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(ledger.sinkErrors()).toHaveLength(1);
    const sync = createUsageLedger(() => { throw new Error('sync fail'); });
    sync.record({ ...base, model: 'claude-opus-5', input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
    expect(sync.sinkErrors()).toHaveLength(1);
    expect(sync.records()).toHaveLength(1);
  });
});
