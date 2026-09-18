# @apogee/agent

The agentic session: a tool loop over `@apogee/ai`, one event stream that is
also the SSE wire protocol, history compaction, bounded config memory, and
persistence ports with in-memory implementations. Spec:
`docs/design/ai-abstractions.md` §3.3.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Tools | `defineTool`, `createToolRegistry`, `Tool<TCtx, TInput>`, `ToolResult` | Zod-typed input, `execute(input, { ctx, toolUseId, sessionId })`, results may carry `artifact`(s) |
| Session | `createAgentSession({ sessionId, client, prompt, tools, ctx, ... })` | `run(input, { annotations })` yields `AgentEvent`s; `history()`, `setContext()` |
| Events | `AgentEvent` | `text_delta`, `tool_call`, `tool_result` (with `isError`), `artifact`, `turn_end` (message, usage, rounds, stopReason), `error` |
| Messages | `AgentMessage`, `toModelMessages` | `content` is what the UI shows; `annotations` are what only the model sees; `blocks` replay tool turns exactly; `hidden` marks intermediate turns |
| SSE | `encodeAgentEvent`, `agentEventsToReadableStream`, `pipeAgentEventsToNode`, `SSE_HEADERS` | one frame per event; web `Response` body or Node `reply.raw` |
| Ports | `SessionStore`, `MessageStore`, `TelemetrySink`, `MemoryPort` | in-memory implementations included; adapters live in separate packages |
| Registry | `createSessionRegistry({ idleMs })` | in-process cache of live sessions with idle eviction |
| Memory | `memoryTool(...)`, `memoryContributor(...)` | a bounded design-memory document the agent rewrites and the prompt injects |
| Compaction | `compactHistory`, `pruneToBudget` | summarize older turns into one `summary` message once history passes a token budget |

## Guarantees

- Every tool call carries the provider's `toolUseId` from `tool_call` through `tool_result`, `artifact`, and the persisted `toolCalls`.
- Every `turn_end` carries usage summed across all rounds of the turn.
- Tool failures (throw, unknown tool, invalid input) become `is_error` tool results the model can read; they never throw out of the loop.
- Rounds are bounded (`maxRounds`, default 10); exhaustion ends the turn with `stopReason: 'max_rounds'` and a configurable message.
- Telemetry, stores, and memory are session options, so they survive session restore.

## Example

```ts
const session = createAgentSession({
  sessionId, client, prompt, ctx: { tenant },
  tools: [addNote, memoryTool({ port, keyFromCtx: (c) => c.tenant, byFromCtx: () => 'agent' })],
  contributors: { memory: memoryContributor({ port, keyFromCtx: (c) => c.tenant }) },
  messages: messageStore, telemetry: sink, compaction: { budgetTokens: 80_000 },
});
return new Response(agentEventsToReadableStream(session.run(text, { annotations })), { headers: SSE_HEADERS });
```
