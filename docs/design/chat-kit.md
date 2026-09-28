# Apogee Chat Kit — Design Spec

**Status:** Design spec (source of truth for `@de_canter/apogee-chat-kit` and `@de_canter/apogee-chat-kit-app`)
**Created:** 2026-09-27
**Owner:** Jeff Canter
**Origin:** The Verve chat-native pattern brief (2026-09-27) and the reference-product recon that day (`thesomm` `docs/specs/2026-09-27-chat-native-phase0-recon.md`): three tool surfaces with no shared envelope, an MCP server with no gating and no UI, lifecycles implied by scattered writes, and a workflow layer that lives only in the PWA.
**Relationship to the other tracks:** Track B extension. Depends on kernel Phase 1 (`Lifecycle`, `ISODate`) and integrates with `@de_canter/apogee-agent` (tool adapter) and `@de_canter/apogee-artifacts` (cards receive the same envelope). Listed as §3.10 and §3.11 of `ai-abstractions.md`.

## 1. Purpose

The chat-native pattern:

- **Chat owns navigation.** The model decides what the user sees next and in what order.
- **The backend owns rules and state.** What is valid, what is required, what state an object is in.
- **Every capability is a tool** with a strict schema returning `{ state, allowed_next_actions, ui? }`, where `ui` is an optional MCP Apps fragment.
- **Fragments are self-contained.** They render only from the state they are handed, assume nothing about prior screens, and write back only through tools.
- **The PWA is just another client** of the same tools. No logic lives only in the PWA.

The kit is the mechanism. It turns one declaration of a domain object (schema, lifecycle, transitions, queries) into: a set of MCP tools with structured output and linked UI resources, a set of `apogee-agent` tools for an in-app chat, and an HTTP handler for a conventional client, all returning the same envelope and all enforcing the same lifecycle and entitlement checks. A second package gives fragments and PWA screens one way to consume that envelope and act on it.

What the kit does not know: what a bottle, a scan, or a booking is; how objects are stored; who the user is; which model powers anything. All of that is injected by the host.

## 2. Rules

The Track B rules apply (`ai-abstractions.md` §2): ports not persistence, domain vocabulary injected, one model client, registered prompts, kernel coding standards. In addition:

1. **One pipeline for every call.** Whatever the transport, a capability call runs: parse input → load → lifecycle check → entitlement assert → execute → target-state check → entitlement settle → envelope. A projection may add transport concerns (auth extraction, status codes) but never skips a step.
2. **Out-of-order actions are rejected, not tolerated.** A transition whose `from` does not include the current state fails before `execute` runs, with a machine-readable reason and the list of actions that *are* allowed.
3. **`allowed_next_actions` is derived, never hand-written.** It comes from the lifecycle's legal transitions at the resulting state, narrowed by each transition's `when` guard and the host's `policy`.
4. **The envelope is the only thing a fragment renders.** No fragment fetches anything except through `tools/call`, and every write is a capability call whose result replaces the envelope.
5. **The kit carries no model identifiers** and has no dependency on `@de_canter/apogee-ai`. Nothing in an envelope, a tool description, or a fragment can name the model.

## 3. Packages

```
@de_canter/apogee-kernel ── defineLifecycle ─┐
                                              ▼
                              @de_canter/apogee-chat-kit
                                .        contract, defineResource, defineCapability, createKit
                                ./mcp    registerKit(server, kit)        → @modelcontextprotocol/server 2 + ext-apps 2 (optional peers)
                                ./agent  toAgentTools(kit)               → @de_canter/apogee-agent Tool[]     (optional peer)
                                ./http   createHttpHandler(kit)          → transport-agnostic
                                ./remote createRemoteKit(opts), httpKitCall(opts) → a Kit built from a JSON Schema manifest, calls forwarded over HTTP
                                              │
                              @de_canter/apogee-chat-kit-app
                                .        createFragment, applyTheme     → @modelcontextprotocol/ext-apps App (peer)
                                ./react  EnvelopeProvider, useEnvelope, transports  (React optional peer)
```

| Package | Directory | Version | Dependencies | Peers |
|---|---|---|---|---|
| `@de_canter/apogee-chat-kit` | `packages/chat-kit` | 0.1.0 | `@de_canter/apogee-kernel`, `zod ^4` | optional: `@modelcontextprotocol/server ^2.1`, `@modelcontextprotocol/ext-apps ^2.0`, `@de_canter/apogee-agent` |
| `@de_canter/apogee-chat-kit-app` | `packages/chat-kit-app` | 0.1.0 | `@de_canter/apogee-chat-kit` (envelope schemas), `zod ^4` | `@modelcontextprotocol/ext-apps ^2.0`; optional: `react ^18 \|\| ^19` |

