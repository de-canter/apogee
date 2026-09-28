# @de_canter/apogee-chat-kit-app

The client half of the chat kit: render an envelope from `@de_canter/apogee-chat-kit` inside an MCP Apps host or inside the product's own app, act through tools, and keep the model informed. One React card, two transports. Spec: `docs/design/chat-kit.md` §6.

| Concept | Import | One-liner |
|---|---|---|
| Runtime | `createFragment({ name, version, render, view?, theme?, app? })` → `{ connect(), destroy(), app }` | wraps the ext-apps `App`; tool results become envelopes; `act()` calls the tool, re-renders, updates model context |
| Context | `FragmentContext` `{ envelope, host, status, error, act, ask, openLink }` | everything `render` gets |
| Parse | `parseToolResult(result, view?)`, `toolResultText(result)` | never throws; accepts an `Envelope` or a `ListEnvelope`; `isError` → `FragmentError`, anything else → `INVALID_INPUT` |
| Theme | `applyTheme(host, map?)`, `defaultThemeMap`, `ThemeMap` | host theme + variables onto the document, then your CSS custom properties |
| React | `EnvelopeProvider`, `useEnvelope()`, `useAction(action)` from `./react` | one card component for both hosts |
| Transports | `mcpAppTransport(app)`, `httpTransport(call)` from `./react` | the only difference between a fragment and a product screen |

## Guarantees

- A fragment renders only from the envelope it is handed and writes back only through `tools/call`.
- `envelope` is an `Envelope` or a `ListEnvelope`; a card tells them apart with `isListEnvelope` from `@de_canter/apogee-chat-kit`.
- After a successful `act`, the model context is updated with the new envelope and the server's own describe text (the tool result's first text block, falling back to `describeEnvelope`), so the conversation knows what the user did inside the card.
- A second `act` while one is pending is ignored.
- Errors never throw out of the runtime; they land in `status: 'error'` with the server's `allowed_next_actions` when it sent them.
- A throwing `render` never escapes the runtime: it becomes `status: 'error'` with code `INTERNAL`. A host teardown destroys the fragment.
- `mcpAppTransport(app)` listens with `app.addEventListener('toolresult', …)` from the moment it is built, rather than the exclusive `ontoolresult` setter, so it composes with a `createFragment` runtime on the same `App`. It remembers the latest tool result and replays it to each new `subscribe`, so a provider that mounts after the host's one-shot initial tool result still renders it. Build the transport before `fragment.connect()`.

## Building a fragment

Bundle one HTML file per fragment (`vite-plugin-singlefile`), register it with `registerKit(server, kit, { fragments })`, and point the resource's `ui` map at it. In the product app, wrap the same card in `EnvelopeProvider` with `httpTransport(api.callKit)`.

The `transport` passed to `EnvelopeProvider` must be a stable reference — create it once with `useMemo` (or at module scope) rather than inline on every render — because the provider re-subscribes whenever the transport identity changes.

```tsx
// card.tsx — identical in the fragment bundle and the product app
export function ScanCard() {
  const { envelope, status } = useEnvelope<ScanView>();
  const picks = useAction(envelope?.allowed_next_actions.find((a) => a.capability === 'scan_review') ?? NONE);
  if (envelope && isListEnvelope(envelope)) return <ScanList list={envelope} />;
  …
}

// fragment entry: build the transport BEFORE connect() so it cannot miss the initial tool result
const fragment = createFragment({ name: 'scan-card', version: '1.0.0', render: () => undefined });
const transport = mcpAppTransport(fragment.app);
await fragment.connect();
createRoot(el).render(<EnvelopeProvider transport={transport}><ScanCard /></EnvelopeProvider>);
```
