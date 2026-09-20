# Plan B1 — `@de_canter/apogee-ai` + `@de_canter/apogee-prompts` Implementation Plan

> **Outcome (2026-09-18):** Completed. Merged via de-canter/apogee#7, tagged `ai-v0.1.0` and `prompts-v0.1.0`. ai: 28 tests / 98% lines; prompts: 10 tests / 99%. Deviations: structured output validates response text with the caller's Zod schema instead of the SDK zod helper; refusal fallbacks not enabled (RefusalError surfaces to the agent layer); Tasks 4 and 5 landed as one commit. The live smoke script was not run (no credentials in session).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-18
**Origin:** `docs/design/ai-abstractions.md` §3.1 and §3.2, approved 2026-09-18. First plan of Track B.

**Goal:** Ship `@de_canter/apogee-ai` (the single model client every other package and product uses) and `@de_canter/apogee-prompts` (the prompt registry and composer), both at v0.1.0, tested without network.

**Architecture:** `@de_canter/apogee-ai` wraps `@anthropic-ai/sdk` behind a small provider-neutral surface: content blocks (text, image, document), `generate`, `generateObject` (structured output via `output_config.format`, validated with Zod), and `stream` (a normalized `ModelEvent` iterable). Models are requested by *role* and resolved by a host-supplied resolver; a catalog prices usage including cache tokens; a usage ledger records every call. The SDK client is injected so tests run against a fake. `@de_canter/apogee-prompts` composes named, versioned prompts from sections, orders stable sections before volatile ones so the cache prefix is maximal, and exposes contributor slots that later packages (rules, knowledge, memory) fill.

**Tech Stack:** TypeScript 5.x strict, Zod 4, `@anthropic-ai/sdk` ^0.126, Vitest 4, tsup. Same workspace as `@de_canter/apogee-kernel`.

**Spec:** `docs/design/ai-abstractions.md` (read §2 rules and §3.1–3.2 before any task). API facts used here come from the Claude API skill on 2026-09-18: structured outputs are `output_config: { format: { type: 'json_schema', schema } }` and `client.messages.parse`; adaptive thinking is `thinking: { type: 'adaptive' }` and effort is `output_config.effort`; prompt caching is `cache_control: { type: 'ephemeral' }` on system blocks and tool definitions with usage reported as `cache_creation_input_tokens` / `cache_read_input_tokens`; streaming client tools set `eager_input_streaming: true` and the client must validate parsed input; forced `tool_choice` is rejected on Fable 5.1, so structured output never uses tool forcing; assistant prefill is rejected on all current models.

## Global Constraints

- Packages: `@de_canter/apogee-ai` at `packages/ai`, `@de_canter/apogee-prompts` at `packages/prompts`. Both `"type": "module"`, tsup ESM+CJS, `prepare: tsup`, same `tsconfig.json`/`tsup.config.ts`/`vitest.config.ts` shape as `packages/kernel`.
- Zero network in tests. The SDK client is injected through a structural `AnthropicLike` interface; tests pass hand-built fakes.
- No package or host may construct `new Anthropic()` except `createAnthropicModelClient` in `packages/ai/src/anthropic-client.ts`.
- Model IDs are never hardcoded outside `packages/ai/src/catalog.ts`. Everything else asks for a role.
- Default role map: `default → claude-opus-5`, `fast → claude-haiku-4-5`, `vision → claude-opus-5`. Hosts override via `resolveModel`.
- `max_tokens` defaults: 16000 non-streaming, 64000 streaming, 4096 for `generateObject`.
- Usage `costUsd` is a JS number in USD (not kernel Money) because it is telemetry, not a ledger amount; hosts convert if they book it.
- Strict TS, no `any`, no lint disables, 90% line coverage, JSON-safe shapes, ISO date strings (kernel `ISODate`).
- Branch `feature/ai-core`, commit per task, PR to `main`.

## File Structure

```
packages/ai/
├── package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  README.md
└── src/
    ├── index.ts
    ├── catalog.ts          # ModelCatalog: ids, prices, limits, costOf()
    ├── models.ts           # ModelRole, ModelResolver, staticResolver
    ├── types.ts            # ContentBlock, Message, SystemBlock, ToolDefinition, requests, results, Usage, ModelEvent
    ├── errors.ts           # AiError taxonomy + mapSdkError
    ├── usage.ts            # UsageLedger + UsageSink port
    ├── params.ts           # buildMessageParams(): our request -> SDK params (caching, thinking, effort, tools)
    ├── stream.ts           # normalizeStream(): SDK stream events -> ModelEvent
    ├── anthropic-client.ts # createAnthropicModelClient({ sdk, ... }): generate / generateObject / stream
    ├── fake-client.ts      # FakeModelClient: scripted responses for downstream tests
    └── __tests__/
        ├── catalog.test.ts  models.test.ts  usage.test.ts  params.test.ts
        ├── stream.test.ts  anthropic-client.test.ts  fake-client.test.ts  errors.test.ts
packages/prompts/
├── package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  README.md
└── src/
    ├── index.ts
    ├── prompt.ts       # definePrompt, sections (text / fromContext / slot), composePrompt
    ├── registry.ts     # PromptRegistry, overrideSection
    ├── eval.ts         # evalPrompt scaffold
    └── __tests__/ prompt.test.ts  registry.test.ts  eval.test.ts
```

---