Both are tsup dual builds with subpath exports, strict TS, Vitest 4, ESLint from the root flat config. The MCP SDK line is **2.x** (`@modelcontextprotocol/server` 2.1.0, `@modelcontextprotocol/core` 2.1.0, `@modelcontextprotocol/ext-apps` 2.0.x, zod 4.2). There is no SDK 1.x adapter.

## 4. Contract

### 4.1 Envelope

```ts
export interface ActionDescriptor {
  /** Tool / capability name to call. */
  capability: string;
  /** Host copy shown on a button or chip. */
  title: string;
  /** Prefilled arguments, typically `{ id }`. The caller may add more. */
  args: Record<string, unknown>;
  /** Rendering hint. `poll` marks a read the client should repeat while the state is transient. */
  intent?: 'primary' | 'secondary' | 'destructive' | 'poll';
}

export interface Envelope<TView = unknown> {
  resource: string;                 // resource name, e.g. 'menu_scan'; 'home' for a standalone capability
  id: string | null;
  state: string;                    // lifecycle state name; '-' for stateless capabilities
  data: TView;                      // host-typed view; the only thing a fragment renders
  allowed_next_actions: ActionDescriptor[];
  ui?: { resource_uri: string };    // ui:// resource that renders this envelope
  entitlement?: unknown;            // host-shaped, from EntitlementPort.assert (e.g. { scans_left: 2 })
  at: ISODate;
}

export interface ListEnvelope<TView = unknown> {
  resource: string;
  items: Envelope<TView>[];
  next_cursor: string | null;
  allowed_next_actions: ActionDescriptor[];   // list-level actions, e.g. create
  ui?: { resource_uri: string };
  at: ISODate;
}
```

`envelopeSchema(view: ZodType<TView>)` and `listEnvelopeSchema(view)` return Zod schemas for the two shapes; the MCP projection uses them as `outputSchema`.

### 4.2 Errors

```ts
export type ChatKitErrorCode =
  | 'ILLEGAL_TRANSITION' | 'NOT_FOUND' | 'INVALID_INPUT'
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'ENTITLEMENT' | 'INTERNAL';

export class ChatKitError extends Error {
  code: ChatKitErrorCode;
  details?: unknown;
  /** What the caller can do instead. Always set for ILLEGAL_TRANSITION and ENTITLEMENT. */
  allowed_next_actions?: ActionDescriptor[];
}

// details for ILLEGAL_TRANSITION
{ resource: string; id: string; from: string; attempted: string; allowed: string[] }
```

`ChatKitError.toJSON()` yields `{ error: { code, message, details?, allowed_next_actions? } }`. Every projection serializes errors through it. `ChatKitError.is(e)` is a brand check on `Symbol.for('apogee.chat-kit.error')`, not `instanceof`, so errors are recognized across separately bundled entry points and ESM/CJS copies. Unknown throws from `execute` become `INTERNAL` with the original message logged, never surfaced.

### 4.3 Ports

```ts
/** Resolves the caller. Throws ChatKitError('UNAUTHENTICATED') when it cannot. */
export type PrincipalResolver<TPrincipal> = (auth: AuthInfo | undefined) => Promise<TPrincipal>;

/** Minimal shape the projections pass in. Mirrors the SDK's AuthInfo without importing it. */
export interface AuthInfo { token?: string; clientId?: string; scopes?: string[]; extra?: Record<string, unknown> }

export interface EntitlementCall<TPrincipal> {
  principal: TPrincipal;
  capability: string;
  resource: string;
  input: unknown;
}
export type EntitlementDecision =
  | { ok: true; view?: unknown }                          // view is copied onto envelope.entitlement
  | { ok: false; reason: string; details?: unknown; allowed_next_actions?: ActionDescriptor[] };

export interface EntitlementPort<TPrincipal> {
  assert(call: EntitlementCall<TPrincipal>): Promise<EntitlementDecision>;
  settle?(call: EntitlementCall<TPrincipal>, outcome: { success: boolean }): Promise<void>;
}
export const allowAll: EntitlementPort<unknown>;
```

