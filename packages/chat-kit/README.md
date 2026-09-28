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

## Guarantees

- A transition whose `from` does not include the current state fails before `execute` with `ILLEGAL_TRANSITION` and the actions that are allowed.
- `entitlement.assert` runs after the lifecycle check and before `execute`; `settle` runs after, with `success`, even when `execute` throws; a throwing `settle` never fails the call.
- `execute` results are checked against the declared target states and the view schema; a mismatch is `INTERNAL`, never a protocol error.
- Definition-time validation against the kernel lifecycle: unknown states, illegal pairs, reserved or colliding names, and inputs that declare `id` all throw at startup.
- The kit carries no model identifiers and never imports a model client.

## Example

```ts
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
