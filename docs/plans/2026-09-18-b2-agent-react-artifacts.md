# Plan B2 — `@apogee/agent` + `@apogee/agent-react` + `@apogee/artifacts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-18
**Origin:** `docs/design/ai-abstractions.md` §3.3–3.5. Contracts lifted from the reference product's `apps/api/src/routes/chat.ts`, `services/admin-chat-service.ts`, `apogee/ai-integration/src/chat/ChatSession.ts`, `apps/web/src/hooks/{use-chat-orchestrator,use-artifact-actions,use-artifact-events}.ts`, and `components/artifacts/{ArtifactRenderer,ArtifactContainer}.tsx` (survey 2026-09-18).

**Goal:** Ship the agentic session (tool loop, compaction, config memory, SSE encoding, persistence ports), the React client (SSE decoder, reducer, hook, unstyled shells), and the artifact protocol (descriptor, registry, renderer, actions, interaction telemetry), all at v0.1.0, tested without network or browser beyond jsdom.

**Architecture:** `@apogee/agent` runs the loop on top of `@apogee/ai`'s `stream` and `@apogee/prompts`' `composePrompt`, emitting a single `AgentEvent` stream that is both the in-process API and, encoded one frame per event, the SSE wire protocol. Every tool call carries the provider's `toolUseId` end to end; every turn ends with accumulated usage; tool failures are `is_error` tool results. Persistence, memory, and telemetry are ports with in-memory implementations. `@apogee/agent-react` decodes the same events into a pure reducer that a hook wraps. `@apogee/artifacts` is the tool-result-as-UI protocol: a descriptor emitted by tools, a registry the host fills with components, and hooks that turn card interactions into the next agent message.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 4 (+ jsdom, Testing Library for the two React packages), tsup, React 18 or 19 as a peer.

**Spec:** `docs/design/ai-abstractions.md` §2 (rules), §3.3, §3.4, §3.5.

## Global Constraints

- Packages: `packages/agent` (`@apogee/agent`), `packages/agent-react` (`@apogee/agent-react`), `packages/artifacts` (`@apogee/artifacts`). Same build/test shape as `packages/ai`.
- `@apogee/ai` grows `tool_use` and `tool_result` content blocks (Task 1) and is bumped to 0.2.0.
- No network in tests: agent tests use `createFakeModelClient`; React tests use jsdom and scripted event iterables.
- Domain vocabulary is injected: the agent's context type, the tool set, the prompt, the artifact card components, and the artifact action types all come from the host. Nothing in these packages knows what an order is.
- Sharp edges to design away (from the survey): usage on every turn; server-minted message ids and provider tool ids on the wire; `tool_result` events with `isError`; artifacts extracted from tool results and persisted on the message; `is_error: true` on failed tool results; max rounds enforced in the one loop; hooks survive restore because they are session options, not route state; idle-based session eviction; bounded config memory.
- Branch `feature/agent`, commit per task, PR to `main`. After merge tag `agent-v0.1.0`, `agent-react-v0.1.0`, `artifacts-v0.1.0`, `ai-v0.2.0`.
- The apogee.build chat demo that §6 assigns to B2 moves to plan B6a (site restructure + first demo), which needs these packages merged first.

## File Structure

