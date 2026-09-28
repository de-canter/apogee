# Plan C2 — chat-kit 0.2.0: manifest + remote kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-28
**Origin:** The Somm Phase 2 design (`thesomm` repo, `docs/specs/2026-09-28-chat-native-phase2-design.md` §3): an MCP edge with no database must register a kit's capabilities from a manifest and forward calls to the product API.

**Goal:** Ship `@de_canter/apogee-chat-kit` 0.2.0 with `manifestOf(kit)`, a JSON-Schema-backed Standard Schema wrapper, `createRemoteKit` + `httpKitCall` (subpath `./remote`), and an optional `text` on successful HTTP results, so `registerKit(server, remoteKit)` works unchanged against a kit that lives behind HTTP.

**Architecture:** `manifestOf` serializes each capability's zod input/output to JSON Schema (draft 2020-12). `jsonSchemaStandard(schema)` wraps a JSON Schema as a `StandardSchemaWithJSON` (validate via Ajv 2020, `~standard.jsonSchema.input/output` returning the schema) so SDK 2 advertises and validates it exactly like a zod schema. `createRemoteKit` implements `Kit` over an injected `call(capability, args, auth) → { status, body, text? }`: 2xx → envelope, non-2xx `{ error }` → `ChatKitError` with the same code. `httpKitCall` is the fetch-based default, sending the caller's bearer token plus static headers and reading the `X-Kit-Text` header. The HTTP projection gains `text` (the host describe) on success.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`), zod 4, `ajv` ^8 + `ajv-formats` (regular dependencies of chat-kit, imported only by the manifest/remote modules), Vitest 4, tsup; `@modelcontextprotocol/server` + `client` 2.1 as dev/optional peers as today.

**Spec:** `docs/design/chat-kit.md` — add §5.4 "Remote kit" and §3 subpath `./remote` as part of this plan (Task 5).

## Global Constraints

- Package stays `packages/chat-kit`; version becomes `0.2.0`; new subpath export `./remote` (`dist/remote.js|cjs|d.ts`); tsup entries gain `src/remote.ts`.
- New runtime dependencies allowed: `ajv ^8.17`, `ajv-formats ^3`. They must be imported only from `src/json-schema.ts`, `src/manifest.ts`, `src/remote.ts` (never from `src/index.ts`'s transitive graph).
- Wire compatibility: a remote kit registered with `registerKit` must produce the same `tools/list` entries (`inputSchema`, `outputSchema`, `_meta.ui`) and the same success/error results as the local kit it proxies.
- No network in tests. The end-to-end test wires local kit → `createHttpHandler` → `createRemoteKit` → `registerKit` → real SDK 2 `Client` over `InMemoryTransport`.
- Lint conventions as in C1: no `any`; no-`await` async functions become plain functions returning `Promise.resolve(...)`; explicit `| undefined`; `only-throw-error`.
- The kit carries no model identifiers.
- Root gate before every commit: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- Branch `feature/remote-kit`, commit per task with trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, PR to `main`; after merge tag `chat-kit-v0.2.0` (and `chat-kit-app-v0.2.0` only if Task 5 touches it — it does not; leave the app at 0.1.0).

## Review Focus

1. A manifest input schema with `default` values (zod `.default()`): the SDK validates raw args against the JSON Schema; the API re-parses with zod and applies defaults. The wrapper must validate without applying defaults and must not reject a missing defaulted field. Test in Task 1 (`limit` defaulted).
2. A non-2xx HTTP body that is not `{ error: {...} }` (proxy HTML, empty body) → `INTERNAL`, never a throw of a non-ChatKitError. Test in Task 3.
3. Bearer token absent (`auth` undefined) → `httpKitCall` sends no `Authorization` header and the API answers 401 → remote kit throws `UNAUTHENTICATED`. Test in Task 3.
4. `X-Kit-Text` header missing or malformed base64 → describe falls back to `describeEnvelope`, no throw. Test in Task 3.
5. The JSON Schema for the envelope contains a branded ISO date string; `z.toJSONSchema` must not throw on the brand and Ajv must accept `format: date-time`. Test in Task 1.

---

## File Structure

```
packages/chat-kit/
├── package.json                 # 0.2.0, ./remote export, ajv + ajv-formats deps
├── tsup.config.ts               # + src/remote.ts entry
└── src/
    ├── json-schema.ts           # jsonSchemaStandard(schema): StandardSchemaWithJSON via Ajv
    ├── manifest.ts              # KitManifest types, manifestOf(kit)
    ├── remote.ts                # createRemoteKit, httpKitCall, RemoteCall  (subpath ./remote)
    ├── http.ts                  # + text on success
    ├── index.ts                 # + export * from './manifest'
    └── __tests__/
        ├── json-schema.test.ts
        ├── manifest.test.ts
        ├── http.test.ts         # + text assertion
        ├── remote.test.ts       # unit: mocked call, error mapping, httpKitCall with fake fetch
        └── remote.mcp.test.ts   # end-to-end over InMemoryTransport
