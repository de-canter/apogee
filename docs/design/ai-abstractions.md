# Apogee AI Abstractions — Design Spec

**Status:** Design spec (source of truth for the `@de_canter/apogee-ai*`, `@de_canter/apogee-agent*`, `@de_canter/apogee-rules`, `@de_canter/apogee-documents-ai`, `@de_canter/apogee-knowledge`, `@de_canter/apogee-integrations` packages and the apogee.build showcase)
**Created:** 2026-09-17
**Owner:** Jeff Canter
**Origin:** Conversation 2026-09-17 following the kernel ontology (`kernel-ontology.md`); two code surveys of the reference product (`apps/api/src/chat`, `services/*`, `apogee/*`) on the same day.
**Relationship to the kernel:** This is Track B. Track A is the kernel (`kernel-ontology.md`, Phase 1 shipped as `@de_canter/apogee-kernel` v0.1.0). Track B depends on kernel Phase 1 (`Ref`, `ISODate`, `Provenance`, `Assertion`, `Lifecycle`) and on nothing from kernel Phase 2.

## 1. Purpose

The reference product has the most complete AI functionality of any Verve product: an
agentic chat with ~95 tools and 42 artifact cards, an admin assistant that
configures the system through conversation, a natural-language behavior
engine, a document classify-and-extract pipeline with confidence and human
correction, a lexical knowledge base, and a no-code integration engine.

Almost none of it is reusable today. The survey found:

| Finding | Evidence |
|---|---|
| The shared AI package is ~90% dead code | Only `ChatSession`, `AnthropicProvider`, and the `Tool`/`OrderContext` types are consumed. `AIService`, `TokenTracker`, `OpenAIProvider`, `PlainLanguageProcessor`, `ComponentGenerator`, `ContextManager` have zero consumers. |
| The one production path is untested | `ChatSession` (552 LOC streaming + agentic loop) has no tests; the two tested files are dead ones. |
| 16 production files bypass the package | Each constructs `new Anthropic()` itself because the package lacks vision, structured output, and prompt caching. |
| Model selection is scattered | Two registry entries (`ai.defaultModel`, `ai.visionModel`), six private fallbacks, several hardcoded IDs; the chat default model is not in the cost table so every request is costed at $0. |
| Prompts have six storage idioms | TS constants, a composer, a `Record<docType, string>`, inline literals, DB free-text compiled at runtime, retrieved chunks. No registry, no versioning, no evals. |
| The framework package leaks the domain | `OrderContext` (order number, sale price, closing date, C3 pipeline summary) lives inside `@de_canter/apogee-ai-integration`. |

Track B extracts the *mechanisms* into product-agnostic packages in this
repo, leaves every domain vocabulary in the product, proves each package
against the reference product's use cases it came from, and showcases each one as a
live demo on apogee.build.

## 2. Rules (apply to every package in this track)

1. **Ports, not persistence.** Each package defines the storage interface it
   needs (`SessionStore`, `RuleStore`, `AuditSink`, `ChunkStore`, `VaultPort`)
   and ships an in-memory implementation. Mongoose or other adapters are
   separate packages, built after the port is stable. The in-memory adapters
   are what apogee.build demos run on.
2. **Domain vocabulary is injected, never declared.** Document taxonomies,
   rule condition dimensions, artifact card components, tool sets, prompt
   sections, identifier schemes: all come from the host application as typed
   configuration or generics. A package that ships an enum of real-estate
   document types is wrong.
3. **AI output enters as an Assertion.** Anything a model produces that a
   human might overrule (extracted field, parsed rule, classified webhook,
   suggested config) is a kernel `Assertion` carrying `Provenance` with
   `source.kind = 'ai'`, a confidence, and a `proposed` status. Confirmation
   is the host's decision and is recorded.
4. **One model client.** No package and no host constructs the Anthropic SDK
   client directly. Everything goes through `@de_canter/apogee-ai`. That is the whole
   point of the first package.
5. **Every prompt is registered.** Prompts have a name, a version, and
   sections; they are composed, not concatenated inline. This makes prompt
   caching and evals possible.
6. **The same coding standards as the kernel**: strict TS, Zod schemas,
   Vitest, tsup dual build, JSON-safe stored shapes, ISO date strings.

## 3. Package map