```
packages/ai/src/types.ts, params.ts            # + ToolUseBlock, ToolResultBlock (Task 1)
packages/agent/src/
├── index.ts
├── tool.ts          # Tool<TCtx,TInput>, defineTool, ToolContext, ToolResult, ArtifactDescriptor, createToolRegistry
├── messages.ts      # AgentMessage, ToolCallRecord, toModelMessages()
├── events.ts        # AgentEvent union
├── stores.ts        # SessionStore / MessageStore ports + in-memory + createSessionRegistry (idle TTL)
├── telemetry.ts     # TelemetryEvent, TelemetrySink, createTelemetryRecorder
├── memory.ts        # MemoryPort, MemoryDoc, in-memory, memoryTool(), memoryContributor()
├── compaction.ts    # compactHistory() + registered summarization prompt
├── session.ts       # createAgentSession(): the loop
├── sse.ts           # encodeAgentEvent, agentEventsToReadableStream, pipeAgentEventsToNode
└── __tests__/ tool, messages, stores, telemetry, memory, compaction, session, sse
packages/agent-react/src/
├── index.ts
├── sse-decoder.ts   # decodeSseStream(ReadableStream) -> AsyncIterable<AgentEvent>
├── reducer.ts       # AgentUiState, reduceAgentState (pure)
├── use-agent-session.ts
├── components.tsx   # MessageList, Composer, ToolActivity, ContextMeter (unstyled, slotted)
└── __tests__/ sse-decoder, reducer, use-agent-session, components  (+ setup.ts)
packages/artifacts/src/
├── index.ts
├── types.ts         # ArtifactAction, formatArtifactAnnotation
├── registry.ts      # createArtifactRegistry, ArtifactRegistryProvider, useArtifactRegistry
├── ArtifactContainer.tsx
├── ArtifactRenderer.tsx
├── use-artifact-actions.ts
├── use-artifact-events.ts
└── __tests__/ registry, renderer, container, actions, events (+ setup.ts)
```

---

### Task 1: Tool-use content blocks in `@apogee/ai`

**Files:** Modify `packages/ai/src/types.ts`, `packages/ai/src/params.ts`, `packages/ai/package.json` (version 0.2.0). Test: `packages/ai/src/__tests__/params.test.ts`.

**Interfaces:**
- Produces: `ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown }`, `ToolResultBlock = { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }`; `ContentBlock` union includes both. `params.ts` maps them to the SDK's `tool_use` / `tool_result` (`tool_use_id`, `is_error`).

- [ ] **Step 1: Failing test** (append to `params.test.ts`):
```ts
it('maps tool_use and tool_result blocks for multi-round loops', () => {
  const p = buildMessageParams({ messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'Looking up.' }, { type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: '{"ok":true}' }, { type: 'tool_result', toolUseId: 't2', content: 'Error: boom', isError: true }] },
  ] }, { model: 'claude-opus-5', streaming: false });
  const a = p.messages[0]!.content as unknown as Array<Record<string, unknown>>;
  expect(a[1]).toEqual({ type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } });
  const u = p.messages[1]!.content as unknown as Array<Record<string, unknown>>;
  expect(u[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' });
  expect(u[1]).toEqual({ type: 'tool_result', tool_use_id: 't2', content: 'Error: boom', is_error: true });
});
```
- [ ] **Step 2: Implement** the two block types and the two `toSdkBlock` cases; bump version to `0.2.0`.
- [ ] **Step 3: Verify** `pnpm -C packages/ai test && pnpm typecheck && pnpm lint`. **Commit** `feat(ai): add tool_use and tool_result content blocks (0.2.0)`.

---

### Task 2: `@apogee/agent` — tools, messages, events

**Files:** Create `packages/agent/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts}`, `src/tool.ts`, `src/messages.ts`, `src/events.ts`, `src/index.ts`. Tests: `src/__tests__/tool.test.ts`, `src/__tests__/messages.test.ts`.