docs/design/chat-kit.md          # §5.4 Remote kit
packages/chat-kit/README.md      # Remote row + example
```

---

### Task 1: JSON Schema Standard Schema wrapper and `manifestOf`

**Files:**
- Create: `packages/chat-kit/src/json-schema.ts`, `packages/chat-kit/src/manifest.ts`
- Modify: `packages/chat-kit/package.json` (deps, version), `packages/chat-kit/src/index.ts`
- Test: `packages/chat-kit/src/__tests__/json-schema.test.ts`, `packages/chat-kit/src/__tests__/manifest.test.ts`

**Interfaces:**
- Consumes: `Kit`, `CapabilityInfo` (Task 3 of C1), zod 4's `z.toJSONSchema`.
- Produces: `jsonSchemaStandard(schema: Record<string, unknown>): StandardJsonSchema` where `StandardJsonSchema = { '~standard': { version: 1; vendor: 'apogee-chat-kit'; validate(value: unknown): { value: unknown } | { issues: { message: string; path?: (string|number)[] }[] }; jsonSchema: { input(): Record<string, unknown>; output(): Record<string, unknown> } } }`; `CapabilityManifestEntry`, `KitManifest`, `manifestOf(kit): KitManifest`.

- [ ] **Step 1: Add dependencies and bump the version**

In `packages/chat-kit/package.json`: `"version": "0.2.0"`; add to `dependencies`: `"ajv": "^8.17.0"`, `"ajv-formats": "^3.0.1"`. Run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

`packages/chat-kit/src/__tests__/json-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaStandard } from '../json-schema';
import { envelopeSchema } from '../contract';

const Input = z.object({ id: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) });

describe('jsonSchemaStandard', () => {
  it('validates against the JSON Schema and returns the raw value', () => {
    const schema = z.toJSONSchema(Input, { target: 'draft-2020-12', io: 'input' });
    const std = jsonSchemaStandard(schema);
    expect(std['~standard'].vendor).toBe('apogee-chat-kit');
    expect(std['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual(schema);
    expect(std['~standard'].validate({ id: 't1' })).toEqual({ value: { id: 't1' } });       // defaulted field may be absent
    const bad = std['~standard'].validate({ id: '', limit: 99 });
    expect('issues' in bad && bad.issues.length).toBeGreaterThanOrEqual(2);
    expect('issues' in bad && bad.issues.map((i) => i.path?.join('.'))).toEqual(expect.arrayContaining(['id', 'limit']));
  });
  it('accepts the envelope schema with its branded ISO date and date-time format', () => {
    const schema = z.toJSONSchema(envelopeSchema(z.object({ title: z.string() })), { target: 'draft-2020-12', io: 'output' });
    const std = jsonSchemaStandard(schema);
    const ok = std['~standard'].validate({ resource: 'ticket', id: 't1', state: 'open', data: { title: 'x' }, allowed_next_actions: [], at: '2026-09-28T00:00:00.000Z' });
    expect('value' in ok).toBe(true);
    const bad = std['~standard'].validate({ resource: 'ticket', id: 't1', state: 'open', data: { title: 'x' }, allowed_next_actions: [], at: 'yesterday' });
    expect('issues' in bad).toBe(true);
  });
});
```

`packages/chat-kit/src/__tests__/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

const kit = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => Promise.resolve({ user: a?.token ?? 'ann', admin: false }),
});