```
@de_canter/apogee-kernel  (Track A) ──────────────────────────────────────────┐
                                                                     │
@de_canter/apogee-ai ─────────┬──────────────┬───────────────┬────────────────┤
  provider client   │              │               │                │
  models/cost       │              │               │                │
  structured output │              │               │                │
  vision            │              │               │                │
  prompt caching    │              │               │                │
  streaming events  │              │               │                │
                    │              │               │                │
@de_canter/apogee-prompts ────┤              │               │                │
  registry/compose  │              │               │                │
                    ▼              ▼               ▼                ▼
             @de_canter/apogee-agent   @de_canter/apogee-rules   @de_canter/apogee-documents-ai  @de_canter/apogee-integrations
               tool loop      NL→rule          classify/extract     patterns/execution
               SSE protocol   validate         confidence           resilience
               compaction     evaluate         corrections          AI post-process
               config memory  audit            audit                inbound classify
                    │
                    ├── @de_canter/apogee-agent-react   (client hooks, SSE decoder, chat UI shells)
                    └── @de_canter/apogee-artifacts     (tool-result-as-UI protocol, renderer registry, actions)

             @de_canter/apogee-knowledge  (chunking, retrieval port, embedding port, prompt injection) → used by agent
```

Nine packages. Each is small enough to hold in context, has one purpose,
and maps to one section and one live demo on apogee.build.

### 3.1 `@de_canter/apogee-ai` — model client

The replacement for the 16 direct SDK constructions. Anthropic is the only
implemented provider; the interface admits others.

- `createModelClient({ provider, apiKey, resolveModel })`.
- `ModelResolver` port: `(role: 'default' | 'vision' | 'fast' | string) => ModelId`. The host plugs its system-defaults cascade in here. Packages ask for a *role*, never a model ID.
- `ModelCatalog`: known model IDs with input/output/cache-read/cache-write prices, kept current in this repo, overridable per client.
- Messages carry **content blocks** (`text`, `image`, `document`) so vision and PDF-native extraction go through the same client.
- `generate(request)`: one-shot text.
- `generateObject(schema, request)`: structured output via tool-forcing, validated with the Zod schema, returns `{ value, usage }` or a typed `StructuredOutputError` with the raw text.
- `stream(request)`: an `AsyncIterable<ModelEvent>` with a small, provider-neutral event set: `text_delta`, `tool_use_start`, `tool_use_delta`, `tool_use_end`, `message_end` (with usage), `error`.
- **Prompt caching** on by default for the system prompt and the tool list (`cache_control: ephemeral`), with cache read/write tokens reported in `Usage`.
- `Usage` ledger: input, output, cache read, cache write, cost from the catalog, per call and per session; a `UsageSink` port for the host to persist.
- Retry with backoff on rate-limit and overloaded errors; an error taxonomy (`RateLimited`, `Overloaded`, `ContextTooLong`, `InvalidRequest`, `StructuredOutputError`).
- Test doubles: a scripted `FakeModelClient` that replays recorded events, so every downstream package tests without network.

Salvage from `apogee/ai-integration`: the provider interface idea and the token-tracker math. Everything else is replaced.

### 3.2 `@de_canter/apogee-prompts` — prompt registry

Greenfield. Replaces six idioms with one.

- `definePrompt({ name, version, sections })` where a section is static text, a function of a typed context, or a **contributor** slot that other packages fill at compose time (rules compiler, knowledge retrieval, config memory).
- `composePrompt(prompt, context)` returns `{ system: ContentBlock[], cacheBoundary }`: stable sections first so the cache prefix is maximal, volatile sections after the boundary.
- Prompts are plain objects, so a product can store overrides in its database and merge them.
- `evalPrompt(prompt, cases, judge)` scaffold: run cases through a client, score with a rubric or an LLM judge, emit a report. Minimal in this track; exists so prompts have a home for tests.

### 3.3 `@de_canter/apogee-agent` — agentic session

Generic `ChatSession`, lifted and fixed.

- `AgentSession<TContext>`: system prompt (a composed prompt), tool registry, context object of the host's type, history, model role. `OrderContext` leaves the framework; the reference product passes it as `TContext`.
- `Tool<TContext>`: `{ name, description, parameters (Zod), execute(args, ctx) }`. Parameters are Zod, converted to JSON Schema once and cached.
- `run(userMessage)` returns `AsyncIterable<AgentEvent>`: `text_delta`, `tool_call`, `tool_result`, `artifact`, `turn_end`, `error`. Bounded tool rounds, per-round usage, hooks for start/complete/error with timing.
- **History compaction**: token budget, compact at a threshold, keep the last N pairs, summarize the rest with a registered prompt, persist the summary as a `compacted` message so it survives reload. Lifted from the admin assistant.
- **Config memory**: a `MemoryPort` keyed by a host-defined tuple, read into the prompt at session start and written by a built-in `update_memory` tool. Lifted from `WorkflowConfigContext`.
- **SSE wire protocol**: `encodeAgentEvent` for servers, one frame per `AgentEvent`. Framework-agnostic: works with a Fastify `reply.raw` or a Next.js `ReadableStream`.
- Ports: `SessionStore`, `MessageStore`, `MemoryPort`, `TelemetrySink` (tool timing, context changes). In-memory implementations included.
- The admin assistant is a **composition**, not a package: an `AgentSession` with the config-tool families and the memory port. The tool families that need entity models (users, org, workflows, task templates, fees) arrive with kernel Phase 2. The showcase demonstrates the composition on the demo domain.