**Interfaces:**
- `ArtifactDescriptor = { type: string; id: string; data: unknown; props?: Record<string, unknown> }` (JSON-safe).
- `ToolResult = { success: boolean; message?: string; data?: unknown; error?: string; artifact?: ArtifactDescriptor; artifacts?: ArtifactDescriptor[] }`.
- `ToolContext<TCtx> = { ctx: TCtx; toolUseId: string; sessionId: string }`.
- `Tool<TCtx, TInput = unknown> = { name; description; input: z.ZodType<TInput>; execute: (input: TInput, context: ToolContext<TCtx>) => Promise<ToolResult> }`; `defineTool(def)` (identity with inference).
- `ToolRegistry<TCtx> = { get(name); list(); add(tool); remove(name); definitions(): ToolDefinition[] }` where `definitions()` converts each `input` via `z.toJSONSchema` once and caches; `createToolRegistry(tools)`.
- `toolResultContent(result: ToolResult): string` = `JSON.stringify(result)`; `artifactsOf(result): ArtifactDescriptor[]` collects singular and plural.
- `ToolCallRecord = { toolUseId: string; name: string; input: unknown; result?: ToolResult; durationMs?: number; isError?: boolean }`.
- `AgentMessage = { id: string; role: 'user' | 'assistant' | 'summary'; content: string; annotations?: string[]; blocks?: ContentBlock[]; toolCalls?: ToolCallRecord[]; artifacts?: ArtifactDescriptor[]; usage?: Usage; at: ISODate }`. `content` is the user-visible text (for user: what they typed; for assistant: concatenated text). `annotations` are server-side additions (artifact action, uploaded document) that the model sees but the UI does not. `blocks` are the exact model content blocks for assistant tool-use turns and user tool-result turns (so history replays exactly).
- `toModelMessages(history: AgentMessage[]): Message[]`: user → `content` + annotations joined with `\n\n` (or `blocks` if present); assistant → `blocks` if present else `content`; `summary` → the pair `user: "[Conversation summary from earlier in this session]:\n<content>"`, `assistant: "Understood. I have the context from our earlier conversation and will continue from here."`; empty-content messages dropped.
- `newMessageId()` via `nanoid`-style 21-char id (implement with `crypto.randomUUID()` to avoid a dependency).

- [ ] **Step 1: Failing tests** — `tool.test.ts`: `defineTool` infers input; registry `definitions()` yields `{ name, description, inputSchema }` with `inputSchema.type === 'object'` and is referentially stable across calls; `add/remove`; `artifactsOf` merges singular + plural; `toolResultContent` is JSON. `messages.test.ts`: `toModelMessages` on a five-message history (user with annotation, assistant with blocks, user tool_result blocks, summary, user) yields the six model messages in order with the annotation appended and the summary expanded; empty user content dropped.
- [ ] **Step 2: Implement.** `package.json` deps: `@apogee/ai: workspace:*`, `@apogee/kernel: workspace:*`, `@apogee/prompts: workspace:*`, `zod`. Dev: same as ai plus `@types/node`.
- [ ] **Step 3: Verify, commit** `feat(agent): add tool definitions, registry, agent messages, and event types`.

---

### Task 3: Stores, telemetry, memory

**Files:** `src/stores.ts`, `src/telemetry.ts`, `src/memory.ts`; tests for each.

