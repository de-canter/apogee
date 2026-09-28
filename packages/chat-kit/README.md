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
| HTTP | `createHttpHandler(kit)` from `./http` | `{ status, body }`; 409/404/400/401/403/402/500 |
| Remote | `createRemoteKit({ manifest, call })`, `httpKitCall({ baseUrl, headers?, fetch? })` from `./remote`; `manifestOf(kit)` from the root | a `Kit` whose capabilities live behind HTTP, built from a JSON Schema manifest instead of zod; `KIT_TEXT_HEADER` (`x-kit-text`) carries the model-facing text as a base64url response header |

## Guarantees

- A transition whose `from` does not include the current state, or whose `when` is false, fails before `execute` with `ILLEGAL_TRANSITION` and the actions that are allowed; a query whose `when` is false fails the same way. A transition the resource `policy` refuses fails with `FORBIDDEN` and the allowed actions.
- `entitlement.assert` runs after the lifecycle check and before `execute` (for `get`, before the load); `settle` runs after, with `success`, even when `execute` throws; a throwing `settle` never fails the call.
- `ChatKitError.is()` is a brand check, so errors are recognized across the separately bundled entry points and across ESM/CJS copies.
- MCP error text names the allowed next capabilities (`Allowed next: …`), since `structuredContent` is UI-only for the model.
- `execute` results are checked against the declared target states and the view schema; a mismatch is `INTERNAL`, never a protocol error.
- Definition-time validation against the kernel lifecycle: unknown states, illegal pairs, reserved or colliding names, and inputs that declare `id` all throw at startup.
- The kit carries no model identifiers and never imports a model client.
- A remote kit (`createRemoteKit`) produces the same `tools/list` entries and the same success/error results as the local kit it proxies; errors keep their code and allowed actions.

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
// product API
import { manifestOf } from '@de_canter/apogee-chat-kit';
import { createHttpHandler } from '@de_canter/apogee-chat-kit/http';
import { KIT_TEXT_HEADER } from '@de_canter/apogee-chat-kit/remote';

const kit = createKit({ resources: [scan], ctx, principal: resolveClerkPrincipal, entitlement: billingPort });
const handleKitCall = createHttpHandler(kit);

app.get('/api/v1/kit/manifest', (req, res) => res.json(manifestOf(kit)));
app.post('/api/v1/kit/:capability', async (req, res) => {
  const result = await handleKitCall({ capability: req.params.capability, args: req.body, auth: req.authInfo });
  if (result.text !== undefined) res.setHeader(KIT_TEXT_HEADER, Buffer.from(result.text, 'utf8').toString('base64url'));
  res.status(result.status).json(result.body);
});
```

The edge side has no zod schemas and no domain types — it fetches the manifest once and rebuilds a `Kit` that forwards every call:

```ts
// edge MCP
import { createRemoteKit, httpKitCall } from '@de_canter/apogee-chat-kit/remote';
import { registerKit } from '@de_canter/apogee-chat-kit/mcp';

const manifest = await fetch(`${baseUrl}/api/v1/kit/manifest`).then((r) => r.json());
const remote = createRemoteKit({
  manifest,
  call: httpKitCall({ baseUrl: `${baseUrl}/api/v1/kit`, headers: { 'x-edge-key': secret } }),
});
registerKit(server, remote, { fragments });
```

`toAgentTools` requires a local kit (it needs zod input schemas to build agent tool definitions); it throws if handed a remote kit's capabilities.