describe('manifestOf', () => {
  it('lists every capability with JSON Schemas and ui', () => {
    const m = manifestOf(kit);
    expect(m.version).toBe(1);
    const triage = m.capabilities.find((c) => c.name === 'ticket_triage')!;
    expect(triage).toMatchObject({ title: 'Triage', resource: 'ticket', ui: 'ui://test/ticket.html' });
    expect(triage.input_schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'assignee']) });
    expect(triage.output_schema).toMatchObject({ type: 'object', required: expect.arrayContaining(['resource', 'state', 'data']) });
    expect(m.capabilities.map((c) => c.name)).toEqual(kit.list().map((c) => c.name));
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);   // JSON-safe
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @de_canter/apogee-chat-kit test -- json-schema manifest`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`packages/chat-kit/src/json-schema.ts`:

```ts
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export interface StandardIssue { message: string; path?: (string | number)[] | undefined }
export type StandardResult = { value: unknown } | { issues: StandardIssue[] };

/** The Standard Schema (+ JSON Schema) shape SDK 2 accepts for tool input/output. */
export interface StandardJsonSchema {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: 'apogee-chat-kit';
    readonly validate: (value: unknown) => StandardResult;
    readonly jsonSchema: {
      readonly input: (options: { target: string }) => Record<string, unknown>;
      readonly output: (options: { target: string }) => Record<string, unknown>;
    };
  };
  /** The raw schema, for hosts that want it. */
  readonly jsonSchema: Record<string, unknown>;
}

let ajv: Ajv2020 | undefined;
function engine(): Ajv2020 {
  if (!ajv) {
    ajv = new Ajv2020({ allErrors: true, strict: false, useDefaults: false });
    addFormats(ajv);
  }
  return ajv;
}

/** Wraps a JSON Schema (draft 2020-12) as a Standard Schema that validates with Ajv and advertises itself as JSON Schema. */
export function jsonSchemaStandard(schema: Record<string, unknown>): StandardJsonSchema {
  const validator: ValidateFunction = engine().compile(schema);
  const validate = (value: unknown): StandardResult => {
    if (validator(value)) return { value };
    const issues: StandardIssue[] = (validator.errors ?? []).map((e) => ({
      message: e.message ?? 'invalid',
      path: e.instancePath ? e.instancePath.split('/').slice(1).map((s) => (/^\d+$/.test(s) ? Number(s) : s)) : undefined,
    }));
    return { issues };
  };
  return {
    '~standard': {
      version: 1,
      vendor: 'apogee-chat-kit',
      validate,
      jsonSchema: { input: () => schema, output: () => schema },
    },
    jsonSchema: schema,
  };
}
```

`packages/chat-kit/src/manifest.ts`:

```ts
import { z } from 'zod';
import type { Kit } from './kit';

export interface CapabilityManifestEntry {
  name: string;
  title: string;
  description: string;
  resource: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  ui?: string | undefined;
}

export interface KitManifest { version: 1; capabilities: CapabilityManifestEntry[] }

/** Serializes a kit's capabilities to JSON Schema so an edge can register them without the zod schemas. */
export function manifestOf(kit: Kit): KitManifest {
  return {
    version: 1,
    capabilities: kit.list().map((c) => {
      const entry: CapabilityManifestEntry = {
        name: c.name,
        title: c.title,
        description: c.description,
        resource: c.resource,
        input_schema: z.toJSONSchema(c.input, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }),
        output_schema: z.toJSONSchema(c.output, { target: 'draft-2020-12', io: 'output', unrepresentable: 'any' }),
      };
      if (c.ui !== undefined) entry.ui = c.ui;
      return entry;
    }),
  };
}
```

Add `export * from './manifest';` to `src/index.ts` (not `json-schema`; it is re-exported from `./remote`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @de_canter/apogee-chat-kit test`
Expected: PASS. If `ajv/dist/2020.js` has no named `Ajv2020` export under the ESM/CJS dual build, import the default (`import Ajv2020 from 'ajv/dist/2020.js'`) and keep the class usage; if `z.toJSONSchema` rejects the branded ISO date without `unrepresentable: 'any'`, keep that option (already set) and add `override` only if the test still fails, documenting why.

- [ ] **Step 6: Root gate and commit**

```bash
git add packages/chat-kit pnpm-lock.yaml
git commit -m "feat(chat-kit): manifestOf and JSON Schema standard-schema wrapper"
```

---

### Task 2: `text` on successful HTTP results

**Files:**
- Modify: `packages/chat-kit/src/http.ts`
- Test: `packages/chat-kit/src/__tests__/http.test.ts`