### Task 1: `@de_canter/apogee-ai` package skeleton, model catalog, and roles

**Files:**
- Create: `packages/ai/package.json`, `packages/ai/tsconfig.json`, `packages/ai/tsup.config.ts`, `packages/ai/vitest.config.ts`
- Create: `packages/ai/src/catalog.ts`, `packages/ai/src/models.ts`, `packages/ai/src/index.ts`
- Test: `packages/ai/src/__tests__/catalog.test.ts`, `packages/ai/src/__tests__/models.test.ts`

**Interfaces:**
- Produces: `ModelId` (string), `ModelSpec = { id; family; contextWindow; maxOutput; pricePerMTok: { input; output; cacheRead; cacheWrite } }`, `ModelCatalog = { get(id): ModelSpec; has(id): boolean; list(): ModelSpec[]; costOf(id, usage: RawUsage): number }`, `RawUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }`, `createCatalog(overrides?: ModelSpec[]): ModelCatalog`, `DEFAULT_MODELS`, `UnknownModelError`.
- Produces: `ModelRole = 'default' | 'fast' | 'vision' | (string & {})`, `ModelResolver = (role: ModelRole) => ModelId`, `staticResolver(map: Record<string, ModelId>, fallback?: ModelId): ModelResolver`, `DEFAULT_ROLE_MAP`.

