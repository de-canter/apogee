import type { ContentBlock, ModelClient, ModelEvent, ModelRole, RawUsage, Usage } from '@apogee/ai';
import { nowIso, type ISODate } from '@apogee/kernel';
import { composePrompt, toSystemBlocks, type Contributor, type Prompt } from '@apogee/prompts';
import { compactHistory, type CompactionOptions } from './compaction';
import type { AgentEvent, TurnStopReason } from './events';
import { newMessageId, toModelMessages, type AgentMessage, type ToolCallRecord } from './messages';
import { SessionNotFoundError, type MessageStore, type SessionStore } from './stores';
import { createTelemetryRecorder, type TelemetryRecorder, type TelemetrySink } from './telemetry';
import { artifactsOf, createToolRegistry, toolResultContent, type AnyTool, type ArtifactDescriptor, type ToolRegistry, type ToolResult } from './tool';

export interface AgentSessionOptions<TCtx> {
  sessionId: string;
  client: ModelClient;
  prompt: Prompt<TCtx>;
  contributors?: Record<string, Contributor<TCtx>>;
  tools?: readonly AnyTool<TCtx>[];
  ctx: TCtx;
  model?: ModelRole;
  maxRounds?: number;
  maxRoundsMessage?: string;
  history?: AgentMessage[];
  messages?: MessageStore;
  sessions?: SessionStore;
  telemetry?: TelemetrySink;
  compaction?: Omit<CompactionOptions, 'client'> | false;
  now?: () => ISODate;
  clock?: () => number;
}

export interface RunOptions {
  /** Server-side text the model sees but the UI does not (artifact actions, uploads). */
  annotations?: string[];
  label?: string;
}

export interface AgentSession<TCtx> {
  readonly sessionId: string;
  readonly tools: ToolRegistry<TCtx>;
  run(input: string | ContentBlock[], opts?: RunOptions): AsyncIterable<AgentEvent>;
  history(): AgentMessage[];
  getContext(): TCtx;
  setContext(patch: Partial<TCtx>): void;
}

export const DEFAULT_MAX_ROUNDS = 10;
export const DEFAULT_MAX_ROUNDS_MESSAGE =
  'I completed several steps but reached the maximum number of tool execution rounds. Please continue the conversation to proceed further.';