**Interfaces:**
- Produces: `HttpResult { status: number; body: unknown; text?: string | undefined }` — `text = kit.describe(capability, result)` on 2xx, absent on errors.

- [ ] **Step 1: Add the failing assertion**

In `http.test.ts`'s "200 with the envelope" test add: `expect(JSON.parse(r.text ?? '')).toMatchObject({ resource: 'ticket', id: 't1' });` and in one error case `expect(r.text).toBeUndefined();`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @de_canter/apogee-chat-kit test -- http` — Expected: FAIL (`text` undefined).

- [ ] **Step 3: Implement**

In `http.ts`, success branch: `const body = await kit.call(...); return { status: 200, body, text: kit.describe(call.capability, body) };` (wrap `describe` in try/catch falling back to `describeEnvelope(body)`, as the MCP projection does). Update the `HttpResult` interface.

- [ ] **Step 4: Run to verify it passes, root gate, commit**

```bash
git add packages/chat-kit
git commit -m "feat(chat-kit): HTTP results carry the describe text"
```

---

### Task 3: `createRemoteKit` and `httpKitCall`

**Files:**
- Create: `packages/chat-kit/src/remote.ts`
- Modify: `packages/chat-kit/tsup.config.ts` (entry), `packages/chat-kit/package.json` (`./remote` export)
- Test: `packages/chat-kit/src/__tests__/remote.test.ts`

**Interfaces:**
- Consumes: `KitManifest`, `jsonSchemaStandard`, `Kit`, `CapabilityInfo`, `ChatKitError`, `AuthInfo`, `describeEnvelope`, `AnyEnvelopeSchema`, `AnyListEnvelopeSchema`.
- Produces: `RemoteCallResult { status: number; body: unknown; text?: string | undefined }`; `RemoteCall = (capability: string, args: unknown, auth: AuthInfo | undefined) => Promise<RemoteCallResult>`; `createRemoteKit({ manifest, call }): Kit`; `httpKitCall({ baseUrl, headers?, fetch? }): RemoteCall`; `KIT_TEXT_HEADER = 'x-kit-text'` (value: base64url of UTF-8 text); re-export `jsonSchemaStandard`.

- [ ] **Step 1: Write the failing tests**