### 3.4 `@de_canter/apogee-agent-react` — client

- `useAgentSession({ endpoint, sessionId })`: sends messages, decodes SSE frames into state, tracks tool activity, exposes `sendMessage`, `messages`, `streaming`, `usage`.
- Unstyled UI shells with slots: `MessageList`, `Composer`, `ToolActivity`, `ContextMeter`. Products style them; the showcase styles them once.
- Generalized from `use-chat-orchestrator` and the chat components.

### 3.5 `@de_canter/apogee-artifacts` — tool results as UI

- Server side: `artifact(type, id, data, props?)` helper for tools; the `artifact` `AgentEvent`.
- Client side: `ArtifactRegistry` mapping `type → React component`; `<ArtifactRenderer>` that looks up the registry; `useArtifactActions` that turns a card interaction into the next agent message with a typed `artifactAction` payload; `useArtifactEvents` for batched interaction telemetry.
- The host registers its cards. The framework ships none, except the showcase's demo cards.

### 3.6 `@de_canter/apogee-rules` — natural-language behavior engine

Lift of E11. The cleanest extraction in the repo.

- `Rule` shape: id, name, category, `conditions` (typed by the host's **condition dimensions**), instruction, suggested actions, default action, gate, structured checks, priority, enabled, version, scope, provenance.
- `defineDimensions({ documentType: z.enum([...]), status: ..., ... })`: the host declares what a rule can condition on. The parser prompt, validator, and evaluator are generated from it. This removes the only title coupling.
- `parseRule(text)` returns a kernel `Assertion` whose object is a `Rule` and whose provenance carries confidence and ambiguities; the admin confirms it.
- `validateRule`, `detectConflicts(rules)`, `suggestRules(auditLog)`: LLM-backed, through `@de_canter/apogee-ai` with registered prompts.
- `evaluate(rule, facts)`: structured checks first (deterministic, no model), then the LLM instruction if the checks pass and it is enabled. Returns a typed result with which layer decided.
- `compileRulesSection(rules, context)`: the prompt-registry contributor that injects matching rules into an agent's system prompt.
- `simulate(rule, scenarios)`, `RuleAudit` sink, `RuleStore` port with the DB-first, file-fallback loader pattern.

### 3.7 `@de_canter/apogee-documents-ai` — classify, extract, confirm

Lift of the E19 pipeline mechanism.

- `defineTaxonomy([{ code, label, hints }])`: the host's document types.
- `defineExtraction(code, zodSchema, promptSection)`: per-type schema and prompt.
- `classify(input)`: routes image vs PDF vs text through content blocks; returns an `Assertion` of the type code with confidence.
- `extract(code, input)`: `generateObject` against the registered schema; every field becomes an `Assertion` with per-field confidence where the model provides it.
- `Correction` model: original, corrected, by, at; `AuditSink` port records the run, model, duration, and corrections. This is the ground-truth store for later evals.
- `reconcile(extractions[])`: cross-document field reconciliation with a conflict report.
- The staged, resumable pipeline runner and `ConfidenceScore { value, level, factors }` from the examination engine are extracted here as `Pipeline` and `Confidence`, since document work is the natural home. The examination engine itself stays in the reference product.

### 3.8 `@de_canter/apogee-knowledge` — retrieval

- `chunkMarkdown(source)`: heading-split then size-split, content hash, stable ids.
- `ChunkStore` port with `upsert`, `search(query, { scope })`; in-memory lexical implementation.
- `EmbeddingPort` and a vector `ChunkStore` variant, so the `embedding` field the reference product declared but never filled gets a real path. Embeddings via the model client where the provider supports it, or a host-supplied embedder.
- `retrieveSection(query)`: the prompt-registry contributor that injects retrieved chunks with citations.
- Role scoping on chunks (`user`, `admin`, `platform`), matching E28.

### 3.9 `@de_canter/apogee-integrations` — no-code REST patterns

Lift of E21 to E25 with minimal change.

- `IntegrationPattern` schema as-is (direction, trigger, request template, auth method, response mapping, transforms, inbound config, AI post-processing).
- `executePattern(pattern, input)` with rate limit, circuit breaker, retry, dead letter, schema drift detection, execution audit.
- AI post-processing and inbound payload classification go through `@de_canter/apogee-ai` with registered prompts; the classification result is an `Assertion`.
- `VaultPort` for credentials; five auth methods.
- Admin tools (`create`, `test`, `approve`, `pause`, `trace`, `health`) exported as a `Tool<TContext>[]` for `@de_canter/apogee-agent`.

## 4. What stays behind, and why

| Left in the reference product | Reason |
|---|---|
| 39 order-chat tool modules, 42 artifact cards, all prompts' prose, help content | Domain content. The framework ships the mechanism only. |
| Examination engine's nine analysis services | Deterministic domain logic; no AI. Only `Confidence` and the pipeline runner move. |
| `apogee/workflow-engine` | Zero consumers, zero tests, two unused heavy dependencies. Not extracted in this track. Kernel Lifecycle plus a future executor supersedes it. |
| `apogee/mcp-framework` | Not MCP (no protocol SDK). Out of scope for this track; revisit as a real MCP package later. |
| `apogee/document-gen` | Rendering, not AI. Extract in its own track after it gets tests and loses the product's `DocumentCategory` enum. |
| The QA agent | A parallel agent runtime. Once `@de_canter/apogee-agent` exists, it is a candidate consumer, not a source. |

## 5. apogee.build showcase

`apogee-build` is a static Next.js 16 landing page today: five package cards
and `npm install` lines for packages that are not published. The showcase
turns it into the living proof of the framework.

- **One demo domain across every demo**, built on kernel nouns and free of
  any Verve product's vocabulary: a small **equipment rental company**.
  Parties (customers, technicians), Commitments (rental agreements),
  Resources (equipment types, units with serial numbers), Documents
  (agreements, inspection reports, invoices), Money, Places (yards). Rich
  enough to exercise every package, boring enough that nobody mistakes it
  for a product.
- **One section per package**, each with: the problem it solves in two
  sentences, a live demo, the code that powers the demo (the actual source,
  not a snippet), and the API reference generated from the package.
- **Live demos** run in Next.js route handlers on Vercel with a server-side
  API key, per-visitor rate limits, and the in-memory adapters. The demos
  are: agent chat with tools and artifact cards; admin assistant that
  changes rental rules and pricing through conversation; drop a rental
  agreement or inspection photo and watch classify, extract, and correct;
  author an integration pattern against a mock weather or geocoding API and
  run it; ask the knowledge base about the demo company's policies.
- **Consumption is real**: the site depends on the packages through the same
  git-dependency mechanism any Verve product will use, pinned to tags.
- The landing page's package list becomes generated from the workspace, so
  it cannot drift from what exists.

## 6. Ordering and plans

Each is its own plan file in `docs/plans/`, each producing working, tested
software and a showcase section. The order follows the dependency graph and
front-loads the piece that unblocks everything else.

| Plan | Delivers | Depends on |
|---|---|---|
| B1 | `@de_canter/apogee-ai` + `@de_canter/apogee-prompts` | kernel v0.1.0 |
| B2 | `@de_canter/apogee-agent` + `@de_canter/apogee-agent-react` + `@de_canter/apogee-artifacts`; showcase: chat demo | B1 |
| B3 | `@de_canter/apogee-rules`; showcase: admin assistant demo (rules + memory) | B2 |
| B4 | `@de_canter/apogee-documents-ai` + `@de_canter/apogee-knowledge`; showcase: document and knowledge demos | B1, B2 |
| B5 | `@de_canter/apogee-integrations`; showcase: integration demo | B2 |
| B6 | apogee.build restructure: generated package index, API reference, demo domain fixtures | can start alongside B1; demos land per plan |

The reference product does not adopt any of this incrementally. The clean-room
rewrite consumes Track A and Track B together once both are tagged.

## 7. Acceptance criteria for the track

- Every one of the 16 bypass reasons is answerable by `@de_canter/apogee-ai` alone (vision, PDF, structured output, caching, model roles, usage).
- `@de_canter/apogee-agent` reproduces the reference product's chat behavior on the demo domain: streaming, tools, artifacts, compaction, memory, with tests against the `FakeModelClient`.
- `@de_canter/apogee-rules` round-trips a natural-language rule to a confirmed `Rule` and evaluates it in both layers, with the condition dimensions supplied by the demo domain.
- `@de_canter/apogee-documents-ai` classifies and extracts a demo document, records a correction, and exposes it for eval.
- Every package: strict TS, no `any`, tests with no network, 90% line coverage, dual build, consumable by git dependency.
- apogee.build shows each package with a working demo and generated API docs, deployed on Vercel.

## 8. Non-goals

- No OpenAI or other provider implementation in this track; the interface admits one.
- No fine-tuning, no training-data pipelines.
- No multi-tenant runtime in the packages; tenancy is a host concern passed through context.
- No migration of the reference product's existing code paths onto these packages.