const zeroUsage = (model: string): Usage => ({ model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
function addUsage(a: Usage, b: Usage): Usage {
  const sum = (k: keyof RawUsage): number => a[k] + b[k];
  return { model: b.model, input: sum('input'), output: sum('output'), cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'), costUsd: a.costUsd + b.costUsd };
}

interface ExecutedTool { record: ToolCallRecord; artifacts: ArtifactDescriptor[] }

export function createAgentSession<TCtx>(options: AgentSessionOptions<TCtx>): AgentSession<TCtx> {
  const { sessionId, client } = options;
  const now = options.now ?? nowIso;
  const clock = options.clock ?? (() => Date.now());
  const tools = createToolRegistry<TCtx>(options.tools ?? []);
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const telemetry: TelemetryRecorder | undefined = options.telemetry ? createTelemetryRecorder(options.telemetry, { now, clock }) : undefined;
  let ctx: TCtx = options.ctx;
  let history: AgentMessage[] = [...(options.history ?? [])];

  const record = (type: Parameters<TelemetryRecorder['record']>[1], data?: Record<string, unknown>): void => telemetry?.record(sessionId, type, data);

  const persist = async (m: AgentMessage): Promise<void> => {
    history.push(m);
    if (options.messages) await options.messages.append(sessionId, m);
  };

  const touchSession = async (): Promise<void> => {
    if (!options.sessions) return;
    try {
      await options.sessions.update(sessionId, { messageCount: history.length, lastMessageAt: now() });
    } catch (e) {
      if (!(e instanceof SessionNotFoundError)) throw e;
    }
  };

  const executeTool = async (toolUseId: string, name: string, input: unknown): Promise<ExecutedTool> => {
    const started = clock();
    record('tool_start', { toolUseId, name, input });
    const tool = tools.get(name);
    let result: ToolResult;
    if (!tool) {
      result = { success: false, error: `Error: Tool ${name} not found` };
    } else {
      const parsed = tool.input.safeParse(input);
      if (!parsed.success) {
        result = { success: false, error: `Error: invalid input: ${JSON.stringify(parsed.error.issues)}` };
      } else {
        try {
          result = await tool.execute(parsed.data as never, { ctx, toolUseId, sessionId });
        } catch (e) {
          result = { success: false, error: `Error: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
    }
    const durationMs = clock() - started;
    const isError = !result.success;
    record(isError ? 'tool_error' : 'tool_complete', { toolUseId, name, durationMs, ...(isError ? { error: result.error } : {}) });
    return { record: { toolUseId, name, input, result, durationMs, isError }, artifacts: artifactsOf(result) };
  };

  async function* run(input: string | ContentBlock[], opts: RunOptions = {}): AsyncGenerator<AgentEvent, void, undefined> {
    if (options.compaction !== false && options.compaction !== undefined) {
      const c = await compactHistory(history, { ...options.compaction, client, now });
      if (c.compacted) {
        history = c.history;
        if (options.messages) await options.messages.replace(sessionId, history);
        record('compaction', { kept: history.length });
      }
    }

    const userMessage: AgentMessage = {
      id: newMessageId(),
      role: 'user',
      content: typeof input === 'string' ? input : input.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n'),
      ...(typeof input === 'string' ? {} : { blocks: input }),
      ...(opts.annotations && opts.annotations.length > 0 ? { annotations: opts.annotations } : {}),
      at: now(),
    };
    await persist(userMessage);
    record('user_message', { content: userMessage.content, annotations: opts.annotations ?? [] });

    const model = options.model ?? 'default';
    let usage = zeroUsage(client.resolveModel(model));
    const allCalls: ToolCallRecord[] = [];
    const allArtifacts: ArtifactDescriptor[] = [];

    for (let round = 1; round <= maxRounds; round++) {
      const composed = await composePrompt(options.prompt, ctx, { ...(options.contributors ? { contributors: options.contributors } : {}) });
      const defs = tools.definitions();
      const stream = client.stream(
        { model, system: toSystemBlocks(composed), messages: toModelMessages(history), ...(defs.length > 0 ? { tools: defs } : {}) },
        { label: opts.label ?? `agent:${sessionId}:r${round}` },
      );

      let end: Extract<ModelEvent, { type: 'message_end' }> | undefined;
      let failed = false;
      for await (const ev of stream) {
        if (ev.type === 'text_delta') yield ev;
        else if (ev.type === 'error') {
          record('error', { code: ev.error.code, message: ev.error.message });
          yield { type: 'error', error: { code: ev.error.code, message: ev.error.message } };
          failed = true;
          break;
        } else if (ev.type === 'message_end') end = ev;
      }
      if (failed || !end) return;
      usage = addUsage(usage, end.usage);

      if (end.toolUses.length === 0 || end.stopReason === 'refusal' || end.stopReason === 'max_tokens') {
        const stopReason: TurnStopReason = end.stopReason === 'refusal' ? 'refusal' : end.stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn';
        const message: AgentMessage = {
          id: newMessageId(), role: 'assistant', content: end.text, usage,
          ...(allCalls.length > 0 ? { toolCalls: allCalls } : {}),
          ...(allArtifacts.length > 0 ? { artifacts: allArtifacts } : {}),
          at: now(),
        };
        await persist(message);
        await touchSession();
        record('assistant_message', { content: message.content, toolCalls: allCalls.length, rounds: round });
        record('turn_end', { stopReason, rounds: round, usage });
        yield { type: 'turn_end', message, usage, rounds: round, stopReason };
        return;
      }

      // Tool round: replay exactly what the model said, then run the tools.
      const assistantBlocks: ContentBlock[] = [
        ...(end.text.trim() !== '' ? [{ type: 'text' as const, text: end.text }] : []),
        ...end.toolUses.map((t) => ({ type: 'tool_use' as const, id: t.id, name: t.name, input: t.input })),
      ];
      for (const t of end.toolUses) yield { type: 'tool_call', toolUseId: t.id, name: t.name, input: t.input };
      const executed = await Promise.all(end.toolUses.map((t) => executeTool(t.id, t.name, t.input)));
      const roundCalls = executed.map((e) => e.record);
      await persist({ id: newMessageId(), role: 'assistant', content: end.text, blocks: assistantBlocks, toolCalls: roundCalls, usage: end.usage, hidden: true, at: now() });
      for (const e of executed) {
        const r = e.record;
        yield { type: 'tool_result', toolUseId: r.toolUseId, name: r.name, result: r.result!, durationMs: r.durationMs ?? 0, isError: r.isError === true };
        for (const a of e.artifacts) {
          record('artifact', { toolUseId: r.toolUseId, type: a.type, id: a.id });
          yield { type: 'artifact', toolUseId: r.toolUseId, artifact: a };
        }
        allCalls.push(r);
        allArtifacts.push(...e.artifacts);
      }
      const resultBlocks: ContentBlock[] = executed.map((e) => ({
        type: 'tool_result' as const,
        toolUseId: e.record.toolUseId,
        content: toolResultContent(e.record.result!),
        ...(e.record.isError ? { isError: true } : {}),
      }));
      await persist({ id: newMessageId(), role: 'user', content: '', blocks: resultBlocks, hidden: true, at: now() });
    }

    const message: AgentMessage = {
      id: newMessageId(), role: 'assistant', content: options.maxRoundsMessage ?? DEFAULT_MAX_ROUNDS_MESSAGE, usage,
      toolCalls: allCalls, ...(allArtifacts.length > 0 ? { artifacts: allArtifacts } : {}), at: now(),
    };
    await persist(message);
    await touchSession();
    record('assistant_message', { content: message.content, toolCalls: allCalls.length, rounds: maxRounds });
    record('turn_end', { stopReason: 'max_rounds', rounds: maxRounds, usage });
    yield { type: 'turn_end', message, usage, rounds: maxRounds, stopReason: 'max_rounds' };
  }

  return {
    sessionId,
    tools,
    run: (input, opts) => run(input, opts),
    history: () => [...history],
    getContext: () => ctx,
    setContext(patch) {
      const previous = ctx;
      ctx = { ...ctx, ...patch };
      record('context_change', { changedKeys: Object.keys(patch), previous, next: ctx });
    },
  };
}
