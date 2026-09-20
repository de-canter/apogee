import { assertion, nowIso, type Ref } from '@apogee/kernel';
import { classify, newDocumentRef, type Classification, type ClassifyOptions } from './classify';
import { confidence } from './confidence';
import { runFromClassification, runFromExtraction, type DocumentAuditSink } from './correction';
import { extract, type Extraction, type ExtractionSet, type ExtractOptions } from './extract';
import type { DocumentInput } from './input';
import { definePipeline, runPipeline, type Pipeline, type PipelineRun, type PipelineStore } from './pipeline';
import type { DocumentEngineOptions } from './prompts';
import { UNKNOWN_CODE } from './taxonomy';

export interface ProcessState<C extends string> {
  input: DocumentInput;
  subject: Ref;
  expectedCode?: C;
  classification?: Classification<C>;
  extraction?: Extraction<C, Record<string, unknown>>;
}

export interface ProcessContext<C extends string> {
  engine: DocumentEngineOptions<C>;
  extractions: ExtractionSet<C>;
  audit?: DocumentAuditSink;
  classify?: ClassifyOptions;
  extract?: ExtractOptions;
}

export const USER_SPECIFIED = 'user-specified';

function synthesized<C extends string>(state: ProcessState<C>, ctx: ProcessContext<C>): Classification<C> {
  const code = state.expectedCode!;
  const recordedAt = (ctx.engine.now ?? nowIso)();
  const model = ctx.engine.client?.resolveModel('default') ?? 'claude-haiku-4-5';
  return {
    code,
    ...(ctx.engine.taxonomy.byCode(code) ? { type: ctx.engine.taxonomy.byCode(code)! } : {}),
    confidence: confidence(1, [USER_SPECIFIED], ctx.engine.bands),
    reasoning: USER_SPECIFIED,
    assertion: assertion({ id: crypto.randomUUID(), subject: state.subject, predicate: 'classified-as', object: { code, reasoning: USER_SPECIFIED }, provenance: { source: { kind: 'human' }, method: USER_SPECIFIED, confidence: 1, recordedAt } }),
    subject: state.subject,
    usage: { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    durationMs: 0,
  };
}

/** classify (skipped when the caller names the type) then extract (skipped for unknown or undefined types). */
export function documentPipeline<C extends string>(): Pipeline<ProcessState<C>, ProcessContext<C>> {
  return definePipeline<ProcessState<C>, ProcessContext<C>>({
    name: 'document',
    stages: [
      {
        name: 'classify',
        when: (state) => (state.expectedCode !== undefined ? USER_SPECIFIED : true),
        async run(state, ctx) {
          const classification = await classify(state.input, ctx.engine, { ...ctx.classify, subject: state.subject });
          if (ctx.audit) await ctx.audit.recordRun(runFromClassification(classification));
          return { classification };
        },
      },
      {
        name: 'extract',
        when: (state, ctx) => {
          const code = state.expectedCode ?? state.classification?.code;
          if (code === undefined || code === UNKNOWN_CODE) return 'unknown type';
          return ctx.extractions.get(code) ? true : `no extraction defined for ${code}`;
        },
        async run(state, ctx) {
          const code = state.expectedCode ?? state.classification!.code;
          const def = ctx.extractions.get(code)!;
          const extraction = await extract(def, state.input, ctx.engine, { ...ctx.extract, subject: state.subject });
          if (ctx.audit) await ctx.audit.recordRun(runFromExtraction(extraction));
          return { extraction };
        },
      },
    ],
  });
}

export interface ProcessOptions<C extends string> {
  subject?: Ref;
  expectedCode?: C;
  store?: PipelineStore<ProcessState<C>>;
  runId?: string;
}

/** The whole intake for one document as a resumable pipeline run. */
export async function processDocument<C extends string>(input: DocumentInput, ctx: ProcessContext<C>, opts: ProcessOptions<C> = {}): Promise<PipelineRun<ProcessState<C>>> {
  const subject = opts.subject ?? newDocumentRef();
  const initial: ProcessState<C> = { input, subject, ...(opts.expectedCode !== undefined ? { expectedCode: opts.expectedCode } : {}) };
  const pipeline = documentPipeline<C>();
  const run = await runPipeline(pipeline, initial, {
    ctx,
    ...(opts.store ? { store: opts.store } : {}),
    ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
    ...(ctx.engine.now ? { now: ctx.engine.now } : {}),
    ...(ctx.engine.clock ? { clock: ctx.engine.clock } : {}),
  });
  if (run.state.expectedCode !== undefined && run.state.classification === undefined) {
    run.state = { ...run.state, classification: synthesized(run.state, ctx) };
  }
  return run;
}
