import { nowIso, type ISODate } from '@de_canter/apogee-kernel';
import { DocumentsError } from './errors';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StageResult {
  stage: string;
  status: StageStatus;
  startedAt?: ISODate;
  completedAt?: ISODate;
  durationMs?: number;
  error?: string;
  note?: string;
}

export interface Stage<TState, TCtx> {
  name: string;
  /** Returns a patch merged into the state, or a `{ patch, note }` pair; may return undefined. */
  run: (state: TState, ctx: TCtx) => Promise<Partial<TState> | undefined>;
  /** Skipped when this returns false; the returned string becomes the note. */
  when?: (state: TState, ctx: TCtx) => boolean | string;
}

export interface Pipeline<TState, TCtx> { name: string; stages: readonly Stage<TState, TCtx>[] }

export function definePipeline<TState, TCtx = unknown>(p: Pipeline<TState, TCtx>): Pipeline<TState, TCtx> {
  const seen = new Set<string>();
  for (const s of p.stages) {
    if (seen.has(s.name)) throw new DocumentsError(`Duplicate stage "${s.name}" in pipeline ${p.name}`, 'DUPLICATE_STAGE');
    seen.add(s.name);
  }
  return { name: p.name, stages: [...p.stages] };
}

export type RunStatus = 'running' | 'completed' | 'failed';

/** Everything about one execution, persisted after every transition so it can resume. */
export interface PipelineRun<TState> {
  id: string;
  pipeline: string;
  status: RunStatus;
  currentStage?: string;
  stages: StageResult[];
  state: TState;
  startedAt: ISODate;
  completedAt?: ISODate;
  error?: string;
}

export interface PipelineStore<TState> {
  get(id: string): Promise<PipelineRun<TState> | undefined>;
  save(run: PipelineRun<TState>): Promise<void>;
}

export function createInMemoryPipelineStore<TState>(): PipelineStore<TState> {
  const runs = new Map<string, PipelineRun<TState>>();
  return {
    get: (id) => Promise.resolve(runs.has(id) ? structuredClone(runs.get(id)!) : undefined),
    save(run) {
      runs.set(run.id, structuredClone(run));
      return Promise.resolve();
    },
  };
}

export interface RunOptions<TState, TCtx> {
  ctx: TCtx;
  store?: PipelineStore<TState>;
  runId?: string;
  skip?: string[];
  now?: () => ISODate;
  clock?: () => number;
  onStage?: (result: StageResult, run: PipelineRun<TState>) => void;
}

const skipped = <T>(status: StageStatus, run: PipelineRun<T>, name: string): boolean => run.stages.find((s) => s.stage === name)?.status === status;

async function execute<TState, TCtx>(pipeline: Pipeline<TState, TCtx>, run: PipelineRun<TState>, opts: RunOptions<TState, TCtx>): Promise<PipelineRun<TState>> {
  const now = opts.now ?? nowIso;
  const clock = opts.clock ?? (() => Date.now());
  const skip = new Set(opts.skip ?? []);
  const save = async (): Promise<void> => {
    if (opts.store) await opts.store.save(run);
  };
  const emit = (result: StageResult): void => opts.onStage?.(result, run);

  for (const stage of pipeline.stages) {
    const idx = run.stages.findIndex((s) => s.stage === stage.name);
    const current = run.stages[idx]!;
    if (current.status === 'completed' || current.status === 'skipped') continue;
    const when = skip.has(stage.name) ? false : (stage.when?.(run.state, opts.ctx) ?? true);
    if (when === false || typeof when === 'string') {
      const skip: StageResult = { stage: stage.name, status: 'skipped', ...(typeof when === 'string' ? { note: when } : {}) };
      run.stages[idx] = skip;
      emit(skip);
      await save();
      continue;
    }
    const started = clock();
    run.currentStage = stage.name;
    const running: StageResult = { stage: stage.name, status: 'running', startedAt: now() };
    run.stages[idx] = running;
    emit(running);
    await save();
    try {
      const patch = await stage.run(run.state, opts.ctx);
      if (patch) run.state = { ...run.state, ...patch };
      const completed: StageResult = { ...running, status: 'completed', completedAt: now(), durationMs: clock() - started };
      run.stages[idx] = completed;
      emit(completed);
      await save();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const failed: StageResult = { ...running, status: 'failed', completedAt: now(), durationMs: clock() - started, error };
      run.stages[idx] = failed;
      run.status = 'failed';
      run.error = error;
      run.completedAt = now();
      emit(failed);
      await save();
      return run;
    }
  }
  run.status = 'completed';
  delete run.currentStage;
  delete run.error;
  run.completedAt = now();
  await save();
  return run;
}

/** Stages in order with write-through checkpoints. A throwing stage fails the run (recorded, not thrown). */
export async function runPipeline<TState, TCtx>(pipeline: Pipeline<TState, TCtx>, initial: TState, opts: RunOptions<TState, TCtx>): Promise<PipelineRun<TState>> {
  const now = opts.now ?? nowIso;
  const run: PipelineRun<TState> = {
    id: opts.runId ?? crypto.randomUUID(),
    pipeline: pipeline.name,
    status: 'running',
    stages: pipeline.stages.map((s) => ({ stage: s.name, status: 'pending' })),
    state: initial,
    startedAt: now(),
  };
  if (opts.store) await opts.store.save(run);
  return execute(pipeline, run, opts);
}

/** Continue from the first stage that is not completed or skipped; a failed stage is retried. */
export async function resumePipeline<TState, TCtx>(
  pipeline: Pipeline<TState, TCtx>,
  runId: string,
  opts: Omit<RunOptions<TState, TCtx>, 'runId'> & { store: PipelineStore<TState> },
): Promise<PipelineRun<TState>> {
  const run = await opts.store.get(runId);
  if (!run) throw new DocumentsError(`No pipeline run ${runId}`, 'RUN_NOT_FOUND');
  if (run.status === 'completed') return run;
  run.status = 'running';
  delete run.completedAt;
  delete run.error;
  return execute(pipeline, run, opts);
}

export function progressOf(run: PipelineRun<unknown>): { completed: number; total: number; percent: number } {
  const total = run.stages.length;
  const completed = run.stages.filter((s) => skipped('completed', run, s.stage) || s.status === 'skipped').length;
  return { completed, total, percent: total === 0 ? 100 : Math.round((completed / total) * 100) };
}