`assert` runs after the lifecycle check and before `execute`; a denial becomes `ChatKitError('ENTITLEMENT')`. `settle` runs after `execute` resolves or rejects, with `success` telling the host whether to charge. Both are awaited; a throwing `settle` is logged and does not fail the call.

### 4.4 Resource definition

```ts
export interface ExecuteContext<TCtx, TPrincipal, TView, S extends string> {
  ctx: TCtx;
  principal: TPrincipal;
  current: { state: S; view: TView };   // absent on create and list
}

export interface TransitionDef<TCtx, TPrincipal, TView, S extends string, TInput> {
  from: S | readonly S[];
  to: S | readonly S[];                 // execute must return a state in `to`
  input: ZodType<TInput>;               // excludes `id`; the kit adds it
  title: string;
  description?: string;                 // tool description; defaults to title
  intent?: ActionDescriptor['intent'];
  when?: (current: { state: S; view: TView }) => boolean;
  execute: (input: TInput, c: ExecuteContext<TCtx, TPrincipal, TView, S>) => Promise<{ state: S; view: TView }>;
}

export interface QueryDef<…> {          // same fields minus from/to; execute returns { view } (state unchanged)
  input; title; description?; intent?; when?;
  execute: (input, c) => Promise<{ view: TView }>;
}

export interface ResourceDef<TCtx, TPrincipal, TView, S extends string> {
  name: string;                                        // snake_case; prefixes every tool name
  lifecycle: Lifecycle<S>;                             // kernel defineLifecycle(...)
  view: ZodType<TView>;
  load: (id: string, c: { ctx: TCtx; principal: TPrincipal }) => Promise<{ state: S; view: TView } | null>;
  create?: { input; title; description?; execute: (input, c) => Promise<{ id: string; state: S; view: TView }> };
  list?:   { input; title; description?; execute: (input, c) => Promise<{ items: Array<{ id; state; view }>; next_cursor: string | null }> };
  transitions: Record<string, TransitionDef<…>>;
  queries?: Record<string, QueryDef<…>>;
  policy?: (t: { name: string; to: S | readonly S[] }, current: { state: S; view: TView }, principal: TPrincipal) => boolean;
  describe?: (view: TView, state: S) => string;        // model-facing text; default compact JSON of { state, data }
  ui?: Partial<Record<'get' | 'list' | string, string>>; // capability name → ui:// resource uri
}

export function defineResource<…>(def: ResourceDef<…>): Resource<…>;
```

Generated capability names: `${name}_get` (input `{ id }`), `${name}_list`, `${name}_create`, `${name}_${transition}`, `${name}_${query}`. Transition and query inputs are `{ id } & input`.

Derivation of `allowed_next_actions` for a resource at `{ state, view }` and principal `p`:

1. For each transition `t` with `state ∈ t.from`, `t.when?.(current) !== false`, and `policy?.(t, current, p) !== false`: `{ capability: name_t, title, args: { id }, intent }`.
2. For each query `q` with `q.when?.(current) !== false`: same shape.
3. `get` is never listed (it is implied); `create` appears only on list envelopes.

The same `when` and `policy` are enforced when the capability is called, not only when actions are derived (see §4.7 step 4).

Kernel consistency: `defineResource` validates at definition time that every transition's `from` and `to` are states of the lifecycle and that each `(from, to)` pair is a legal kernel transition (`lifecycle.can`). An array `to` therefore requires a kernel transition for every `(from, to)` pair, not just one. A mismatch throws `InvalidLifecycleError` at startup, not at call time.

### 4.5 Standalone capabilities

```ts
export function defineCapability<TCtx, TPrincipal, TInput, TView>(def: {
  name: string; title: string; description?: string;
  input: ZodType<TInput>; view: ZodType<TView>;
  ui?: string;
  execute: (input, c: { ctx; principal }) => Promise<{ data: TView; allowed_next_actions?: ActionDescriptor[]; id?: string }>;
}): Capability<…>;
```

Returns `Envelope` with `resource: name`, `state: '-'`. Used for aggregates like a home screen that are not a lifecycle object.

### 4.6 Kit

```ts
export function createKit<TCtx, TPrincipal>(opts: {
  resources: Resource<TCtx, TPrincipal, any, any>[];
  capabilities?: Capability<TCtx, TPrincipal, any, any>[];
  ctx: TCtx;
  principal: PrincipalResolver<TPrincipal>;
  entitlement?: EntitlementPort<TPrincipal>;      // default allowAll
  onError?: (err: unknown, where: string) => void;   // logging hook: every INTERNAL (thrown or kit-generated), and settle failures as '<capability>:settle'
}): Kit;

export interface Kit {
  list(): CapabilityInfo[];      // { name, title, description, input: ZodType, output: ZodType, ui? }
  call(name: string, args: unknown, auth: AuthInfo | undefined): Promise<Envelope | ListEnvelope>;   // throws ChatKitError
}
```

