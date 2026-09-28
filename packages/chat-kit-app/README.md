# @de_canter/apogee-chat-kit-app

The client half of the chat kit: render an envelope from `@de_canter/apogee-chat-kit` inside an MCP Apps host or inside the product's own app, act through tools, and keep the model informed. One React card, two transports. Spec: `docs/design/chat-kit.md` §6.

| Concept | Import | One-liner |
|---|---|---|
| Runtime | `createFragment({ name, version, render, view?, theme?, app? })` → `{ connect(), destroy(), app }` | wraps the ext-apps `App`; tool results become envelopes; `act()` calls the tool, re-renders, updates model context |
| Context | `FragmentContext` `{ envelope, host, status, error, act, ask, openLink }` | everything `render` gets |
| Parse | `parseToolResult(result, view?)` | never throws; `isError` → `FragmentError`, non-envelope → `INVALID_INPUT` |
| Theme | `applyTheme(host, map?)`, `defaultThemeMap`, `ThemeMap` | host theme + variables onto the document, then your CSS custom properties |
| React | `EnvelopeProvider`, `useEnvelope()`, `useAction(action)` from `./react` | one card component for both hosts |
| Transports | `mcpAppTransport(app)`, `httpTransport(call)` from `./react` | the only difference between a fragment and a product screen |

## Guarantees

- A fragment renders only from the envelope it is handed and writes back only through `tools/call`.
- After a successful `act`, the model context is updated with the new envelope, so the conversation knows what the user did inside the card.
- A second `act` while one is pending is ignored.
- Errors never throw out of the runtime; they land in `status: 'error'` with the server's `allowed_next_actions` when it sent them.
- `mcpAppTransport`'s `subscribe` registers with `app.addEventListener('toolresult', …)` rather than the exclusive `ontoolresult` setter, so a provider built on `EnvelopeProvider` + `mcpAppTransport` composes with a `createFragment` runtime listening on the same `App` — neither one steals the other's `toolresult` slot.

## Building a fragment

Bundle one HTML file per fragment (`vite-plugin-singlefile`), register it with `registerKit(server, kit, { fragments })`, and point the resource's `ui` map at it. In the product app, wrap the same card in `EnvelopeProvider` with `httpTransport(api.callKit)`.

The `transport` passed to `EnvelopeProvider` must be a stable reference — create it once with `useMemo` (or at module scope) rather than inline on every render — because the provider re-subscribes whenever the transport identity changes.

```tsx
// card.tsx — identical in the fragment bundle and the product app
export function ScanCard() {
  const { envelope, status } = useEnvelope<ScanView>();
  const picks = useAction(envelope?.allowed_next_actions.find((a) => a.capability === 'scan_review') ?? NONE);
  …
}

// fragment entry
createRoot(el).render(<EnvelopeProvider transport={mcpAppTransport(fragment.app)}><ScanCard /></EnvelopeProvider>);
```
