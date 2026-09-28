# @de_canter/apogee-chat-kit

One resource declaration becomes MCP tools with structured output and linked MCP Apps fragments, `apogee-agent` tools, and an HTTP handler, all returning one envelope `{ state, allowed_next_actions, ui? }` and all running the same pipeline: parse, load, lifecycle check, entitlement assert, execute, target-state check, entitlement settle, envelope. Spec: `docs/design/chat-kit.md`.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Envelope | `Envelope`, `ListEnvelope`, `ActionDescriptor`, `envelopeSchema(view)`, `describeEnvelope` | what every capability returns; `allowed_next_actions` is derived from the lifecycle for resource capabilities, supplied by `execute` for standalone capabilities |
| Errors | `ChatKitError`, `STATUS_BY_CODE` | one class, seven codes; `ILLEGAL_TRANSITION` carries `{ from, attempted, allowed }` |
| Ports | `PrincipalResolver`, `EntitlementPort`, `allowAll` | who is calling; whether they may; charge on success |
| Resource | `defineResource({ name, lifecycle, view, load, create?, list?, transitions, queries?, policy?, describe?, ui? })` | generates `<name>_get/_list/_create/_<transition>/_<query>`; out-of-order calls are rejected before `execute` |
| Standalone | `defineCapability({ name, title, input, view, execute })` | an aggregate that is not a lifecycle object |
| Kit | `createKit({ resources, capabilities?, ctx, principal, entitlement?, onError? })` → `call(name, args, auth)` | the one pipeline |
| MCP | `registerKit(server, kit, { fragments })` from `./mcp` | SDK 2 `registerAppTool` with `outputSchema` + `_meta.ui`; fragments as `ui://` resources |
| Agent | `toAgentTools(kit, { auth })` from `./agent` | `apogee-agent` tools; envelope in `data` and as an artifact typed by resource |
| HTTP | `createHttpHandler(kit)`, `wantsWrap(headers)`, `KIT_WRAP_HEADER` from `./http` | `{ status, body, text? }`; 409/404/400/401/403/402/500; `body` is the envelope, or `{ envelope, text }` when the call sets `wrap: true` (a remote kit asks with `x-kit-wrap: 1`) |
| Remote | `createRemoteKit({ manifest, call })`, `httpKitCall({ baseUrl, headers?, fetch?, timeoutMs? })`, `KitManifestSchema`, `jsonSchemaStandard`, `StandardJsonSchema`/`StandardResult`/`StandardIssue` from `./remote`; `manifestOf(kit)` from the root | a `Kit` whose capabilities live behind HTTP, built from a JSON Schema manifest instead of zod; the model-facing text rides in the wrapped `{ envelope, text }` body. **Node runtime only** (Ajv compiles validators with `new Function`; not Edge Runtime or Workers) |

## Guarantees

- A transition whose `from` does not include the current state, or whose `when` is false, fails before `execute` with `ILLEGAL_TRANSITION` and the actions that are allowed; a query whose `when` is false fails the same way. A transition the resource `policy` refuses fails with `FORBIDDEN` and the allowed actions.
- `entitlement.assert` runs after the lifecycle check and before `execute` (for `get`, before the load); `settle` runs after, with `success`, even when `execute` throws; a throwing `settle` never fails the call.
- `ChatKitError.is()` is a brand check, so errors are recognized across the separately bundled entry points and across ESM/CJS copies.
- MCP error text names the allowed next capabilities (`Allowed next: …`), since `structuredContent` is UI-only for the model.
- `execute` results are checked against the declared target states and the view schema; a mismatch is `INTERNAL`, never a protocol error.
- Definition-time validation against the kernel lifecycle: unknown states, illegal pairs, reserved or colliding names, and inputs that declare `id` all throw at startup.
- The kit carries no model identifiers and never imports a model client.
- A remote kit (`createRemoteKit`) advertises the same schemas and returns the same envelopes as the local kit it proxies; errors keep their code and allowed actions. Edge-side validation messages may differ (Ajv, not zod), and refinements are enforced by the API, not the edge (spec §5.4 lists the divergences).

## Example