- [ ] **Step 1: Package files** (copy the kernel's `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` verbatim; `package.json`):

```json
{
  "name": "@de_canter/apogee-ai",
  "version": "0.1.0",
  "description": "Apogee model client: one client for every AI call, with vision, structured output, prompt caching, model roles, and usage accounting",
  "license": "UNLICENSED",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" } },
  "files": ["dist", "README.md"],
  "sideEffects": false,
  "scripts": { "prepare": "tsup", "build": "tsup", "dev": "tsup --watch", "clean": "rm -rf dist", "test": "vitest run", "test:watch": "vitest", "typecheck": "tsc --noEmit", "lint": "eslint src" },
  "dependencies": { "@anthropic-ai/sdk": "^0.126.0", "@de_canter/apogee-kernel": "workspace:*", "zod": "^4.0.0" },
  "devDependencies": { "@vitest/coverage-v8": "^4.0.0", "tsup": "^8.0.0", "typescript": "^5.6.0", "vitest": "^4.0.0" }
}
```

Run `pnpm install` at the repo root.

- [ ] **Step 2: Failing tests**

`packages/ai/src/__tests__/catalog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { UnknownModelError, createCatalog } from '../catalog';

describe('ModelCatalog', () => {
  const catalog = createCatalog();
  it('knows the current models with prices and limits', () => {
    const opus = catalog.get('claude-opus-5');
    expect(opus.pricePerMTok.input).toBe(5);
    expect(opus.pricePerMTok.output).toBe(25);
    expect(opus.contextWindow).toBe(1_000_000);
    expect(catalog.has('claude-haiku-4-5')).toBe(true);
    expect(() => catalog.get('gpt-4')).toThrow(UnknownModelError);
  });
  it('prices usage including cache reads and writes', () => {
    // 1M input at $5 + 1M output at $25 + 1M cache read at $0.50 + 1M cache write at $6.25
    const cost = catalog.costOf('claude-opus-5', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 });
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
    expect(catalog.costOf('claude-haiku-4-5', { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(0.001, 9);
  });
  it('accepts overrides and additions', () => {
    const c = createCatalog([{ id: 'claude-opus-5', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } }, { id: 'custom-model', family: 'custom', contextWindow: 8000, maxOutput: 1000, pricePerMTok: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]);
    expect(c.get('claude-opus-5').pricePerMTok.input).toBe(1);
    expect(c.has('custom-model')).toBe(true);
    expect(c.list().length).toBeGreaterThan(5);
  });
});
```

`packages/ai/src/__tests__/models.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_MAP, staticResolver } from '../models';

describe('model roles', () => {
  it('default map resolves the three built-in roles', () => {
    const r = staticResolver(DEFAULT_ROLE_MAP);
    expect(r('default')).toBe('claude-opus-5');
    expect(r('fast')).toBe('claude-haiku-4-5');
    expect(r('vision')).toBe('claude-opus-5');
  });
  it('unknown roles fall back to the default role, or to an explicit fallback', () => {
    expect(staticResolver(DEFAULT_ROLE_MAP)('extraction')).toBe('claude-opus-5');
    expect(staticResolver({ default: 'claude-sonnet-5' }, 'claude-haiku-4-5')('anything')).toBe('claude-haiku-4-5');
  });
  it('host overrides win', () => {
    expect(staticResolver({ ...DEFAULT_ROLE_MAP, default: 'claude-sonnet-5' })('default')).toBe('claude-sonnet-5');
  });
});
```

Run: `pnpm --filter @de_canter/apogee-ai test` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`packages/ai/src/catalog.ts`:
```ts
export type ModelId = string;

export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ModelSpec {
  id: ModelId;
  family: string;
  contextWindow: number;
  maxOutput: number;
  /** USD per million tokens. */
  pricePerMTok: ModelPrice;
}
export interface RawUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export class UnknownModelError extends Error {
  constructor(id: string) { super(`Unknown model: ${id}`); this.name = 'UnknownModelError'; }
}

const price = (input: number, output: number, cacheRead = input * 0.1, cacheWrite = input * 1.25): ModelPrice =>
  ({ input, output, cacheRead, cacheWrite });

/** Current Claude models as of 2026-09-18. Cache read is 10% of input and cache write 125% unless stated. */
export const DEFAULT_MODELS: readonly ModelSpec[] = [
  { id: 'claude-fable-5-1', family: 'fable', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(10, 50, 0.25) },
  { id: 'claude-fable-5', family: 'fable', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(10, 50) },
  { id: 'claude-opus-5', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-opus-4-8', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-opus-4-7', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-opus-4-6', family: 'opus', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(5, 25) },
  { id: 'claude-sonnet-5', family: 'sonnet', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(2, 10) },
  { id: 'claude-sonnet-4-6', family: 'sonnet', contextWindow: 1_000_000, maxOutput: 128_000, pricePerMTok: price(3, 15) },
  { id: 'claude-haiku-4-5', family: 'haiku', contextWindow: 200_000, maxOutput: 64_000, pricePerMTok: price(1, 5) },
];

export interface ModelCatalog {
  get(id: ModelId): ModelSpec;
  has(id: ModelId): boolean;
  list(): ModelSpec[];
  costOf(id: ModelId, usage: RawUsage): number;
}

export function createCatalog(overrides: readonly ModelSpec[] = []): ModelCatalog {
  const specs = new Map<ModelId, ModelSpec>();
  for (const s of DEFAULT_MODELS) specs.set(s.id, s);
  for (const s of overrides) specs.set(s.id, s);
  const get = (id: ModelId): ModelSpec => {
    const s = specs.get(id);
    if (!s) throw new UnknownModelError(id);
    return s;
  };
  return {
    get,
    has: (id) => specs.has(id),
    list: () => [...specs.values()],
    costOf: (id, u) => {
      const p = get(id).pricePerMTok;
      return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
    },
  };
}
```

`packages/ai/src/models.ts`:
```ts
import type { ModelId } from './catalog';

/** Packages ask for a role; the host decides which model that means. */
export type ModelRole = 'default' | 'fast' | 'vision' | (string & {});
export type ModelResolver = (role: ModelRole) => ModelId;

export const DEFAULT_ROLE_MAP: Readonly<Record<string, ModelId>> = {
  default: 'claude-opus-5',
  fast: 'claude-haiku-4-5',
  vision: 'claude-opus-5',
};

export function staticResolver(map: Readonly<Record<string, ModelId>>, fallback?: ModelId): ModelResolver {
  const fb = fallback ?? map['default'] ?? DEFAULT_ROLE_MAP['default']!;
  return (role) => map[role] ?? fb;
}
```

`packages/ai/src/index.ts`: `export * from './catalog'; export * from './models';`

- [ ] **Step 4: Verify** `pnpm --filter @de_canter/apogee-ai test && pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5: Commit** `feat(ai): bootstrap @de_canter/apogee-ai with model catalog and roles`

---

### Task 2: Types, error taxonomy, request builder with caching

**Files:**
- Create: `packages/ai/src/types.ts`, `packages/ai/src/errors.ts`, `packages/ai/src/params.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/src/__tests__/params.test.ts`, `packages/ai/src/__tests__/errors.test.ts`

**Interfaces:**
- Produces (`types.ts`): `TextBlock = { type: 'text'; text: string }`, `ImageBlock = { type: 'image'; source: { type: 'base64'; mediaType: 'image/png'|'image/jpeg'|'image/gif'|'image/webp'; data: string } | { type: 'url'; url: string } }`, `DocumentBlock = { type: 'document'; source: { type: 'base64'; mediaType: 'application/pdf'; data: string } | { type: 'text'; mediaType: 'text/plain'; data: string }; title?: string }`, `ContentBlock = TextBlock | ImageBlock | DocumentBlock`, `Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] }`, `SystemBlock = { text: string; cache?: boolean }`, `ToolDefinition = { name: string; description: string; inputSchema: Record<string, unknown>; strict?: boolean }`, `Effort = 'low'|'medium'|'high'|'xhigh'|'max'`, `GenerateRequest = { model?: ModelRole; system?: string | SystemBlock[]; messages: Message[]; tools?: ToolDefinition[]; maxTokens?: number; effort?: Effort; thinking?: boolean; stopSequences?: string[]; cache?: boolean; metadata?: Record<string, string> }`, `StopReason = 'end_turn'|'max_tokens'|'stop_sequence'|'tool_use'|'pause_turn'|'refusal'`, `ToolUse = { id: string; name: string; input: unknown }`, `Usage = RawUsage & { model: ModelId; costUsd: number }`, `GenerateResult = { text: string; toolUses: ToolUse[]; stopReason: StopReason; usage: Usage; raw: unknown }`, `ModelEvent = { type: 'text_delta'; text: string } | { type: 'tool_use_start'; id: string; name: string } | { type: 'tool_use_delta'; id: string; partialJson: string } | { type: 'tool_use_end'; id: string; name: string; input: unknown; parseError?: string } | { type: 'message_end'; stopReason: StopReason; usage: Usage; text: string; toolUses: ToolUse[] } | { type: 'error'; error: AiError }`.
- Produces (`errors.ts`): `AiError` (code, retryable), `RateLimitedError`, `OverloadedError`, `ContextTooLongError`, `InvalidRequestError`, `AuthenticationError`, `RefusalError { category?, explanation? }`, `StructuredOutputError { rawText, issues }`, `mapSdkError(e: unknown): AiError`.
- Produces (`params.ts`): `buildMessageParams(req: GenerateRequest, opts: { model: ModelId; streaming: boolean }): Anthropic.MessageCreateParams` (the SDK type), placing `cache_control` on the last system block and last tool when `cache !== false`, mapping `effort` to `output_config.effort`, `thinking !== false` to `thinking: { type: 'adaptive' }`, tools to SDK tools with `eager_input_streaming: true` when streaming.

- [ ] **Step 1: Failing tests**

`packages/ai/src/__tests__/params.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildMessageParams } from '../params';

