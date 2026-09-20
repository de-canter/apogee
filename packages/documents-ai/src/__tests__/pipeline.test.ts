import { isoDate } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { DocumentsError } from '../errors';
import { createInMemoryPipelineStore, definePipeline, progressOf, resumePipeline, runPipeline, type PipelineStore, type Stage } from '../pipeline';

interface State { n: number; log: string[] }
const now = () => isoDate('2026-09-19T12:00:00Z');
const clock = () => { let t = 0; return () => (t += 10); };

const add = (name: string, by: number): Stage<State, { mult: number }> => ({
  name,
  run: (s, ctx) => Promise.resolve({ n: s.n + by * ctx.mult, log: [...s.log, name] }),
});

function counting<T>(store: PipelineStore<T>): PipelineStore<T> & { saves: number } {
  const wrapped = { ...store, saves: 0, save: (run: Parameters<PipelineStore<T>['save']>[0]) => { wrapped.saves += 1; return store.save(run); } };
  return wrapped;
}

describe('definePipeline', () => {
  it('rejects duplicate stage names', () => {
    expect(() => definePipeline<State, { mult: number }>({ name: 'p', stages: [add('a', 1), add('a', 2)] })).toThrow(DocumentsError);
  });
});

describe('runPipeline', () => {
  const pipeline = definePipeline({ name: 'sum', stages: [add('a', 1), add('b', 2), add('c', 3)] });

  it('runs stages in order, patches state, checkpoints after each transition', async () => {
    const store = counting(createInMemoryPipelineStore<State>());
    const run = await runPipeline(pipeline, { n: 0, log: [] }, { ctx: { mult: 10 }, store, now, clock: clock(), runId: 'run-1' });
    expect(run).toMatchObject({ id: 'run-1', pipeline: 'sum', status: 'completed', state: { n: 60, log: ['a', 'b', 'c'] }, startedAt: '2026-09-19T12:00:00.000Z' });
    expect(run.completedAt).toBeDefined();
    expect(run.currentStage).toBeUndefined();
    expect(run.stages.map((s) => s.status)).toEqual(['completed', 'completed', 'completed']);
    expect(run.stages[0]).toMatchObject({ stage: 'a', durationMs: 10 });
    expect(store.saves).toBe(8);
    expect(progressOf(run)).toEqual({ completed: 3, total: 3, percent: 100 });
    expect((await store.get('run-1'))?.status).toBe('completed');
  });

  it('skips stages by option or predicate', async () => {
    const guarded = definePipeline<State, { mult: number }>({ name: 'g', stages: [add('a', 1), { ...add('b', 2), when: (s) => s.n > 100 }, add('c', 3)] });
    const run = await runPipeline(guarded, { n: 0, log: [] }, { ctx: { mult: 1 }, skip: ['c'], now });
    expect(run.stages.map((s) => `${s.stage}:${s.status}`)).toEqual(['a:completed', 'b:skipped', 'c:skipped']);
    expect(run.state.n).toBe(1);
    expect(progressOf(run)).toEqual({ completed: 3, total: 3, percent: 100 });
  });

  it('records a failed stage with its error and leaves the rest pending', async () => {
    let boom = true;
    const flaky: Stage<State, { mult: number }> = { name: 'b', run: () => (boom ? Promise.reject(new Error('boom')) : Promise.resolve({ n: 99 })) };
    const p = definePipeline({ name: 'f', stages: [add('a', 1), flaky, add('c', 3)] });
    const store = createInMemoryPipelineStore<State>();
    const seen: string[] = [];
    const failed = await runPipeline(p, { n: 0, log: [] }, { ctx: { mult: 1 }, store, runId: 'r', now, onStage: (r) => seen.push(`${r.stage}:${r.status}`) });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('boom');
    expect(failed.currentStage).toBe('b');
    expect(failed.stages.map((s) => `${s.stage}:${s.status}`)).toEqual(['a:completed', 'b:failed', 'c:pending']);
    expect(failed.stages[1]?.error).toBe('boom');
    expect(seen).toEqual(['a:running', 'a:completed', 'b:running', 'b:failed']);

    boom = false;
    const resumed = await resumePipeline(p, 'r', { ctx: { mult: 1 }, store, now });
    expect(resumed.status).toBe('completed');
    expect(resumed.state).toEqual({ n: 102, log: ['a', 'c'] });
    expect(resumed.stages.map((s) => s.status)).toEqual(['completed', 'completed', 'completed']);
    expect(await resumePipeline(p, 'r', { ctx: { mult: 1 }, store, now })).toEqual(resumed);
    await expect(resumePipeline(p, 'missing', { ctx: { mult: 1 }, store, now })).rejects.toBeInstanceOf(DocumentsError);
  });
});