`packages/chat-kit/src/__tests__/remote.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createHttpHandler } from '../http';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { createRemoteKit, httpKitCall, KIT_TEXT_HEADER, type RemoteCall } from '../remote';
import { ChatKitError } from '../errors';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

const local = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
});
const handle = createHttpHandler(local);
const viaHttp: RemoteCall = (capability, args, auth) => handle({ capability, args, auth });
const manifest = manifestOf(local);

describe('createRemoteKit', () => {
  it('lists capabilities with Standard Schemas built from the manifest', () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    expect(remote.list().map((c) => c.name)).toEqual(local.list().map((c) => c.name));
    const triage = remote.get('ticket_triage')!;
    expect(triage.ui).toBe('ui://test/ticket.html');
    const std = (triage.input as unknown as { '~standard': { validate(v: unknown): unknown } })['~standard'];
    expect(std.validate({ id: 't1', assignee: 'bob' })).toEqual({ value: { id: 't1', assignee: 'bob' } });
    expect('issues' in (std.validate({ id: 't1' }) as object)).toBe(true);
  });
  it('proxies a call and returns the envelope', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    const e = await remote.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(e).toMatchObject({ resource: 'ticket', id: 't1', state: 'open' });
  });
  it('rethrows the API error with its code and allowed actions', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    const err = await remote.call('ticket_triage', { id: 't2', assignee: 'b' }, { token: 'ann' }).catch((e: unknown) => e);
    expect(ChatKitError.is(err) && err.code).toBe('ILLEGAL_TRANSITION');
    expect((err as ChatKitError).allowed_next_actions?.map((a) => a.capability)).toEqual(['ticket_note']);
    await expect(remote.call('ticket_get', { id: 't1' }, undefined)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(remote.call('nope', {}, { token: 'ann' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('maps a non-error non-2xx body and a non-envelope 2xx body to INTERNAL', async () => {
    const remote = createRemoteKit({ manifest, call: () => Promise.resolve({ status: 502, body: '<html>bad gateway</html>' }) });
    await expect(remote.call('ticket_get', { id: 't1' }, { token: 'ann' })).rejects.toMatchObject({ code: 'INTERNAL' });
    const remote2 = createRemoteKit({ manifest, call: () => Promise.resolve({ status: 200, body: { nope: true } }) });
    await expect(remote2.call('ticket_get', { id: 't1' }, { token: 'ann' })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
  it('describe uses the transported text and falls back to describeEnvelope', async () => {
    const remote = createRemoteKit({ manifest, call: viaHttp });
    const e = await remote.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(JSON.parse(remote.describe('ticket_get', e))).toMatchObject({ id: 't1', next: expect.any(Array) });
    const custom = createRemoteKit({ manifest, call: (c, a, auth) => handle({ capability: c, args: a, auth }).then((r) => ({ ...r, text: 'server says hi' })) });
    const e2 = await custom.call('ticket_get', { id: 't1' }, { token: 'ann' });
    expect(custom.describe('ticket_get', e2)).toBe('server says hi');
  });
});

describe('httpKitCall', () => {
  it('posts JSON with the bearer token and static headers, and decodes the text header', async () => {
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe('https://api.example.com/api/v1/kit/ticket_get');
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
      expect((init.headers as Record<string, string>)['x-edge']).toBe('s3cret');
      expect(init.body).toBe(JSON.stringify({ id: 't1' }));
      const text = Buffer.from('hello', 'utf8').toString('base64url');
      return Promise.resolve(new Response(JSON.stringify({ resource: 'ticket' }), { status: 200, headers: { 'content-type': 'application/json', [KIT_TEXT_HEADER]: text } }));
    });
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', headers: { 'x-edge': 's3cret' }, fetch: fetchMock as unknown as typeof fetch });
    const r = await call('ticket_get', { id: 't1' }, { token: 'tok' });
    expect(r).toEqual({ status: 200, body: { resource: 'ticket' }, text: 'hello' });
  });
  it('omits Authorization without a token, tolerates a bad text header and a non-JSON body', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      expect('authorization' in (init.headers as Record<string, string>)).toBe(false);
      return Promise.resolve(new Response('nope', { status: 401, headers: { [KIT_TEXT_HEADER]: '%%%' } }));
    });
    const call = httpKitCall({ baseUrl: 'https://api.example.com/api/v1/kit', fetch: fetchMock as unknown as typeof fetch });
    const r = await call('ticket_get', { id: 't1' }, undefined);
    expect(r.status).toBe(401);
    expect(r.body).toBe('nope');
    expect(r.text).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @de_canter/apogee-chat-kit test -- remote` — Expected: FAIL, `../remote` not found.

- [ ] **Step 3: Implement**

`packages/chat-kit/src/remote.ts`:

