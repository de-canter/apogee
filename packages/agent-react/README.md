# @apogee/agent-react

React client for `@apogee/agent`. Decodes the SSE event stream, reduces it
into UI state with a pure reducer, and ships unstyled shells with slots.
Spec: `docs/design/ai-abstractions.md` §3.4.

| Concept | Import | One-liner |
|---|---|---|
| Hook | `useAgentSession({ transport, initialMessages?, onEvent? })` | `state`, `displayMessages` (with the streaming pseudo-message), `sendMessage(text, { annotations, artifactAction })`, `reset` |
| Transport | `fetchSseTransport(url, { headers?, fetch? })` | POSTs `{ message, annotations, artifactAction }` and decodes the body; any `(input) => AsyncIterable<AgentEvent>` works |
| Decoder | `decodeSseStream(body)` | frames split across chunks, `BAD_FRAME` errors for malformed JSON |
| Reducer | `reduceAgentState`, `initialAgentUiState`, `displayMessages` | pure; the same events the server emits drive the UI |
| Shells | `MessageList`, `Composer`, `ToolActivity`, `ContextMeter` | unstyled, `className` and render slots; hosts own the look |

Peer dependency: React 18 or 19.