describe('buildMessageParams', () => {
  it('maps a minimal request with defaults', () => {
    const p = buildMessageParams({ messages: [{ role: 'user', content: 'hi' }] }, { model: 'claude-opus-5', streaming: false });
    expect(p.model).toBe('claude-opus-5');
    expect(p.max_tokens).toBe(16000);
    expect(p.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(p.thinking).toEqual({ type: 'adaptive' });
    expect(p.system).toBeUndefined();
  });
  it('puts cache_control on the last system block and last tool, and eager streaming on tools when streaming', () => {
    const p = buildMessageParams({
      system: [{ text: 'stable' }, { text: 'also stable' }],
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object', properties: {} } }, { name: 'b', description: 'B', inputSchema: { type: 'object', properties: {} }, strict: true }],
    }, { model: 'claude-opus-5', streaming: true });
    const system = p.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[0]!.cache_control).toBeUndefined();
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    const tools = p.tools as Array<Record<string, unknown>>;
    expect(tools[0]!['cache_control']).toBeUndefined();
    expect(tools[1]!['cache_control']).toEqual({ type: 'ephemeral' });
    expect(tools[1]!['strict']).toBe(true);
    expect(tools[0]!['eager_input_streaming']).toBe(true);
    expect(p.max_tokens).toBe(64000);
  });
  it('honors an explicit cache boundary and cache:false', () => {
    const p = buildMessageParams({ system: [{ text: 'stable', cache: true }, { text: 'volatile' }], messages: [{ role: 'user', content: 'x' }] }, { model: 'claude-opus-5', streaming: false });
    const system = p.system as Array<{ cache_control?: unknown }>;
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.cache_control).toBeUndefined();
    const q = buildMessageParams({ system: 'plain', messages: [{ role: 'user', content: 'x' }], cache: false }, { model: 'claude-opus-5', streaming: false });
    expect((q.system as Array<{ cache_control?: unknown }>)[0]!.cache_control).toBeUndefined();
  });
  it('maps content blocks, effort, thinking off, stop sequences', () => {
    const p = buildMessageParams({
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } }, { type: 'document', source: { type: 'base64', mediaType: 'application/pdf', data: 'BBBB' }, title: 'Deed' }, { type: 'text', text: 'Describe' }] }],
      effort: 'low', thinking: false, stopSequences: ['END'], maxTokens: 500,
    }, { model: 'claude-haiku-4-5', streaming: false });
    const content = (p.messages[0]!.content as Array<Record<string, unknown>>);
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(content[1]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'BBBB' }, title: 'Deed' });
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p.thinking).toBeUndefined();
    expect(p.stop_sequences).toEqual(['END']);
    expect(p.max_tokens).toBe(500);
  });
});
```

`packages/ai/src/__tests__/errors.test.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AiError, ContextTooLongError, InvalidRequestError, OverloadedError, RateLimitedError, mapSdkError } from '../errors';