**Interfaces:**
- `SessionRecord = { id: string; ownerId: string; title: string; context: unknown; messageCount: number; createdAt: ISODate; updatedAt: ISODate; lastMessageAt?: ISODate }`.
- `SessionStore = { create(r: Omit<SessionRecord,'createdAt'|'updatedAt'|'messageCount'>): Promise<SessionRecord>; get(id): Promise<SessionRecord | undefined>; update(id, patch: Partial<Pick<SessionRecord,'title'|'context'|'messageCount'|'lastMessageAt'>>): Promise<SessionRecord>; list(ownerId): Promise<SessionRecord[]>; delete(id): Promise<void> }`.
- `MessageStore = { append(sessionId, m: AgentMessage): Promise<void>; list(sessionId): Promise<AgentMessage[]>; replace(sessionId, ms: AgentMessage[]): Promise<void> }` (replace is what compaction uses).
- `createInMemorySessionStore()`, `createInMemoryMessageStore()`.
- `createSessionRegistry<T>({ idleMs, now? })`: `get(id)` (touches), `set(id, value)`, `delete(id)`, `sweep()` returns evicted ids; eviction is idle-based, tested with an injected clock.
- `TelemetryEvent = { sessionId: string; seq: number; at: ISODate; sinceLastMs: number; type: 'session_start' | 'user_message' | 'assistant_message' | 'tool_start' | 'tool_complete' | 'tool_error' | 'artifact' | 'context_change' | 'compaction' | 'turn_end' | 'error'; data: Record<string, unknown> }`; `TelemetrySink = (e) => void | Promise<void>`; `createTelemetryRecorder(sink, { now? })` → `record(sessionId, type, data)` assigns `seq` and `sinceLastMs` per session; sink errors are collected in `errors()`, never thrown.
- `MemoryDoc = { content: string; summary: Record<string, unknown>; version: number; updatedAt: ISODate; updatedBy: string }`; `MemoryPort<K> = { get(key: K): Promise<MemoryDoc | undefined>; set(key: K, patch: { content: string; summary?: Record<string, unknown> }, by: string): Promise<MemoryDoc> }`; `createInMemoryMemory<K>(keyOf: (k: K) => string)`.
- `memoryTool<TCtx, K>({ port, keyFromCtx: (ctx) => K | undefined, byFromCtx: (ctx) => string, maxChars = 20_000, name = 'update_memory', description })`: a `Tool` with input `{ content: string; summary?: Record<string, unknown> }`; full replace; returns `{ success: false, error }` when no key or over `maxChars`.
- `memoryContributor<TCtx, K>({ port, keyFromCtx, heading = '## Design Memory' })`: a prompts `Contributor<TCtx>` that returns `heading + '\n\n' + content` or `undefined`.

- [ ] **Step 1: Failing tests** covering: session store CRUD and list ordering by `updatedAt` desc; message store append/list/replace; registry idle eviction (`idleMs: 1000`, clock at 0, get at 900 keeps, sweep at 1901 evicts); telemetry seq/sinceLastMs per session and a rejecting sink captured; memory tool replace + version increment + `maxChars` rejection + missing-key rejection; contributor returns undefined for a missing doc and the heading plus content otherwise.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(agent): add session/message stores, idle registry, telemetry recorder, and bounded config memory`.

---

### Task 4: Compaction

**Files:** `src/compaction.ts`; test `src/__tests__/compaction.test.ts`.

**Interfaces:**
- `COMPACTION_PROMPT = definePrompt<{ conversation: string }>({ name: 'agent.compact-history', version: '1.0.0', sections: [text('instructions', <the the reference product summarization text verbatim>), fromContext('conversation', c => 'Here is the conversation history to summarize:\n\n' + c.conversation)] })`.
- `CompactionOptions = { client: ModelClient; budgetTokens?: number (80_000); thresholdRatio?: number (0.7); keepRecentPairs?: number (6); estimateTokens?: (text: string) => number (ceil(len/4)); role?: ModelRole ('fast'); maxTokens?: number (2048) }`.
- `estimateHistoryTokens(history, estimate)`; `compactHistory(history: AgentMessage[], opts): Promise<{ history: AgentMessage[]; compacted: boolean; summary?: AgentMessage }>`. Rules: only when estimated tokens > budget × ratio and more than `keepRecentPairs × 2` eligible messages; older messages (prior `summary` rendered as `[Previous Summary]: …`, others as `User: …` / `Assistant: …`, `\n\n`-joined) go to `client.generate` with the composed prompt; the result becomes one `summary` message at the head; recent messages kept verbatim; an empty summary leaves history unchanged with `compacted: false`.
- `pruneToBudget(history, budgetTokens, estimate)`: pair-wise drop from the front until under budget (the secondary guard).

- [ ] **Step 1: Failing test** with `createFakeModelClient([{ text: 'SUMMARY' }])`: 20 alternating messages of 4,000 chars each (~20k tokens) with `budgetTokens: 10_000` compact to `[summary, ...last 12]`; the fake's call has the prior-summary and `User:`/`Assistant:` framing in the user message; below threshold → unchanged and no client call; empty summary → unchanged; `pruneToBudget` drops pairs.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(agent): add token-budget history compaction with persisted summaries`.