Duplicate capability names across resources and standalone capabilities throw at `createKit`.

### 4.7 The pipeline (normative)

```
call(name, args, auth)
  1. capability = lookup(name)                       → NOT_FOUND if none
  2. principal  = await resolver(auth)               → UNAUTHENTICATED on throw
  3. input      = capability.input.parse(args)       → INVALID_INPUT with zod issues
  4. if resource-bound and not create/list:
       current = await load(id)                      → NOT_FOUND if null
       if transition and (current.state ∉ from or when false)
                                                     → ILLEGAL_TRANSITION { from: current.state, attempted, allowed: derive(current) }
       if transition and policy false                → FORBIDDEN (allowed_next_actions: derive(current))
       queries: when false                           → ILLEGAL_TRANSITION (same details)
  5. decision = await entitlement.assert(...)        → ENTITLEMENT on { ok: false }
  6. try result = await execute(...)                 → INTERNAL on throw (after step 7)
  7. await entitlement.settle(..., { success })      (always; failures logged)
  8. if transition and result.state ∉ to             → INTERNAL ("execute returned undeclared state")
  9. return envelope(result, derive(result), decision.view, ui)
```

`get` runs steps 5 and 7 too: its load is guarded by `entitlement.assert` / `settle`, and `decision.view` is copied onto its envelope. `create` and `list` results must name lifecycle states (`INTERNAL` otherwise).

## 5. Projections

### 5.1 MCP (`@de_canter/apogee-chat-kit/mcp`)

```ts
export interface FragmentDef {
  uri: string;                   // ui://<product>/<name>.html
  name: string;
  html: string | (() => Promise<string>);
  csp?: { connectDomains?; resourceDomains?; frameDomains?; baseUriDomains? };
  permissions?: { camera?; microphone?; geolocation?; clipboardWrite? };
  domain?: string;               // Claude stable origin, computed by the host
  prefersBorder?: boolean;       // default false
}

export function registerKit(server: McpServer, kit: Kit, opts?: {
  fragments?: FragmentDef[];
  auth?: (ctx: ServerContext) => AuthInfo | undefined;   // default: ctx.http?.authInfo
}): void;
```

Per capability: `registerAppTool(server, name, { title, description, inputSchema, outputSchema: envelopeSchema(view), _meta: ui ? { ui: { resourceUri } } : undefined }, handler)`. The handler passes `ctx.http?.authInfo` to `kit.call`. Success → `{ content: [{ type: 'text', text: describe(...) }], structuredContent: envelope }`. `ChatKitError` → `{ isError: true, content: [{ type: 'text', text: '<code>: <message>' }], structuredContent: err.toJSON() }`; when `allowed_next_actions` is non-empty the text ends with ` Allowed next: <capability>, <capability>` so the model sees what it may do. A host `describe` that throws after the call succeeded falls back to the default describe. Per fragment: `registerAppResource(server, name, uri, { mimeType: RESOURCE_MIME_TYPE }, cb)` where `cb` returns `contents[0]._meta.ui = { csp, permissions, domain, prefersBorder }`.

The text `content` is what the model sees; `structuredContent` is UI-only under the MCP Apps spec. `describe` therefore must be sufficient for the model to continue the conversation without the fragment.

### 5.2 Agent (`@de_canter/apogee-chat-kit/agent`)

```ts
export function toAgentTools<TCtx>(kit: Kit, opts: {
  auth: (ctx: TCtx) => AuthInfo | undefined;   // how the agent's context yields the caller
}): Tool<TCtx, unknown>[];
```

Each tool's `execute` calls `kit.call` and returns `ToolResult { success: true, data: envelope, artifact: { type: envelope.resource, id: toolUseId, data: envelope } }`; a `ChatKitError` becomes `{ success: false, error: code, data: err.toJSON() }` so the model can recover. The `artifact.type` is the resource name so an `apogee-artifacts` registry maps resource → card.

### 5.3 HTTP (`@de_canter/apogee-chat-kit/http`)