describe('mapSdkError', () => {
  it('maps SDK typed errors to the taxonomy with retryable flags', () => {
    const rl = mapSdkError(new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers()));
    expect(rl).toBeInstanceOf(RateLimitedError);
    expect(rl.retryable).toBe(true);
    const ov = mapSdkError(new Anthropic.InternalServerError(529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 'busy', new Headers()));
    expect(ov).toBeInstanceOf(OverloadedError);
    const bad = mapSdkError(new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 250000 tokens' } }, 'prompt is too long', new Headers()));
    expect(bad).toBeInstanceOf(ContextTooLongError);
    const inv = mapSdkError(new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'nope' } }, 'nope', new Headers()));
    expect(inv).toBeInstanceOf(InvalidRequestError);
    expect(inv.retryable).toBe(false);
  });
  it('wraps unknown errors', () => {
    const e = mapSdkError(new Error('boom'));
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe('UNKNOWN');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`packages/ai/src/types.ts` — the interfaces listed above, exactly as named, all as `export interface`/`export type`.

`packages/ai/src/errors.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';

export class AiError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = false, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class RateLimitedError extends AiError { constructor(m: string, c?: unknown) { super(m, 'RATE_LIMITED', true, { cause: c }); } }
export class OverloadedError extends AiError { constructor(m: string, c?: unknown) { super(m, 'OVERLOADED', true, { cause: c }); } }
export class ContextTooLongError extends AiError { constructor(m: string, c?: unknown) { super(m, 'CONTEXT_TOO_LONG', false, { cause: c }); } }
export class InvalidRequestError extends AiError { constructor(m: string, c?: unknown) { super(m, 'INVALID_REQUEST', false, { cause: c }); } }
export class AuthenticationError extends AiError { constructor(m: string, c?: unknown) { super(m, 'AUTHENTICATION', false, { cause: c }); } }
export class RefusalError extends AiError {
  constructor(readonly category?: string, readonly explanation?: string) { super(`Model refused${category ? ` (${category})` : ''}`, 'REFUSAL', false); }
}
export class StructuredOutputError extends AiError {
  constructor(readonly rawText: string, readonly issues: unknown) { super('Structured output did not match schema', 'STRUCTURED_OUTPUT', false); }
}

export function mapSdkError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.RateLimitError) return new RateLimitedError(e.message, e);
  if (e instanceof Anthropic.AuthenticationError) return new AuthenticationError(e.message, e);
  if (e instanceof Anthropic.BadRequestError) {
    return /too long|context|exceeds/i.test(e.message) ? new ContextTooLongError(e.message, e) : new InvalidRequestError(e.message, e);
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || /overloaded/i.test(e.message)) return new OverloadedError(e.message, e);
    if (e.status !== undefined && e.status >= 500) return new AiError(e.message, 'SERVER', true, { cause: e });
    return new AiError(e.message, 'API', false, { cause: e });
  }
  if (e instanceof Anthropic.APIConnectionError) return new AiError(e.message, 'CONNECTION', true, { cause: e });
  return new AiError(e instanceof Error ? e.message : String(e), 'UNKNOWN', false, { cause: e });
}
```
If the SDK constructor signatures used in the test differ in this SDK version, adjust the test construction (not the mapping) by reading `node_modules/@anthropic-ai/sdk/error.d.ts`.

`packages/ai/src/params.ts`:
```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { ModelId } from './catalog';
import type { ContentBlock, GenerateRequest, Message, SystemBlock } from './types';

const EPHEMERAL = { type: 'ephemeral' as const };

function toSdkBlock(b: ContentBlock): Anthropic.ContentBlockParam {
  switch (b.type) {
    case 'text': return { type: 'text', text: b.text };
    case 'image':
      return b.source.type === 'base64'
        ? { type: 'image', source: { type: 'base64', media_type: b.source.mediaType, data: b.source.data } }
        : { type: 'image', source: { type: 'url', url: b.source.url } };
    case 'document': {
      const source = b.source.type === 'base64'
        ? { type: 'base64' as const, media_type: 'application/pdf' as const, data: b.source.data }
        : { type: 'text' as const, media_type: 'text/plain' as const, data: b.source.data };
      return { type: 'document', source, ...(b.title !== undefined ? { title: b.title } : {}) };
    }
  }
}

function toSdkMessage(m: Message): Anthropic.MessageParam {
  return { role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(toSdkBlock) };
}

function toSystem(system: string | SystemBlock[] | undefined, cache: boolean): Anthropic.TextBlockParam[] | undefined {
  if (system === undefined) return undefined;
  const blocks = typeof system === 'string' ? [{ text: system }] : system;
  const explicit = blocks.some((b) => b.cache === true);
  return blocks.map((b, i) => {
    const flag = cache && (explicit ? b.cache === true : i === blocks.length - 1);
    return { type: 'text', text: b.text, ...(flag ? { cache_control: EPHEMERAL } : {}) };
  });
}

export function buildMessageParams(req: GenerateRequest, opts: { model: ModelId; streaming: boolean }): Anthropic.MessageCreateParams {
  const cache = req.cache !== false;
  const tools = req.tools?.map((t, i, arr) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    ...(t.strict ? { strict: true } : {}),
    ...(opts.streaming ? { eager_input_streaming: true } : {}),
    ...(cache && i === arr.length - 1 ? { cache_control: EPHEMERAL } : {}),
  }));
  const system = toSystem(req.system, cache);
  return {
    model: opts.model,
    max_tokens: req.maxTokens ?? (opts.streaming ? 64000 : 16000),
    messages: req.messages.map(toSdkMessage),
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(req.thinking === false ? {} : { thinking: { type: 'adaptive' } }),
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    ...(req.stopSequences ? { stop_sequences: req.stopSequences } : {}),
    ...(req.metadata ? { metadata: { user_id: req.metadata['userId'] } } : {}),
  };
}
```
Let `tsc` correct any SDK field name (`eager_input_streaming`, `output_config`, `strict`) if the installed SDK's types differ; the test asserts the wire names above. If a field is missing from the SDK's types entirely, pass it through a typed spread from a `Record<string, unknown>` and note it in the commit.

Add exports to `index.ts`: `types`, `errors`, `params`.

- [ ] **Step 3: Verify** tests, typecheck, lint → PASS.
- [ ] **Step 4: Commit** `feat(ai): add content-block types, error taxonomy, and SDK request builder with prompt caching`

---

### Task 3: Usage ledger

**Files:**
- Create: `packages/ai/src/usage.ts`; Modify: `index.ts`; Test: `packages/ai/src/__tests__/usage.test.ts`

**Interfaces:**
- Produces: `UsageRecord = Usage & { at: ISODate; operation: 'generate'|'generateObject'|'stream'; role: ModelRole; label?: string }`, `UsageSink = (record: UsageRecord) => void | Promise<void>`, `UsageLedger = { record(r: UsageRecord): void; total(): RawUsage & { costUsd: number; calls: number }; byModel(): Record<ModelId, RawUsage & { costUsd: number; calls: number }>; records(): UsageRecord[]; clear(): void }`, `createUsageLedger(sink?: UsageSink): UsageLedger`, `usageFromSdk(model: ModelId, catalog: ModelCatalog, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): Usage`.

- [ ] **Step 1: Failing test**

```ts
import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it, vi } from 'vitest';
import { createCatalog } from '../catalog';
import { createUsageLedger, usageFromSdk } from '../usage';

describe('usage', () => {
  it('converts SDK usage with nulls treated as zero and prices it', () => {
    const u = usageFromSdk('claude-opus-5', createCatalog(), { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: null, cache_creation_input_tokens: 2000 });
    expect(u).toEqual({ model: 'claude-opus-5', input: 1000, output: 100, cacheRead: 0, cacheWrite: 2000, costUsd: (1000 * 5 + 100 * 25 + 2000 * 6.25) / 1e6 });
  });
  it('ledger totals, groups by model, and forwards to the sink', () => {
    const sink = vi.fn();
    const ledger = createUsageLedger(sink);
    const base = { at: isoDate('2026-01-01'), operation: 'generate' as const, role: 'default' };
    ledger.record({ ...base, model: 'claude-opus-5', input: 10, output: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.001 });
    ledger.record({ ...base, model: 'claude-haiku-4-5', input: 20, output: 5, cacheRead: 4, cacheWrite: 0, costUsd: 0.0005 });
    expect(ledger.total()).toEqual({ input: 30, output: 10, cacheRead: 4, cacheWrite: 0, costUsd: 0.0015, calls: 2 });
    expect(ledger.byModel()['claude-haiku-4-5']?.calls).toBe(1);
    expect(sink).toHaveBeenCalledTimes(2);
    ledger.clear();
    expect(ledger.records()).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement** (straightforward; `total` sums, `byModel` groups, `record` pushes then calls `void sink(r)` catching rejections into a `console.warn`-free no-op is not allowed by §8, so: `Promise.resolve(sink(r)).catch((e) => { throw e; })` is wrong too. Correct: make `record` synchronous, call the sink, and if it returns a promise attach `.catch` that stores the error on `ledger.lastSinkError` and re-exposes it via `sinkErrors(): unknown[]`. Test that path with a rejecting sink.)

- [ ] **Step 3: Verify, commit** `feat(ai): add usage ledger with cache-aware pricing and sink port`

---

### Task 4: Anthropic client — `generate` and `generateObject`

**Files:**
- Create: `packages/ai/src/anthropic-client.ts`; Modify: `index.ts`; Test: `packages/ai/src/__tests__/anthropic-client.test.ts`

**Interfaces:**
- Produces: `ModelClient = { generate(req: GenerateRequest, opts?: CallOptions): Promise<GenerateResult>; generateObject<T>(schema: ZodType<T>, req: GenerateRequest, opts?: CallOptions): Promise<{ value: T; usage: Usage; raw: unknown }>; stream(req: GenerateRequest, opts?: CallOptions): AsyncIterable<ModelEvent>; usage: UsageLedger; resolveModel: ModelResolver; catalog: ModelCatalog }`, `CallOptions = { label?: string; signal?: AbortSignal }`.
- Produces: `AnthropicLike = { messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>; parse<T>(params: ...): Promise<Anthropic.Message & { parsed_output: T | null }>; stream(params: Anthropic.MessageCreateParams): Anthropic.MessageStream } }` (a structural subset of the SDK client so tests inject fakes).
- Produces: `createAnthropicModelClient(opts: { sdk?: AnthropicLike; apiKey?: string; resolveModel?: ModelResolver; catalog?: ModelCatalog; usageSink?: UsageSink; maxRetries?: number }): ModelClient`. When `sdk` is omitted, constructs `new Anthropic({ apiKey, maxRetries })`. This is the only `new Anthropic` in the framework.
- `generateObject` builds `output_config: { format: { type: 'json_schema', schema: z.toJSONSchema(schema) } }`, calls `messages.parse`, then `schema.safeParse(parsed_output ?? JSON.parse(text))`; failure throws `StructuredOutputError(rawText, issues)`. Uses `maxTokens ?? 4096`, `thinking` as requested, never `tool_choice`.
- `generate` maps `stop_reason === 'refusal'` to a thrown `RefusalError(stop_details?.category, stop_details?.explanation)`.
- Retry: on `retryable` errors, up to `maxRetries` (default 2) with 500ms × 2^n backoff (injectable `sleep` for tests).

- [ ] **Step 1: Failing test** — build a `fakeSdk()` whose `messages.create` returns a canned `Anthropic.Message` (`{ id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 } }`) and records the params it received. Assert: `generate` returns `text: 'hello'`, `toolUses: [{ id: 't1', name: 'lookup', input: { q: 1 } }]`, `stopReason: 'tool_use'`, usage priced, ledger has one record with `operation: 'generate'`; the params sent have `model: 'claude-opus-5'` for role `default` and `'claude-haiku-4-5'` for role `fast`. `generateObject` with `z.object({ name: z.string() })`: fake `parse` returns `parsed_output: { name: 'Jane' }` → value; fake returning `parsed_output: null` and text `'{"name":5}'` → throws `StructuredOutputError` with `rawText`. Refusal: fake `create` returns `stop_reason: 'refusal'`, `stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' }` → throws `RefusalError` with category. Retry: fake `create` rejects once with `new Anthropic.RateLimitError(...)` then resolves → succeeds and called twice, with injected `sleep` recording 500.