```ts
import { z } from 'zod';
import { defineLifecycle } from '@de_canter/apogee-kernel';
import { createKit, defineResource } from '@de_canter/apogee-chat-kit';
import { registerKit } from '@de_canter/apogee-chat-kit/mcp';

const scan = defineResource<Ctx, Principal, ScanView, ScanState>({
  name: 'scan',
  lifecycle: defineLifecycle({ states: ['queued', 'processing', 'ready', 'reviewed', 'failed'], initial: 'queued', terminal: ['failed'],
    transitions: [{ name: 'start', from: 'queued', to: 'processing' }, { name: 'finish', from: 'processing', to: 'ready' },
      { name: 'fail', from: 'processing', to: 'failed' }, { name: 'review', from: ['ready', 'reviewed'], to: 'reviewed' }] }),
  view: ScanView,
  load: (id, { ctx, principal }) => ctx.scans.load(principal.householdId, id),
  transitions: {
    review: { from: ['ready', 'reviewed'], to: 'reviewed', input: z.object({ note: z.string() }), title: 'Get the picks',
      execute: async (input: { note: string }, { ctx, id, current }) => ctx.scans.review(id, input.note, current) },
  },
  queries: { refresh: { input: z.object({}), title: 'Refresh', intent: 'poll', when: (c) => c.state === 'processing', execute: async (_i, { current }) => ({ view: current.view }) } },
  ui: { get: 'ui://product/scan-card.html' },
});

const kit = createKit({ resources: [scan], ctx, principal: resolveClerkPrincipal, entitlement: billingPort });
registerKit(server, kit, { fragments: [{ uri: 'ui://product/scan-card.html', name: 'Scan card', html: scanCardHtml, prefersBorder: false }] });
```

## Edge MCP proxies, product API rules

Split the kit across two processes: the product API owns the kit (lifecycle, entitlement, storage) and answers a fragment's `tools/call`; an edge MCP server holds no domain code and just forwards. The API side serves the manifest and an HTTP handler:

```ts
// product API (Fastify)
import { createKit, manifestOf } from '@de_canter/apogee-chat-kit';
import { createHttpHandler, wantsWrap } from '@de_canter/apogee-chat-kit/http';

const kit = createKit({ resources: [scan], ctx, principal: resolveClerkPrincipal, entitlement: billingPort });
const handle = createHttpHandler(kit);

app.get('/api/v1/kit/manifest', () => manifestOf(kit));
app.post('/api/v1/kit/:capability', async (request, reply) => {
  const { capability } = request.params as { capability: string };
  const r = await handle({ capability, args: request.body, auth: request.authInfo, wrap: wantsWrap(request.headers) });
  reply.code(r.status).send(r.body);
});
```

A remote kit sends `x-kit-wrap: 1`, so its success bodies come back as `{ envelope, text }` and `describe()` returns the API's own text; any other client (the fragment runtime's `httpTransport`, a PWA) sends no header and keeps getting the bare envelope. A host that ignores the header still works — the remote kit falls back to `describeEnvelope`.

The edge side has no zod schemas and no domain types — it fetches the manifest once and rebuilds a `Kit` that forwards every call:

```ts
// edge MCP
import { createRemoteKit, httpKitCall, type KitManifest } from '@de_canter/apogee-chat-kit/remote';
import { registerKit } from '@de_canter/apogee-chat-kit/mcp';

const res = await fetch(`${baseUrl}/api/v1/kit/manifest`, { headers: { 'x-edge-key': secret } });
if (!res.ok) throw new Error(`kit manifest: ${res.status}`);
const manifest = (await res.json()) as KitManifest;   // createRemoteKit validates it (KitManifestSchema) and throws on anything else
const remote = createRemoteKit({
  manifest,
  call: httpKitCall({ baseUrl: `${baseUrl}/api/v1/kit`, headers: { 'x-edge-key': secret }, timeoutMs: 30_000 }),
});
registerKit(server, remote, { fragments });
```

`toAgentTools` requires a local kit (it needs zod input schemas to build agent tool definitions); it throws if handed a remote kit's capabilities.

The remote kit maps a non-envelope error body by status (400 `INVALID_INPUT`, 401 `UNAUTHENTICATED`, 402 `ENTITLEMENT`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, else `INTERNAL`); a call past `timeoutMs` fails with `INTERNAL` `Remote kit call timed out after <n>ms`.
