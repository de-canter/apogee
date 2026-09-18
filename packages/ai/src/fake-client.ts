import { nowIso } from '@apogee/kernel';
import type { z } from 'zod';
import { createCatalog } from './catalog';
import type { RawUsage } from './catalog';
import { AiError, StructuredOutputError } from './errors';
import { DEFAULT_ROLE_MAP, staticResolver } from './models';
import type { CallOptions, ModelClient, StructuredResult } from './anthropic-client';
import type { GenerateRequest, GenerateResult, ModelEvent, StopReason, ToolUse, Usage } from './types';
import { createUsageLedger, type UsageOperation, type UsageSink } from './usage';

/** One scripted model turn. */
export interface FakeTurn {
  text?: string;
  toolUses?: ToolUse[];
  /** Returned by generateObject; validated against the caller's schema so tests catch drift. */
  object?: unknown;
  stopReason?: StopReason;
  usage?: Partial<RawUsage>;
  /** Thrown (generate/generateObject) or emitted as an error event (stream). */
  error?: AiError;
}

export type FakeScript = FakeTurn[] | ((req: GenerateRequest, index: number) => FakeTurn);

export interface FakeModelClient extends ModelClient {
  readonly calls: GenerateRequest[];
}

const CHUNK = 5;

/** A ModelClient that replays a script. Downstream packages test against this, never the network. */
export function createFakeModelClient(script: FakeScript, options: { usageSink?: UsageSink } = {}): FakeModelClient {
  const catalog = createCatalog();
  const resolveModel = staticResolver(DEFAULT_ROLE_MAP);
  const usage = createUsageLedger(options.usageSink);
  const calls: GenerateRequest[] = [];
  const queue = Array.isArray(script) ? [...script] : undefined;

  const next = (req: GenerateRequest): FakeTurn => {
    calls.push(req);
    if (queue) {
      return queue.shift() ?? { error: new AiError('Fake script exhausted', 'SCRIPT_EXHAUSTED') };
    }
    return (script as (r: GenerateRequest, i: number) => FakeTurn)(req, calls.length - 1);
  };

  const priced = (req: GenerateRequest, t: FakeTurn): Usage => {
    const model = resolveModel(req.model ?? 'default');
    const raw: RawUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...t.usage };
    return { model, ...raw, costUsd: catalog.costOf(model, raw) };
  };

  const record = (req: GenerateRequest, u: Usage, operation: UsageOperation, opts: CallOptions): void => {
    usage.record({ ...u, at: nowIso(), operation, role: req.model ?? 'default', ...(opts.label !== undefined ? { label: opts.label } : {}) });
  };

  return {
    usage,
    resolveModel,
    catalog,
    calls,

    generate(req, opts = {}): Promise<GenerateResult> {
      const t = next(req);
      if (t.error) return Promise.reject(t.error);
      const u = priced(req, t);
      record(req, u, 'generate', opts);
      const toolUses = t.toolUses ?? [];
      return Promise.resolve({
        text: t.text ?? '',
        toolUses,
        stopReason: t.stopReason ?? (toolUses.length > 0 ? 'tool_use' : 'end_turn'),
        usage: u,
        raw: t,
      });
    },

    generateObject<T>(schema: z.ZodType<T>, req: GenerateRequest, opts: CallOptions = {}): Promise<StructuredResult<T>> {
      const t = next(req);
      if (t.error) return Promise.reject(t.error);
      const u = priced(req, t);
      record(req, u, 'generateObject', opts);
      const result = schema.safeParse(t.object);
      if (!result.success) return Promise.reject(new StructuredOutputError(JSON.stringify(t.object), result.error.issues));
      return Promise.resolve({ value: result.data, usage: u, raw: t });
    },

    stream(req, opts = {}): AsyncIterable<ModelEvent> {
      const t = next(req);
      async function* run(): AsyncGenerator<ModelEvent, void, undefined> {
        await Promise.resolve();
        if (t.error) {
          yield { type: 'error', error: t.error };
          return;
        }
        const text = t.text ?? '';
        for (let i = 0; i < text.length; i += CHUNK) yield { type: 'text_delta', text: text.slice(i, i + CHUNK) };
        const toolUses = t.toolUses ?? [];
        for (const tu of toolUses) {
          yield { type: 'tool_use_start', id: tu.id, name: tu.name };
          yield { type: 'tool_use_delta', id: tu.id, partialJson: JSON.stringify(tu.input) };
          yield { type: 'tool_use_end', id: tu.id, name: tu.name, input: tu.input };
        }
        const u = priced(req, t);
        record(req, u, 'stream', opts);
        yield { type: 'message_end', stopReason: t.stopReason ?? (toolUses.length > 0 ? 'tool_use' : 'end_turn'), usage: u, text, toolUses };
      }
      return run();
    },
  };
}