- [ ] **Step 2: Implement** per the interface. Structure: `resolve(req.model ?? 'default')`, `buildMessageParams`, `withRetry(() => sdk.messages.create({ ...params, stream: false }))`, map result, `usage.record`.

- [ ] **Step 3: Verify, commit** `feat(ai): add Anthropic model client with generate, structured generateObject, refusal mapping, and retry`

---

### Task 5: Streaming

**Files:**
- Create: `packages/ai/src/stream.ts`; Modify: `anthropic-client.ts`, `index.ts`; Test: `packages/ai/src/__tests__/stream.test.ts`

**Interfaces:**
- Produces: `normalizeStream(events: AsyncIterable<Anthropic.MessageStreamEvent>, ctx: { model: ModelId; catalog: ModelCatalog }): AsyncIterable<ModelEvent>`. Tracks blocks by index: `content_block_start` with `tool_use` → `tool_use_start`; `input_json_delta` → `tool_use_delta` and accumulates; `content_block_stop` on a tool block → `tool_use_end` with `JSON.parse` (empty string parses as `{}`; failure sets `parseError` and `input: undefined`); `text_delta` → `text_delta` and accumulates; `message_delta` carries `stop_reason` and output usage; `message_start` carries input/cache usage; at `message_stop` emit `message_end` with accumulated text, tool uses (only successfully parsed), stop reason, priced usage. A `refusal` stop reason still emits `message_end` (the agent layer decides), followed by no `error`.
- `ModelClient.stream(req)` = `normalizeStream(sdk.messages.stream(buildMessageParams(req, { streaming: true })), ...)` plus ledger recording at `message_end` and `mapSdkError` → `{ type: 'error' }` as the final event on failure.

