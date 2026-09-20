import { isoDate, ref } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { IntegrationsError } from '../errors';
import { approvePattern, createInMemoryPatternStore, definePattern, evaluateTrigger, pausePattern, resumePattern, updatePattern } from '../pattern';

const now = () => isoDate('2026-09-19T12:00:00Z');
const weather = () =>
  definePattern(
    {
      id: 'YARD_WEATHER',
      name: 'Yard weather',
      description: 'Current weather at a yard',
      direction: 'outbound',
      variables: { baseUrl: 'https://api.mock.apogee.build' },
      request: { method: 'GET', urlTemplate: '{{vars.baseUrl}}/weather?lat={{ctx.lat}}&lon={{ctx.lon}}' },
      trigger: { event: 'rental.created', conditions: [{ field: 'yard.name', operator: 'in', value: ['north', 'south'] }, { field: 'total', operator: 'gte', value: 100 }] },
    },
    now,
  );

describe('definePattern', () => {
  it('fills defaults and system provenance', () => {
    const p = weather();
    expect(p).toMatchObject({ status: 'draft', version: 1, response: { mode: 'sync', successCodes: [200, 201, 202, 204], mapping: [] }, ai: { enabled: false, maxResponseChars: 20_000 }, rateLimits: {}, drift: {}, metadata: {} });
    expect(p.request?.retries).toEqual({ max: 3, backoffMs: 1000, maxBackoffMs: 30_000, retryOn: [429, 502, 503, 504] });
    expect(p.request?.timeoutMs).toBe(30_000);
    expect(p.provenance).toEqual({ source: { kind: 'system' }, recordedAt: '2026-09-19T12:00:00.000Z' });
  });
  it('rejects ids outside the pattern code alphabet', () => {
    expect(() => definePattern({ id: 'yard-weather', name: 'x', direction: 'outbound' })).toThrow();
  });
});

describe('lifecycle', () => {
  const jeff = ref('User', 'jeff');
  it('approves, pauses, and resumes only after approval', () => {
    const p = weather();
    const active = approvePattern(p, jeff, now());
    expect(active).toMatchObject({ status: 'active', version: 2, approvedBy: jeff, approvedAt: '2026-09-19T12:00:00.000Z' });
    const paused = pausePattern(active);
    expect(paused.status).toBe('paused');
    expect(resumePattern(paused).status).toBe('active');
    expect(() => resumePattern({ ...p, status: 'paused' })).toThrow(IntegrationsError);
    expect(() => pausePattern(p)).toThrow(/draft/);
  });
  it('updates bump the version and send behavior changes back to draft', () => {
    const active = approvePattern(weather(), jeff);
    const renamed = updatePattern(active, { description: 'Renamed' });
    expect(renamed).toMatchObject({ status: 'active', version: 3, description: 'Renamed' });
    const changed = updatePattern(active, { request: { method: 'GET', urlTemplate: '{{vars.baseUrl}}/v2/weather' } });
    expect(changed.status).toBe('draft');
    expect(changed.request?.urlTemplate).toBe('{{vars.baseUrl}}/v2/weather');
    expect(changed.request?.retries.max).toBe(3);
  });
});

describe('evaluateTrigger', () => {
  const p = weather();
  it('requires the event and every condition', () => {
    const ok = evaluateTrigger(p, { yard: { name: 'north' }, total: 250 }, 'rental.created');
    expect(ok.matched).toBe(true);
    expect(ok.eventMatched).toBe(true);
    expect(ok.results.map((r) => r.passed)).toEqual([true, true]);
    expect(evaluateTrigger(p, { yard: { name: 'east' }, total: 250 }, 'rental.created').matched).toBe(false);
    expect(evaluateTrigger(p, { yard: { name: 'north' }, total: 250 }, 'rental.returned').eventMatched).toBe(false);
    expect(evaluateTrigger(p, { yard: { name: 'north' }, total: 250 }).eventMatched).toBe(false);
  });
  it('covers every operator', () => {
    const cases: Array<[string, unknown, unknown, boolean]> = [
      ['equals', 'a', 'a', true], ['equals', 1, '1', false], ['not_equals', 'a', 'b', true], ['exists', 0, undefined, true], ['exists', null, undefined, false],
      ['contains', 'north yard', 'yard', true], ['contains', ['a', 'b'], 'b', true], ['contains', 'x', 'y', false],
      ['gt', 5, 3, true], ['gte', 3, 3, true], ['lt', 2, 3, true], ['lte', 3, 3, true], ['gt', 'x', 3, false],
      ['in', 'a', ['a', 'b'], true], ['in', 'c', ['a', 'b'], false], ['not_in', 'c', ['a', 'b'], true],
    ];
    for (const [operator, actual, value, passed] of cases) {
      const pattern = definePattern({ id: 'T', name: 't', direction: 'outbound', trigger: { conditions: [{ field: 'x', operator: operator as 'equals', value }] } });
      expect(evaluateTrigger(pattern, { x: actual }).results[0]!.passed, `${operator} ${String(actual)} ${String(value)}`).toBe(passed);
    }
  });
  it('matches when there is nothing to check', () => {
    expect(evaluateTrigger(definePattern({ id: 'T', name: 't', direction: 'outbound' }), {}).matched).toBe(true);
  });
});

describe('createInMemoryPatternStore', () => {
  it('stores copies and searches name and description', async () => {
    const store = createInMemoryPatternStore([weather(), definePattern({ id: 'GEOCODE', name: 'Geocode address', direction: 'outbound', description: 'Lat and lon for a city' })]);
    expect((await store.list()).map((p) => p.id)).toEqual(['GEOCODE', 'YARD_WEATHER']);
    expect((await store.list({ search: 'WEATHER' })).map((p) => p.id)).toEqual(['YARD_WEATHER']);
    expect((await store.list({ search: 'lat and' })).map((p) => p.id)).toEqual(['GEOCODE']);
    expect((await store.list({ status: 'active' })).length).toBe(0);
    const p = (await store.get('GEOCODE'))!;
    p.name = 'mutated';
    expect((await store.get('GEOCODE'))?.name).toBe('Geocode address');
    await store.upsert({ ...p, name: 'Geocode' });
    expect((await store.get('GEOCODE'))?.name).toBe('Geocode');
    expect(await store.remove('GEOCODE')).toBe(true);
    expect(await store.remove('GEOCODE')).toBe(false);
  });
});