---

### Task 5: The session loop

**Files:** `src/session.ts`; test `src/__tests__/session.test.ts`.

**Interfaces:**
- `AgentSessionOptions<TCtx> = { sessionId: string; client: ModelClient; prompt: Prompt<TCtx>; contributors?: Record<string, Contributor<TCtx>>; tools?: Tool<TCtx, never>[]; ctx: TCtx; model?: ModelRole; maxRounds?: number (10); maxRoundsMessage?: string; history?: AgentMessage[]; messages?: MessageStore; sessions?: SessionStore; telemetry?: TelemetrySink; compaction?: Omit<CompactionOptions, 'client'> | false; now?: () => ISODate }`.
- `AgentSession<TCtx> = { readonly sessionId; run(input: string | ContentBlock[], opts?: { annotations?: string[]; label?: string }): AsyncIterable<AgentEvent>; history(): AgentMessage[]; getContext(): TCtx; setContext(patch: Partial<TCtx>): void; tools: ToolRegistry<TCtx> }`.
- `AgentEvent` (from `events.ts`): `{ type: 'text_delta'; text }`, `{ type: 'tool_call'; toolUseId; name; input }`, `{ type: 'tool_result'; toolUseId; name; result: ToolResult; durationMs; isError: boolean }`, `{ type: 'artifact'; toolUseId; artifact: ArtifactDescriptor }`, `{ type: 'turn_end'; message: AgentMessage; usage: Usage; rounds: number; stopReason: 'end_turn' | 'max_rounds' | 'refusal' | 'max_tokens' }`, `{ type: 'error'; error: { code: string; message: string } }`.
- Loop per `run`: (1) optional compaction (persist via `messages.replace`); (2) append the user `AgentMessage` (store + telemetry); (3) for round in 1..maxRounds: compose prompt with `ctx` and contributors → `toSystemBlocks`; `client.stream({ system, messages: toModelMessages(history), tools: registry.definitions(), model })`; forward `text_delta`; on `message_end`: accumulate usage; if no tool uses → build assistant message (`content` = text, `usage`, `toolCalls` from all rounds, `artifacts` from all rounds), persist, emit `turn_end` with `stopReason` mapped (`refusal` → 'refusal', `max_tokens` → 'max_tokens', else 'end_turn'), return; else append assistant message with `blocks` (text + tool_use) and per-tool: emit `tool_call`, execute all tools concurrently with `{ ctx, toolUseId, sessionId }`, each wrapped so a throw becomes `{ success: false, error }` with `isError: true`; emit `tool_result` and `artifact` events; append user message with `tool_result` blocks (`isError` on failures) and `toolCalls`; telemetry for each; (4) if rounds exhausted: assistant message with `maxRoundsMessage` and `stopReason: 'max_rounds'`. A `ModelEvent` of type `error` → emit `error` and stop. Unknown tool name → `tool_result` with `isError` and content `Error: Tool <name> not found`.
- Input validation: tool input is parsed with the tool's Zod schema before `execute`; failure → `isError` result `Error: invalid input: <issues>`.

- [ ] **Step 1: Failing tests** with `createFakeModelClient` scripts: (a) plain text turn → events `[text_delta…, turn_end]`, history has user + assistant with usage, `turn_end.rounds === 1`; (b) tool round: turn 1 returns `toolUses: [{ id: 'tu1', name: 'lookup', input: { q: 'x' } }]`, turn 2 returns text → events include `tool_call`, `tool_result` (`isError: false`, `durationMs >= 0`), `artifact` (the tool returns one), then `turn_end` with `rounds: 2` and usage summed across both turns; the fake's second call has assistant `blocks` (text + tool_use) then user `tool_result` blocks; the final assistant message carries `toolCalls` and `artifacts`; (c) tool throws → `tool_result.isError` and the tool_result block has `isError: true` and content starting `Error:`; (d) unknown tool and invalid input → error results without throwing; (e) `maxRounds: 1` with a tool-using script → `turn_end.stopReason === 'max_rounds'` and the message text is `maxRoundsMessage`; (f) annotations are sent to the model but the stored user message keeps `content` and `annotations` separate; (g) `history` restore: constructing with `history` and running a turn sends the prior messages; (h) memory contributor + `memoryTool` round trip: after the tool runs, the next `run` composes a system block containing the new content; (i) telemetry sink receives `user_message`, `tool_start`, `tool_complete`, `assistant_message`, `turn_end` in order; (j) model `error` event → `error` event emitted, no assistant message persisted.
- [ ] **Step 2: Implement. Step 3: Verify (coverage ≥ 90%), commit** `feat(agent): add the agentic session loop with tool execution, artifacts, usage, and telemetry`.