- [ ] **Step 1: Failing test** — feed a scripted array of SDK events through `normalizeStream`: `message_start` (usage input 10, cache_read 2), `content_block_start` text, two `text_delta`s "Hel","lo", `content_block_stop`, `content_block_start` tool_use `{ id: 't1', name: 'lookup' }`, `input_json_delta` `{"q":` then `1}`, `content_block_stop`, `message_delta` (stop_reason tool_use, output 7), `message_stop`. Expect the event sequence `text_delta, text_delta, tool_use_start, tool_use_delta, tool_use_delta, tool_use_end{input:{q:1}}, message_end{text:'Hello', toolUses:[t1], stopReason:'tool_use', usage:{input:10,output:7,cacheRead:2,cacheWrite:0}}`. Second case: malformed partial JSON `{"q":` only → `tool_use_end.parseError` defined and `message_end.toolUses` empty.

- [ ] **Step 2: Implement**; wire into the client; add a client test that the fake `messages.stream` (returning an async iterable of the same scripted events) yields `message_end` and records usage with `operation: 'stream'`.

- [ ] **Step 3: Verify, commit** `feat(ai): add normalized streaming with eager tool-input parsing`

---

### Task 6: FakeModelClient, README, exports

**Files:**
- Create: `packages/ai/src/fake-client.ts`, `packages/ai/README.md`; Modify: `index.ts`; Test: `packages/ai/src/__tests__/fake-client.test.ts`

**Interfaces:**
- Produces: `createFakeModelClient(script: FakeTurn[] | ((req: GenerateRequest) => FakeTurn)): ModelClient & { calls: GenerateRequest[] }`, `FakeTurn = { text?: string; toolUses?: ToolUse[]; object?: unknown; stopReason?: StopReason; usage?: Partial<RawUsage>; error?: AiError }`. `generate` pops the next turn; `generateObject` validates `turn.object` against the schema (so downstream tests catch schema drift); `stream` emits the turn as `text_delta` chunks of 5 chars, tool events, then `message_end`. Records every request in `calls`. Uses the default catalog and role map.

- [ ] **Step 1: Failing test** covering all three operations, the function form of the script, running out of turns (throws `AiError('SCRIPT_EXHAUSTED')`), and `error` turns.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: README** with the surface table (generate / generateObject / stream / roles / catalog / usage / errors / fake) and the "no `new Anthropic` anywhere else" rule.
- [ ] **Step 4: Verify with coverage** `pnpm --filter @de_canter/apogee-ai exec vitest run --coverage` ≥ 90% lines; `pnpm build` produces dist.
- [ ] **Step 5: Commit** `feat(ai): add scripted FakeModelClient and README`

---

### Task 7: `@de_canter/apogee-prompts` — sections, compose, registry

**Files:**
- Create: `packages/prompts/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts}`, `packages/prompts/src/{prompt.ts,registry.ts,index.ts}`
- Test: `packages/prompts/src/__tests__/prompt.test.ts`, `registry.test.ts`