```ts
import type { z } from 'zod';
import type { CapabilityInfo } from './capability';
import { AnyEnvelopeSchema, AnyListEnvelopeSchema, describeEnvelope, type Envelope, type ListEnvelope } from './contract';
import { ChatKitError, CHAT_KIT_ERROR_CODES, type ChatKitErrorCode } from './errors';
import { jsonSchemaStandard } from './json-schema';
import type { Kit } from './kit';
import type { CapabilityManifestEntry, KitManifest } from './manifest';
import type { AuthInfo } from './ports';

export { jsonSchemaStandard } from './json-schema';
export type { KitManifest, CapabilityManifestEntry } from './manifest';

export const KIT_TEXT_HEADER = 'x-kit-text';

export interface RemoteCallResult { status: number; body: unknown; text?: string | undefined }
export type RemoteCall = (capability: string, args: unknown, auth: AuthInfo | undefined) => Promise<RemoteCallResult>;

export interface RemoteKitOptions { manifest: KitManifest; call: RemoteCall }

function isCode(v: unknown): v is ChatKitErrorCode {
  return typeof v === 'string' && (CHAT_KIT_ERROR_CODES as readonly string[]).includes(v);
}

function toError(status: number, body: unknown): ChatKitError {
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown; allowed_next_actions?: unknown } } | null)?.error;
  if (err && isCode(err.code) && typeof err.message === 'string') {
    const opts: { details?: unknown; allowed_next_actions?: Envelope['allowed_next_actions'] | undefined } = {};
    if (err.details !== undefined) opts.details = err.details;
    if (Array.isArray(err.allowed_next_actions)) opts.allowed_next_actions = err.allowed_next_actions as Envelope['allowed_next_actions'];
    return new ChatKitError(err.code, err.message, opts);
  }
  if (status === 401) return new ChatKitError('UNAUTHENTICATED', 'Not authenticated');
  if (status === 404) return new ChatKitError('NOT_FOUND', 'Not found');
  return new ChatKitError('INTERNAL', `Remote kit returned ${status}`);
}

/** A Kit whose capabilities live behind HTTP: schemas from the manifest, calls forwarded, errors rethrown with their codes. */
export function createRemoteKit(opts: RemoteKitOptions): Kit {
  const texts = new WeakMap<object, string>();
  const infos = new Map<string, CapabilityInfo>();
  for (const c of opts.manifest.capabilities) {
    const info: CapabilityInfo = {
      name: c.name, title: c.title, description: c.description, resource: c.resource,
      input: jsonSchemaStandard(c.input_schema) as unknown as z.ZodType,
      output: jsonSchemaStandard(c.output_schema) as unknown as z.ZodType,
      ui: c.ui,
    };
    infos.set(c.name, info);
  }
  return {
    list: () => [...infos.values()],
    get: (name) => infos.get(name),
    describe: (_name, result) => texts.get(result) ?? describeEnvelope(result),
    async call(name, args, auth) {
      if (!infos.has(name)) throw new ChatKitError('NOT_FOUND', `Unknown capability ${name}`);
      const r = await opts.call(name, args, auth);
      if (r.status < 200 || r.status >= 300) throw toError(r.status, r.body);
      const single = AnyEnvelopeSchema.safeParse(r.body);
      const parsed: Envelope | ListEnvelope | undefined = single.success ? single.data : (AnyListEnvelopeSchema.safeParse(r.body).data as ListEnvelope | undefined);
      if (!parsed) throw new ChatKitError('INTERNAL', 'Remote kit returned a non-envelope body');
      if (r.text !== undefined) texts.set(parsed, r.text);
      return parsed;
    },
  };
}

export interface HttpKitCallOptions {
  /** e.g. https://api.example.com/api/v1/kit — the capability name is appended as a path segment */
  baseUrl: string;
  headers?: Record<string, string> | undefined;
  fetch?: typeof fetch | undefined;
}

function decodeText(header: string | null): string | undefined {
  if (!header) return undefined;
  try {
    return Buffer.from(header, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}

/** The default RemoteCall: JSON POST with the caller's bearer token and any static headers (an edge secret, say). */
export function httpKitCall(opts: HttpKitCallOptions): RemoteCall {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  return async (capability, args, auth) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', ...(opts.headers ?? {}) };
    if (auth?.token) headers['authorization'] = `Bearer ${auth.token}`;
    const res = await f(`${base}/${encodeURIComponent(capability)}`, { method: 'POST', headers, body: JSON.stringify(args ?? {}) });
    const raw = await res.text();
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* keep the raw text */ }
    const text = decodeText(res.headers.get(KIT_TEXT_HEADER));
    const out: RemoteCallResult = { status: res.status, body };
    if (text !== undefined && /^[A-Za-z0-9_-]+$/.test(res.headers.get(KIT_TEXT_HEADER) ?? '')) out.text = text;
    return out;
  };
}
```

Add `'src/remote.ts'` to the tsup `entry`; add to `package.json` `exports`: `"./remote": { "types": "./dist/remote.d.ts", "import": "./dist/remote.js", "require": "./dist/remote.cjs" }`.

Note on the `as unknown as z.ZodType` casts: `CapabilityInfo.input/output` are typed as zod for local kits; the MCP projection passes them straight to `registerAppTool`, which accepts any `StandardSchemaWithJSON`. Widen `CapabilityInfo.input/output` to `z.ZodType | StandardJsonSchema` instead of casting if the type change stays contained (kit.ts, mcp.ts, agent.ts compile); `toAgentTools` must then reject a remote kit's capability whose `input` is not a zod schema with a clear `Error('toAgentTools needs a local kit')`, tested.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @de_canter/apogee-chat-kit test` — Expected: PASS.

- [ ] **Step 5: Root gate and commit**

```bash
git add packages/chat-kit
git commit -m "feat(chat-kit): createRemoteKit and httpKitCall (./remote)"
```

---

### Task 4: End-to-end over a real SDK 2 server