```ts
export interface HttpCall { capability: string; args: unknown; auth: AuthInfo | undefined; wrap?: boolean | undefined }
export interface HttpResult { status: number; body: unknown; text?: string | undefined }
export function createHttpHandler(kit: Kit): (call: HttpCall) => Promise<HttpResult>;
export const KIT_WRAP_HEADER = 'x-kit-wrap';
export function wantsWrap(headers: { get(name: string): string | null } | Record<string, string | string[] | undefined>): boolean;
export const STATUS_BY_CODE: Record<ChatKitErrorCode, number>;
// ILLEGAL_TRANSITION 409, NOT_FOUND 404, INVALID_INPUT 400, UNAUTHENTICATED 401, FORBIDDEN 403, ENTITLEMENT 402, INTERNAL 500
```

Framework glue is the host's: one Fastify route `POST /api/v1/kit/:capability` that builds `HttpCall` from `request.params`, `request.body`, its own auth plugin's output, and `wrap: wantsWrap(request.headers)`, then writes `reply.code(r.status).send(r.body)`. `HttpResult.text` is the same model-facing text `describe()` produces on success (falling back to `describeEnvelope` when the host's describe throws; `undefined` on error).

The body is the bare envelope by default, so plain clients (the fragment runtime's `httpTransport`, a PWA) are unaffected. When `wrap` is true — a remote kit asks with `x-kit-wrap: 1` (`wantsWrap` is true only for the exact value `'1'`, reading a fetch `Headers` or a Node/Fastify header record case-insensitively) — a **success** body is `{ envelope, text }` instead; the status is unchanged and error bodies are never wrapped. The text rides in the body, not a response header, because Node's fetch rejects responses whose headers exceed ~16 KiB and a list's text can get there.

### 5.4 Remote kit (`@de_canter/apogee-chat-kit/remote`)

A second process — typically an edge MCP server with no domain code — can hold a `Kit` whose capabilities are proxied over HTTP to the process that actually owns the kit (the product API, via `createHttpHandler`). The remote process needs no zod schemas: it builds its capability list from a JSON Schema manifest instead.

```ts
export interface CapabilityManifestEntry {
  name: string; title: string; description: string; resource: string;
  input_schema: Record<string, unknown>;    // JSON Schema, draft 2020-12
  output_schema: Record<string, unknown>;
  ui?: string | undefined;
}
export interface KitManifest { version: 1; capabilities: CapabilityManifestEntry[] }

/** Serializes a local kit's capabilities to JSON Schema (via z.toJSONSchema) so an edge can register them without the zod schemas. */
export function manifestOf(kit: Kit): KitManifest;   // exported from the package root
```

`jsonSchemaStandard(schema, { ajv? })` wraps a raw JSON Schema as a Standard Schema (`~standard`, vendor `apogee-chat-kit`) whose `validate` compiles the schema lazily (on the first call) and runs it through Ajv 2020 (`strict: false`, ajv-formats loaded, plus the formats `z.toJSONSchema` can emit that ajv-formats lacks — `cuid`, `cuid2`, `ulid`, `nanoid`, `jwt`, `e164`, `emoji`, `base64`, `base64url`, `cidrv4`, `cidrv6`, `xid`, `ksuid` — registered as pass-through so Ajv prints no `unknown format` warnings; `ipv4`/`ipv6` keep ajv-formats' real checks), and whose `jsonSchema.input`/`.output` return the schema unchanged. It uses the supplied Ajv instance, else a shared one; `createRemoteKit` creates one Ajv per kit. `manifestOf` recognises such a schema (`'~standard'` with vendor `apogee-chat-kit`) and emits its `jsonSchema` instead of calling `z.toJSONSchema`, so `manifestOf(createRemoteKit({ manifest: m, call }))` equals `m`.

**Runtime:** `./remote` is Node-runtime only. Ajv generates validator code with `new Function`, which the Edge Runtime and Cloudflare Workers forbid; run the edge MCP server on a Node function.

```ts
export const KitManifestSchema: z.ZodType<KitManifest>;   // also exported from the package root
export type { StandardJsonSchema, StandardResult, StandardIssue, JsonSchemaStandardOptions };

export interface RemoteCallResult { status: number; body: unknown; text?: string | undefined }
export type RemoteCall = (capability: string, args: unknown, auth: AuthInfo | undefined) => Promise<RemoteCallResult>;

export function createRemoteKit(opts: { manifest: KitManifest; call: RemoteCall }): Kit;

export interface HttpKitCallOptions {
  baseUrl: string;                              // capability name is appended as a path segment
  headers?: Record<string, string> | undefined; // static headers, e.g. an edge secret
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;               // whole-call deadline, default 30000
}
export function httpKitCall(opts: HttpKitCallOptions): RemoteCall;
```

`createRemoteKit` semantics:

- the manifest is parsed with `KitManifestSchema` first (`version: 1`, every entry's fields, `input_schema`/`output_schema` objects); anything else — an error body fetched by mistake, a `version: 2` manifest — throws `createRemoteKit: invalid manifest: <path>: <first issue>`.
- `list()` / `get(name)` read the manifest; each entry's `input`/`output` are `jsonSchemaStandard(entry.input_schema / .output_schema)`, cast to `z.ZodType` for `CapabilityInfo` (see the limitation below).
- `call(name, args, auth)` calls `name` against the manifest (`NOT_FOUND` if unlisted), invokes `opts.call(name, args, auth)` (a `ChatKitError` it throws passes through unchanged; any other throw becomes `INTERNAL` `Remote kit call failed`), and:
  - a 2xx status is parsed as an `Envelope` or `ListEnvelope` (tried in that order via the shared contract schemas); a body that matches neither throws `ChatKitError('INTERNAL', 'Remote kit returned a non-envelope body')`.
  - a non-2xx status expects `{ error: { code, message, details?, allowed_next_actions? } }` (the shape `ChatKitError.toJSON()` produces) and rethrows the same `ChatKitError`, preserving `code`, `details`, and `allowed_next_actions`.
  - a non-2xx body that isn't that shape maps by status: 400 → `INVALID_INPUT`, 401 → `UNAUTHENTICATED`, 402 → `ENTITLEMENT`, 403 → `FORBIDDEN`, 404 → `NOT_FOUND`, keeping the body's string `message` (`{ message }` or `{ error: { message } }`) when it has one; anything else → `INTERNAL` (`Remote kit returned <status>`, never the foreign message, which may carry upstream internals).
  - when the transport result carries `text`, it is associated with the parsed envelope so `describe()` returns it verbatim instead of falling back to `describeEnvelope`.
- `describe(name, result)` returns the associated `text` when the transport supplied one, else `describeEnvelope(result)` — the same default a local kit uses.

`httpKitCall` builds the default `RemoteCall`: `POST {baseUrl}/{encodeURIComponent(capability)}` with `content-type`/`accept: application/json`, `x-kit-wrap: 1`, the caller's bearer token (`auth.token`) as `authorization: Bearer <token>` when present, and any static `headers` merged in first (so a caller-supplied `authorization` header, if any were passed as a static header, would be overridden by the bearer token — static headers are meant for transport-level secrets, not per-call auth). The response body is read as text, then JSON-parsed if non-empty (kept as the raw string on a parse failure — a non-JSON error page from a proxy, say — so `toError` still has something to report). On a 2xx, a `{ envelope, text }` body (object with an `envelope` key and a string `text`) is unwrapped into `RemoteCallResult.body`/`.text`; any other 2xx body (a bare envelope from a host that dropped or ignored the header) is passed through with no `text`, so `describe()` falls back to `describeEnvelope`. Non-2xx bodies are never unwrapped. The whole call (request and body read) is bounded by `timeoutMs` via `AbortSignal.timeout`, raced against the signal so a fetch that ignores it still settles; past the deadline it rejects with `ChatKitError('INTERNAL', 'Remote kit call timed out after <n>ms')`, which `createRemoteKit` passes through. Other fetch failures are rethrown as-is (and become `INTERNAL` in `createRemoteKit`).

**Divergences from a local kit.** A remote kit advertises the same JSON Schemas and returns the same envelopes, but it is not byte-for-byte the local pipeline at the edge:

- validation messages are Ajv's, not zod's (the MCP SDK reports them as `Input validation error: …` before the call leaves the edge);
- zod refinements, transforms and custom checks have no JSON Schema form, so the edge does not enforce them — the API still does, and its `INVALID_INPUT` comes back through the error mapping;
- string formats differ in strictness (Ajv's `uri`, `email`, etc. are not zod's regexes; zod-only formats are pass-through at the edge and rely on the `pattern` zod emits alongside them);
- types JSON Schema cannot represent are serialized as `{}` (`unrepresentable: 'any'`), so the edge accepts anything there;
- unknown keys in a success body are stripped by the contract schemas when the envelope is re-parsed at the edge.

**Limitation:** `CapabilityInfo.input`/`.output` are typed as `z.ZodType` because a local kit's capabilities are always zod. A remote kit's capabilities are Standard JSON Schemas (`jsonSchemaStandard`) cast to `z.ZodType` at the type level so `createRemoteKit` can return a `Kit` at all — the cast does not make them real zod schemas, so `.parse`/`.safeParse` and other zod-specific methods are not actually present at runtime. Any consumer of `CapabilityInfo` beyond `list()`/`get()` must therefore guard against a remote capability rather than trust the type. `toAgentTools` (§5.2) is the one place in this package that does: it checks each capability at runtime and throws `toAgentTools requires a local kit (zod input schemas); got a remote kit capability: <name>` instead of building a malformed agent tool.

## 6. Fragment runtime (`@de_canter/apogee-chat-kit-app`)

### 6.1 Core

```ts
export interface FragmentContext<TView> {
  envelope: Envelope<TView> | ListEnvelope<TView> | null;    // null until the first tool result; isListEnvelope discriminates
  host: { theme: 'light' | 'dark'; displayMode: string; platform?: string; locale?: string } | null;
  status: 'idle' | 'acting' | 'error';
  error: { code: string; message: string; allowed_next_actions?: ActionDescriptor[] } | null;
  act(action: ActionDescriptor, extraArgs?: Record<string, unknown>): Promise<void>;
  ask(text: string): Promise<void>;     // ui/message as the user
  openLink(url: string): Promise<void>;
}

export function createFragment<TView>(opts: {
  name: string; version: string;
  render: (c: FragmentContext<TView>) => void;
  view?: ZodType<TView>;                // validates data (single envelope or each list item)
  theme?: ThemeMap;                     // host tokens → product CSS custom properties
  app?: App;                            // injectable for tests
}): { app: App; connect(transport?: Transport): Promise<void>; destroy(): void };   // default transport: PostMessageTransport(window.parent)
```

Behavior: uses `opts.app` or constructs `new App({ name, version })`; before `connect`, as the ext-apps SDK requires, registers with `app.addEventListener` a `toolresult` listener (parses `structuredContent` as an envelope OR a list envelope via `envelopeSchema(view)` / `listEnvelopeSchema(view)`; an `isError` result sets `error`; anything else is `INVALID_INPUT`), a `toolinput` listener (ignored), and a `hostcontextchanged` listener (updates `host`, applies theme), and sets `onteardown` (destroys the fragment). `connect(transport?)` connects over the given transport or `new PostMessageTransport(window.parent, window.parent)`, reads the host context, and renders. `act` sets `status: 'acting'`, calls `app.callServerTool({ name: action.capability, arguments: { ...action.args, ...extraArgs } })`, replaces `envelope` from `structuredContent`, then `app.updateModelContext({ content: [{ type: 'text', text: <the tool result's first text block, else describeEnvelope(envelope)> }], structuredContent: envelope })` so the model knows what the user did inside the card. Every state change calls `render`; a throwing `render` becomes `status: 'error'` (`INTERNAL`). `destroy()` removes the listeners and closes the connection; after it, `render` and `act` are no-ops.

`applyTheme(host, map)`: `map` is `{ [productVar: string]: (host: HostStyle) => string }`; default map writes `--ck-surface`, `--ck-text`, `--ck-accent` from the host's variables and theme. Products supply their own map.

### 6.2 React (`@de_canter/apogee-chat-kit-app/react`)

```ts
export interface EnvelopeTransport {
  call(capability: string, args: Record<string, unknown>): Promise<Envelope | ListEnvelope>;   // rejects with { code, message, allowed_next_actions? }
  subscribe?(onEnvelope: (e: Envelope | ListEnvelope) => void, onError: (e: FragmentError) => void): () => void;   // pushes from the host (tool results)
  afterAct?(e: Envelope | ListEnvelope): Promise<void>;         // e.g. updateModelContext
}
export function mcpAppTransport(app: App): EnvelopeTransport;   // fragments; build before connect(): it replays the latest tool result to each subscribe
export function httpTransport(call: (capability: string, args: Record<string, unknown>) => Promise<unknown>): EnvelopeTransport;   // PWA; call returns the parsed body or throws

export function EnvelopeProvider<TView>(props: { transport: EnvelopeTransport; initial?: Envelope<TView> | ListEnvelope<TView>; children }): JSX.Element;
export function useEnvelope<TView>(): { envelope: Envelope<TView> | ListEnvelope<TView> | null; act; status; error };
export function useAction(action: ActionDescriptor): { run(extra?): Promise<void>; pending: boolean };
```

A card component uses `useEnvelope` and `useAction` only. In a fragment it sits under `EnvelopeProvider` with `mcpAppTransport(fragment.app)`; in the PWA under `EnvelopeProvider` with `httpTransport(apiClient.callKit)`. The component is identical.

## 7. Testing

No network, no browser beyond jsdom.

- **chat-kit core:** a fixture resource (`ticket`: `open → triaged → closed`, plus `reopen`) with an in-memory map. Tests: legal transition returns the next envelope with derived actions; illegal transition rejects before `execute` with `allowed` listed; `when` and `policy` narrow actions; `entitlement.assert` denial short-circuits and `settle` sees `success: false`; `execute` throwing yields `INTERNAL` and still settles; undeclared return state → `INTERNAL`; definition-time validation against the kernel lifecycle; duplicate names rejected; `describe` default; standalone capability envelope.
- **mcp projection:** real `McpServer` + real `Client` over `InMemoryTransport.createLinkedPair()` (both imported from `@modelcontextprotocol/server`). Tests: `tools/list` shows `outputSchema` and `_meta.ui.resourceUri`; `tools/call` success returns `structuredContent` that validates against `outputSchema`; error returns `isError` with the error JSON; `resources/read` on a fragment returns `text/html;profile=mcp-app` with CSP meta; `authInfo` reaches the principal resolver.
- **agent projection:** tool shape, envelope in `data` and `artifact`, error mapping.
- **http projection:** every code maps to its status; success is 200 with the envelope.
- **chat-kit-app core:** stub `App` (an object with the same handler slots and `callServerTool`/`updateModelContext` spies): tool result → render with envelope; `act` → correct `tools/call` args → re-render → `updateModelContext` called with the new envelope; error result → `status: 'error'` with `allowed_next_actions`; theme map applied on host-context change.
- **chat-kit-app react:** Testing Library: `useEnvelope` renders and updates through both transports; `useAction.pending` toggles; the same component renders identically under `mcpAppTransport` and `httpTransport` given equal envelopes.

Coverage target: ≥ 95% lines in both packages, matching the track.

## 8. What the reference product consumes (Phase 2, not this package)

- A `menu_scan` resource: `queued → processing → ready → reviewed`, plus `failed` (terminal); transitions `start`, `complete` (worker), `fail` (worker), `get_picks` / `update_picks` (`ready|reviewed → reviewed`), `add_page` (`ready|reviewed → processing`); query `refresh` with `intent: 'poll'` while `processing`.
- A `bottle` resource with the implied machine made explicit; the first transition consumed is `add_to_cellar` from a recommendation.
- `home` standalone capability.
- Three fragments: scan card, recommendation list, bottle card; built as single-file HTML with `vite-plugin-singlefile`, styled from the product's tokens, `prefersBorder: false`.
- Its MCP server moves to SDK 2 and, most likely, onto the Fastify API via `@modelcontextprotocol/fastify`, so principal resolution and entitlement exist once. Its `EntitlementPort` wraps the existing afford/charge/capture-guard services.

## 9. Non-goals

- No persistence in the kit. `load`, `execute`, `create`, `list` are host code against host repos.
- No SDK 1.x adapter.
- No fragment build tooling; the recipe is documented, the bundler is the product's.
- No streaming inside a capability. Long-running work returns a transient state plus a `poll` action; the worker moves the state through declared transitions.
- No opinion on auth providers. The principal resolver is host code.
- No card components. The kit ships the provider, hooks, and runtime; products ship cards.

## 10. Acceptance

1. `pnpm typecheck && pnpm lint && pnpm build && pnpm test` clean at the root with both packages present.
2. The fixture resource, registered on a real SDK 2 server, is callable from a real SDK 2 client with `structuredContent` validating against the advertised `outputSchema`, and an illegal transition returns `isError` with `ILLEGAL_TRANSITION` and the allowed list.
3. One React card renders the same DOM under `mcpAppTransport` and `httpTransport` for the same envelope in the test suite.
4. `grep -ri "claude\|anthropic\|opus\|sonnet\|haiku" packages/chat-kit packages/chat-kit-app/src` returns nothing outside comments that reference the MCP host by product name.
5. Tags `chat-kit-v0.1.0` and `chat-kit-app-v0.1.0` with tarballs on their releases; `docs/consuming.md` lists both.