---

### Task 6: SSE encoding

**Files:** `src/sse.ts`; test `src/__tests__/sse.test.ts`.

**Interfaces:**
- `encodeAgentEvent(e: AgentEvent): string` → `data: ${JSON.stringify(e)}\n\n`.
- `agentEventsToReadableStream(events: AsyncIterable<AgentEvent>): ReadableStream<Uint8Array>` (web standard; Next.js `return new Response(stream, { headers: SSE_HEADERS })`).
- `SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }`.
- `pipeAgentEventsToNode(events, res: { writeHead(status, headers): unknown; write(chunk: string): unknown; end(): unknown })`: Fastify `reply.raw` compatible; writes headers, each frame, ends. If the iterable throws, writes an `error` frame then ends.

- [ ] **Step 1: Failing test**: encode shape; ReadableStream round-trips three events (read with a `TextDecoder`, split on `\n\n`); Node pipe writes headers, three frames, and `end`; a throwing iterable produces a trailing `error` frame.
- [ ] **Step 2: Implement.** Also write `packages/agent/README.md` (surface table: tools, session, events, SSE, ports, memory, compaction). **Step 3: Verify, commit** `feat(agent): add SSE encoding for web and Node responses, README`.

---

### Task 7: `@apogee/agent-react` — decoder, reducer, hook, shells

**Files:** Create `packages/agent-react/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts}`, `src/sse-decoder.ts`, `src/reducer.ts`, `src/use-agent-session.ts`, `src/components.tsx`, `src/index.ts`, `src/__tests__/setup.ts` (imports `@testing-library/jest-dom/vitest`). Tests: `sse-decoder.test.ts`, `reducer.test.ts`, `use-agent-session.test.tsx`, `components.test.tsx`.

