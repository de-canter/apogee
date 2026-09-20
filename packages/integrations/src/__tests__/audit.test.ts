import { isoDate, ref } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { createInMemoryExecutionAudit, type ExecutionRecordInput } from '../audit';

const rec = (over: Partial<ExecutionRecordInput>): ExecutionRecordInput => ({
  traceId: crypto.randomUUID(), patternId: 'YARD_WEATHER', direction: 'outbound', status: 'success', latencyMs: 100, attempts: 1, aiProcessed: false, ...over,
});

describe('createInMemoryExecutionAudit', () => {
  it('records, reads by trace, lists newest first with filters, and summarizes health', async () => {
    let n = 0;
    const audit = createInMemoryExecutionAudit({ now: () => isoDate(`2026-09-19T12:0${n++}:00Z`), clock: () => Date.parse('2026-09-19T13:00:00Z') });
    const a = rec({ latencyMs: 100 });
    await audit.record(a);
    await audit.record(rec({ status: 'failure', latencyMs: 300, attempts: 3, error: 'HTTP 503' }));
    await audit.record(rec({ status: 'circuit_open', latencyMs: 0 }));
    await audit.record(rec({ patternId: 'GEOCODE', latencyMs: 50, subject: ref('Yard', 'north') }));
    await audit.record(rec({ patternId: 'COURIER', direction: 'inbound', status: 'inbound', latencyMs: 5 }));

    expect(await audit.get(a.traceId)).toEqual({ ...a, at: '2026-09-19T12:00:00.000Z' });
    expect(await audit.get('nope')).toBeUndefined();
    const all = await audit.list();
    expect(all.total).toBe(5);
    expect(all.entries[0]!.patternId).toBe('COURIER');
    expect((await audit.list({ patternId: 'YARD_WEATHER' })).total).toBe(3);
    expect((await audit.list({ status: 'failure' })).entries[0]!.error).toBe('HTTP 503');
    expect((await audit.list({ subject: ref('Yard', 'north') })).total).toBe(1);
    expect((await audit.list({ direction: 'inbound' })).total).toBe(1);
    expect((await audit.list({}, { limit: 2, offset: 4 })).entries).toHaveLength(1);

    const health = await audit.health();
    expect(health.map((h) => h.patternId)).toEqual(['YARD_WEATHER', 'COURIER', 'GEOCODE']);
    expect(health[0]).toEqual({ patternId: 'YARD_WEATHER', total: 3, success: 1, failure: 1, circuitOpen: 1, rateLimited: 0, successRate: 0.5, avgLatencyMs: 200, maxLatencyMs: 300, lastAt: '2026-09-19T12:02:00.000Z' });
    expect((await audit.health('GEOCODE'))[0]).toMatchObject({ total: 1, successRate: 1, avgLatencyMs: 50 });
    expect(await audit.health('NONE')).toEqual([]);
  });
});