**Files:**
- Test: `packages/chat-kit/src/__tests__/remote.mcp.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { createHttpHandler } from '../http';
import { createKit } from '../kit';
import { manifestOf } from '../manifest';
import { registerKit } from '../mcp';
import { createRemoteKit } from '../remote';
import { AnyEnvelopeSchema } from '../contract';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

async function harness() {
  const local = createKit<ReturnType<typeof makeCtx>, Principal>({
    resources: [ticket], ctx: makeCtx(structuredClone(seed)),
    principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
  });
  const handle = createHttpHandler(local);
  const remote = createRemoteKit({ manifest: manifestOf(local), call: (c, a, auth) => handle({ capability: c, args: a, auth }) });
  const server = new McpServer({ name: 'edge', version: '0.0.0' });
  registerKit(server, remote, { auth: () => ({ token: 'ann' }) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'harness', version: '0.0.0' });
  await server.connect(st);
  await client.connect(ct);
  return { client, local };
}

describe('remote kit through a real SDK 2 server', () => {
  it('advertises the manifest schemas and ui', async () => {
    const { client } = await harness();
    const { tools } = await client.listTools();
    const triage = tools.find((t) => t.name === 'ticket_triage')!;
    expect(triage.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'assignee']) });
    expect(triage.outputSchema).toMatchObject({ type: 'object' });
    expect(triage._meta?.ui).toEqual({ resourceUri: 'ui://test/ticket.html' });
  });
  it('rejects bad arguments at the SDK before the call reaches the API', async () => {
    const { client } = await harness();
    await client.listTools();
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't1' } }).catch((e: unknown) => e);
    const failed = (res instanceof Error) || (typeof res === 'object' && res !== null && (res as { isError?: boolean }).isError === true);
    expect(failed).toBe(true);
  });
  it('returns the envelope with the same structuredContent and text as a local kit', async () => {
    const { client } = await harness();
    await client.listTools();
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't1', assignee: 'bob' } });
    expect(res.isError).toBeFalsy();
    expect(AnyEnvelopeSchema.parse(res.structuredContent)).toMatchObject({ state: 'triaged' });
    expect(JSON.parse((res.content as Array<{ text?: string }>)[0]?.text ?? '')).toMatchObject({ state: 'triaged' });
  });
  it('carries error codes and allowed actions back through isError results', async () => {
    const { client } = await harness();
    const res = await client.callTool({ name: 'ticket_triage', arguments: { id: 't2', assignee: 'bob' } });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ error: { code: 'ILLEGAL_TRANSITION' } });
    expect((res.content as Array<{ text?: string }>)[0]?.text).toContain('Allowed next: ticket_note');
  });
});
```

- [ ] **Step 2: Run, fix, root gate, commit**

Run: `pnpm --filter @de_canter/apogee-chat-kit test -- remote.mcp` — Expected: PASS. If the SDK does not validate arguments client-side for a JSON-Schema tool, the second test's server-side validation still yields `isError` (the kit re-parses); either outcome satisfies the assertion.

```bash
git add packages/chat-kit
git commit -m "test(chat-kit): remote kit end to end over SDK 2"
```

---

### Task 5: Docs, spec §5.4, release

**Files:**
- Modify: `packages/chat-kit/README.md` (Remote row in the surface table + a "Edge MCP proxies, product API rules" example), `docs/design/chat-kit.md` (§3 package map: `./remote`; new §5.4 Remote kit: manifest, remote kit, `X-Kit-Text`, error passthrough; §5.3 `text`), `docs/consuming.md` (no change), `docs/TODO.md` (queue item 9: C2 done pending merge/tag).

- [ ] **Step 1: Write the docs** (README example: `const remote = createRemoteKit({ manifest, call: httpKitCall({ baseUrl, headers: { 'x-edge-key': secret } }) }); registerKit(server, remote, { fragments })`).
- [ ] **Step 2: Acceptance:** root gate green; `pnpm --filter @de_canter/apogee-chat-kit exec vitest run --coverage` ≥ 95% lines; the model-name grep over `packages/chat-kit/src` prints nothing.
- [ ] **Step 3: Commit, push `feature/remote-kit`, open the PR to `main`** (separate commands). After merge: tag `chat-kit-v0.2.0`, confirm the release tarball and `npm view @de_canter/apogee-chat-kit version` = 0.2.0, file this plan under `docs/plans/completed/`.