**Toolchain:** `package.json` peers `react: ^18 || ^19`, `react-dom: ^18 || ^19`; deps `@apogee/agent: workspace:*`; dev adds `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. `tsconfig.json` adds `"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM", "DOM.Iterable"]`. `vitest.config.ts` sets `environment: 'jsdom'`, `setupFiles`. tsup `external: ['react', 'react-dom']`.

**Interfaces:**
- `decodeSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<AgentEvent>`: buffers text, splits on `\n\n`, parses lines starting with `data:`; ignores blank and comment lines; a malformed JSON frame yields `{ type: 'error', error: { code: 'BAD_FRAME', message } }` and continues.
- `AgentUiMessage = AgentMessage & { streaming?: boolean }`; `ActiveTool = { toolUseId: string; name: string; input: unknown; startedAt: number }`; `AgentUiState = { messages: AgentUiMessage[]; streamingText: string; activeTools: ActiveTool[]; isStreaming: boolean; lastUsage?: Usage; totalUsage: RawUsage & { costUsd: number }; error?: { code: string; message: string } }`; `initialAgentUiState(messages?)`; `reduceAgentState(state, action: { type: 'send'; message: AgentMessage } | { type: 'event'; event: AgentEvent } | { type: 'reset'; messages?: AgentMessage[] }): AgentUiState` (pure): `send` appends the user message and sets `isStreaming`; `text_delta` appends; `tool_call` adds an active tool; `tool_result` removes it; `artifact` is a no-op (artifacts arrive on the final message); `turn_end` appends `message`, clears streaming, sets `lastUsage`, adds to `totalUsage`; `error` sets `error`, clears streaming.
- `useAgentSession({ transport: (input: SendInput) => Promise<AsyncIterable<AgentEvent>>; initialMessages?; onEvent?: (e: AgentEvent) => void })` where `SendInput = { text: string; annotations?: string[]; artifactAction?: { artifactId: string; actionType: string; data?: Record<string, unknown> } }` → `{ state, sendMessage(text, opts?), reset(messages?), displayMessages }` (`displayMessages` = messages plus a synthetic `{ id: 'streaming', role: 'assistant', content: streamingText, streaming: true }` while streaming). `fetchSseTransport(url, { headers?, fetch? })` builds a transport that POSTs JSON `{ message, annotations, artifactAction }` and decodes the body.
- Components (all accept `className` and pass through `data-testid`): `MessageList({ messages, renderMessage?, renderArtifact?: (a: ArtifactDescriptor, m: AgentUiMessage) => ReactNode })` (default renders role + content and calls `renderArtifact` for each `message.artifacts`); `Composer({ onSend, disabled?, placeholder? })` (textarea, Enter sends, Shift+Enter newline); `ToolActivity({ tools })`; `ContextMeter({ usage, budgetTokens })` (percent of budget used by last input tokens).

- [ ] **Step 1: Failing tests**: decoder over a `ReadableStream` built from two chunks that split a frame mid-JSON; reducer table-driven over the event sequence from Task 5(b); hook with `renderHook` and a transport returning a scripted async iterable → `displayMessages` shows the streaming pseudo-message then the final assistant message with artifacts; `Composer` Enter vs Shift+Enter; `MessageList` calls `renderArtifact` per artifact.
- [ ] **Step 2: Implement. Step 3: Verify, README, commit** `feat(agent-react): add SSE decoder, pure reducer, useAgentSession, and unstyled shells`.

---

### Task 8: `@apogee/artifacts` — registry, renderer, container, actions, events

**Files:** Create `packages/artifacts/*` (same toolchain as agent-react), `src/types.ts`, `src/registry.ts`, `src/ArtifactContainer.tsx`, `src/ArtifactRenderer.tsx`, `src/use-artifact-actions.ts`, `src/use-artifact-events.ts`, `src/index.ts`; tests for each.

**Interfaces:**
- `ArtifactAction = { artifactId: string; actionType: string; data?: Record<string, unknown> }`; `formatArtifactAnnotation(a)` → `[Artifact Action: ${actionType} on ${artifactId}]` plus `\nData: ${JSON.stringify(data)}` when present (this is what the host passes as an `annotation` to `session.run`).
- `ArtifactComponentProps<TData = unknown> = { artifact: ArtifactDescriptor & { data: TData }; onAction: (actionType: string, data?: Record<string, unknown>, message?: string) => void; children?: ReactNode }`.
- `createArtifactRegistry()` → `{ register<TData>(type, component: ComponentType<ArtifactComponentProps<TData>>): void; get(type); has(type); types() }`; `ArtifactRegistryProvider({ registry, children })`; `useArtifactRegistry()`.
- `ArtifactRenderer({ artifact, onAction, fallback? })`: looks up the registry from context; unknown type renders `fallback` or a default "Unknown artifact type" container with `data-testid="artifact-unknown"`.
- `ArtifactContainer({ artifactType, artifactId, title?, variant?: 'default' | 'compact' | 'inline', isLoading?, error?, onShown?, children })`: root has `data-artifact-id` and `data-artifact-type`; `onShown` fires once on mount.
- `useArtifactActions({ sendMessage: (text: string, opts: { artifactAction: ArtifactAction; annotations: string[] }) => void; defaultMessage?: (a: ArtifactAction) => string })` → `dispatch(artifactId, actionType, data?, message?)`: builds the action, computes the annotation with `formatArtifactAnnotation`, and calls `sendMessage(message ?? defaultMessage(action), { artifactAction, annotations: [annotation] })`.
- `useArtifactEvents({ artifactType, artifactId, sink: (events: ArtifactEvent[]) => void | Promise<void>; debounceMs = 300; batchIntervalMs = 1000; now?, setTimeout?, clearTimeout? })` → `{ recordShown(); recordFieldChange(field, prev, next); recordSubmit(formData); recordAction(name); flush(); cleanup() }`. `ArtifactEvent = { eventType: 'artifact_shown' | 'artifact_field_change' | 'artifact_submit' | 'artifact_action'; artifactType; artifactId; data?; at: ISODate }`. Field changes debounce per field; `recordSubmit` **flushes** pending field changes first (the survey found the reference product drops them), then sends immediately; `cleanup` flushes.

- [ ] **Step 1: Failing tests**: registry register/get/types; renderer renders the registered component with `artifact` and forwards `onAction`, and renders the fallback for unknown types; container attributes and `onShown` once; actions `dispatch` produces the annotation text and default message; events with fake timers: two rapid field changes on one field collapse to one, batch flush after 1000ms, `recordSubmit` flushes pending changes before the submit event, `cleanup` flushes.
- [ ] **Step 2: Implement. Step 3: Verify, README, commit** `feat(artifacts): add artifact registry, renderer, container, action dispatch, and batched interaction events`.

---

### Task 9: Cross-package example, full verification, PR

**Files:** `packages/agent/src/__tests__/acceptance/end-to-end.test.ts`; READMEs; PR.

- [ ] **Step 1: Acceptance test**: build a session with two tools on a tiny neutral domain (a `notes` list in `ctx`: `add_note` returns an artifact `{ type: 'note-card', id, data }`, `list_notes` returns data), the memory tool, the memory contributor, an in-memory message store, and a telemetry sink; run three turns with a scripted fake client (one with a tool round, one that updates memory, one plain); pipe the third run through `agentEventsToReadableStream` and decode it with `@apogee/agent-react`'s `decodeSseStream` (imported from its `src` via a relative path is not allowed across packages; instead add `@apogee/agent-react` as a devDependency of `agent` and import it), and reduce with `reduceAgentState`; assert the UI state's final message equals the persisted one and the memory content appears in the third system prompt.
- [ ] **Step 2: Full pipeline** `pnpm typecheck && pnpm lint && pnpm build && pnpm test` sequentially; coverage ≥ 90% per package.
- [ ] **Step 3: Push, PR** with the plan as body; after merge tag `agent-v0.1.0`, `agent-react-v0.1.0`, `artifacts-v0.1.0`, `ai-v0.2.0`; file the plan.

---

## Self-review

- **§3.3 coverage:** `AgentSession<TContext>` (T5), `Tool<TContext>` with Zod (T2), events (T2/T5), bounded rounds + per-round usage + hooks via telemetry (T5), compaction (T4), config memory + built-in tool (T3), SSE (T6), ports with in-memory impls (T3). Admin assistant as a composition: demonstrated by T9's memory + tools acceptance test; the config-tool families arrive with kernel Phase 2.
- **§3.4 coverage:** `useAgentSession`, decoder, shells (T7). **§3.5:** descriptor (T2), registry/renderer/container/actions/events (T8).
- **Deferred:** the apogee.build chat demo (plan B6a); a Mongoose adapter for the stores (`@apogee/agent-mongoose`, later).
- **Type consistency:** `ArtifactDescriptor` is defined once in `@apogee/agent/tool.ts` and imported by both React packages; `AgentEvent` is defined once in `events.ts` and consumed by `sse.ts`, the decoder, and the reducer; `ToolResult`'s `artifact`/`artifacts` feed `artifactsOf` (T2) used by the loop (T5).