**Interfaces:**
- Produces: `Section<TCtx> = { id: string; kind: 'text'; text: string; stable: boolean } | { id: string; kind: 'context'; render: (ctx: TCtx) => string | undefined; stable: boolean } | { id: string; kind: 'slot'; slot: string; stable: boolean }`; helpers `text(id, str, { stable = true })`, `fromContext(id, render, { stable = false })`, `slot(id, slotName, { stable = false })`.
- `Prompt<TCtx> = { name: string; version: string; sections: Section<TCtx>[] }`, `definePrompt(p)`.
- `Contributor<TCtx> = (ctx: TCtx) => string | undefined | Promise<string | undefined>`.
- `composePrompt(prompt, ctx, { contributors?: Record<string, Contributor<TCtx>>, separator = '\n\n---\n\n' }): Promise<ComposedPrompt>` where `ComposedPrompt = { name; version; blocks: Array<{ id: string; text: string; cache: boolean }>; cacheBoundary: number }`. Rules: sections render in declaration order; empty renders are dropped; `cacheBoundary` = index of the first non-stable block (or `blocks.length`); every block before the boundary gets `cache: false` except the last one before the boundary which gets `cache: true` (a single breakpoint at the end of the stable prefix); blocks after get `cache: false`. A missing contributor for a slot drops the section. `toSystemBlocks(composed)` returns `{ text, cache }[]` compatible with `@de_canter/apogee-ai`'s `SystemBlock` without importing it.
- Registry: `createPromptRegistry()` with `register(prompt)`, `get(name, version?)` (latest by semver-ish string compare when omitted), `list()`, `overrideSection(prompt, id, text)` returning a new prompt.

- [ ] **Step 1: Failing tests**

`prompt.test.ts`: a prompt with `text('identity', 'You are X')`, `text('rules', 'Rules...')`, `fromContext('tenant', (c: { tenant?: string }) => c.tenant && \`Tenant: ${c.tenant}\`)`, `slot('rules', 'behavior-rules')`, `fromContext('now', (c) => \`Now ${c.now}\`)`. Assert: with `{ tenant: 'Acme', now: 't' }` and a contributor returning 'R1', blocks are `[identity(cache:false), rules(cache:true), tenant, rules-slot, now]`, `cacheBoundary === 2`, joined text uses the separator; with no tenant and no contributor, the two are dropped and the boundary is still 2; when a `fromContext` is marked `stable: true`, it moves inside the boundary; `toSystemBlocks` maps `cache`.

`registry.test.ts`: register `a@1.0.0`, `a@1.2.0`, get latest → 1.2.0; get explicit; unknown throws; `overrideSection` replaces text by id and leaves the original untouched.

- [ ] **Step 2: Implement.** `packages/prompts` depends only on `zod` (for a `PromptSchema` to validate stored overrides) and nothing from `@de_canter/apogee-ai`.
- [ ] **Step 3: Verify, commit** `feat(prompts): add prompt sections, cache-aware compose, and registry`

---

### Task 8: Eval scaffold, READMEs, PR

**Files:**
- Create: `packages/prompts/src/eval.ts`, `packages/prompts/README.md`; Modify: `packages/prompts/src/index.ts`, `packages/prompts/package.json` (add `@de_canter/apogee-ai` as a **peer** dependency, used only by `eval.ts` types); Test: `packages/prompts/src/__tests__/eval.test.ts`

**Interfaces:**
- Produces: `EvalCase<TCtx> = { id: string; ctx: TCtx; input: string; expect?: string }`, `Judge = (c: EvalCase<unknown>, output: string) => { score: number; notes?: string } | Promise<...>`, `includesJudge` (score 1 if `expect` is a substring, else 0), `evalPrompt(prompt, cases, { client: ModelClient; judge?: Judge; role?: ModelRole; contributors? })` → `{ prompt: { name, version }; cases: Array<{ id; output; score; notes?; usage }>; meanScore; totalCostUsd }`.

- [ ] **Step 1: Failing test** using `createFakeModelClient` from `@de_canter/apogee-ai` with two scripted turns; expect scores `[1, 0]`, `meanScore 0.5`, and that the fake's `calls[0].system` is the composed blocks.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: README** for prompts (sections, boundary rule, contributors, overrides, eval).
- [ ] **Step 4: Full verification** `pnpm typecheck && pnpm lint && pnpm build && pnpm test`; coverage ≥ 90% for both packages.
- [ ] **Step 5: Optional live smoke (costs money, needs `ANTHROPIC_API_KEY`)**: `packages/ai/scripts/smoke.ts` runs one `generateObject` on `claude-haiku-4-5` with a two-field schema and one `stream` of a one-line answer, printing usage. Run it once by hand to confirm the wire shapes (`output_config.format`, `eager_input_streaming`, `cache_control`) are accepted. Not part of `pnpm test`.
- [ ] **Step 6: Push and PR** `git push -u origin feature/ai-core`, `gh pr create --base main` with the plan as body. After merge: tag `ai-v0.1.0` and `prompts-v0.1.0`.

---

## Self-review

- **Spec coverage §3.1:** client creation (T4), model roles + resolver (T1), catalog + prices (T1), content blocks (T2), generate (T4), generateObject (T4), stream + events (T5), caching on system + tools (T2), usage ledger + sink (T3), retry + error taxonomy (T2, T4), FakeModelClient (T6). **§3.2:** definePrompt/sections/compose/boundary (T7), contributors (T7), overrides (T7), eval scaffold (T8).
- **Deferred to B2:** none of §3.1–3.2 is deferred. `refusal` server-side fallbacks are not enabled in this plan; `RefusalError` surfaces the refusal, and B2's agent decides. Add fallbacks as an option when a product needs it.
- **Type consistency:** `Usage` (T2) = `RawUsage` (T1) + `model` + `costUsd`, consumed by T3/T4/T5/T6; `ModelEvent` (T2) produced by T5/T6; `SystemBlock` (T2) is structurally what `toSystemBlocks` (T7) returns; `ModelClient` (T4) is consumed by T6 and T8.
