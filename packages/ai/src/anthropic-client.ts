import Anthropic from '@anthropic-ai/sdk';
import { nowIso } from '@apogee/kernel';
import { z } from 'zod';
import { createCatalog, type ModelCatalog, type ModelId } from './catalog';
import { AiError, RefusalError, StructuredOutputError, mapSdkError } from './errors';
import { DEFAULT_ROLE_MAP, staticResolver, type ModelResolver, type ModelRole } from './models';
import { buildMessageParams } from './params';
import { normalizeStream } from './stream';
import type { GenerateRequest, GenerateResult, ModelEvent, StopReason, ToolUse, Usage } from './types';
import { createUsageLedger, usageFromSdk, type UsageLedger, type UsageOperation, type UsageSink } from './usage';

/** The slice of the Anthropic SDK this package touches. Tests inject a fake. */
export interface AnthropicLike {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
    stream(params: Anthropic.MessageCreateParams): AsyncIterable<Anthropic.MessageStreamEvent>;
  };
}

export interface CallOptions { label?: string }

export interface StructuredResult<T> { value: T; usage: Usage; raw: unknown }

export interface ModelClient {
  generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult>;
  generateObject<T>(schema: z.ZodType<T>, req: GenerateRequest, opts?: CallOptions): Promise<StructuredResult<T>>;
  stream(req: GenerateRequest, opts?: CallOptions): AsyncIterable<ModelEvent>;
  readonly usage: UsageLedger;
  readonly resolveModel: ModelResolver;
  readonly catalog: ModelCatalog;
}

export interface ModelClientOptions {
  sdk?: AnthropicLike;
  apiKey?: string;
  resolveModel?: ModelResolver;
  catalog?: ModelCatalog;
  usageSink?: UsageSink;
  /** Retries on retryable errors (rate limit, overloaded, server, connection). Default 2. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, maxRetries: number, sleep: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = mapSdkError(e);
      if (!err.retryable || attempt >= maxRetries) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

function extract(message: Anthropic.Message): { text: string; toolUses: ToolUse[] } {
  let text = '';
  const toolUses: ToolUse[] = [];
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input });
  }
  return { text, toolUses };
}

/** The only place in the framework that constructs the Anthropic SDK client. */
export function createAnthropicModelClient(options: ModelClientOptions = {}): ModelClient {
  const sdk: AnthropicLike = options.sdk ?? new Anthropic({ ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}), maxRetries: 0 });
  const catalog = options.catalog ?? createCatalog();
  const resolveModel = options.resolveModel ?? staticResolver(DEFAULT_ROLE_MAP);
  const usage = createUsageLedger(options.usageSink);
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? defaultSleep;

  const record = (u: Usage, operation: UsageOperation, role: ModelRole, label?: string): void => {
    usage.record({ ...u, at: nowIso(), operation, role, ...(label !== undefined ? { label } : {}) });
  };

  const call = async (req: GenerateRequest, model: ModelId, extra: Partial<Anthropic.MessageCreateParamsNonStreaming> = {}): Promise<Anthropic.Message> => {
    const params = buildMessageParams(req, { model, streaming: false });
    return withRetry(() => sdk.messages.create({ ...params, ...extra, stream: false }), maxRetries, sleep);
  };

  return {
    usage,
    resolveModel,
    catalog,

    async generate(req, opts = {}) {
      const role = req.model ?? 'default';
      const model = resolveModel(role);
      const message = await call(req, model);
      const u = usageFromSdk(model, catalog, message.usage);
      record(u, 'generate', role, opts.label);
      if (message.stop_reason === 'refusal') {
        throw new RefusalError(message.stop_details?.category ?? undefined, message.stop_details?.explanation ?? undefined);
      }
      const { text, toolUses } = extract(message);
      return { text, toolUses, stopReason: (message.stop_reason ?? 'end_turn') as StopReason, usage: u, raw: message };
    },

    async generateObject(schema, req, opts = {}) {
      const role = req.model ?? 'default';
      const model = resolveModel(role);
      const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
      const { tools, ...rest } = req;
      const message = await call({ maxTokens: 4096, ...rest }, model, {
        output_config: { ...(req.effort ? { effort: req.effort } : {}), format: { type: 'json_schema', schema: jsonSchema } },
      });
      const u = usageFromSdk(model, catalog, message.usage);
      record(u, 'generateObject', role, opts.label);
      if (message.stop_reason === 'refusal') {
        throw new RefusalError(message.stop_details?.category ?? undefined, message.stop_details?.explanation ?? undefined);
      }
      const { text } = extract(message);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        throw new StructuredOutputError(text, [{ message: e instanceof Error ? e.message : 'invalid JSON' }]);
      }
      const result = schema.safeParse(parsed);
      if (!result.success) throw new StructuredOutputError(text, result.error.issues);
      return { value: result.data, usage: u, raw: message };
    },

    stream(req, opts = {}) {
      const role = req.model ?? 'default';
      const model = resolveModel(role);
      async function* run(): AsyncGenerator<ModelEvent, void, undefined> {
        let events: AsyncIterable<Anthropic.MessageStreamEvent>;
        try {
          events = sdk.messages.stream(buildMessageParams(req, { model, streaming: true }));
        } catch (e) {
          yield { type: 'error', error: mapSdkError(e) };
          return;
        }
        for await (const ev of normalizeStream(events, { model, catalog })) {
          if (ev.type === 'message_end') record(ev.usage, 'stream', role, opts.label);
          yield ev;
        }
      }
      return run();
    },
  };
}

export { AiError };
