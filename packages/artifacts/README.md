# @de_canter/apogee-artifacts

Tool results as UI. A tool returns an `ArtifactDescriptor` (`{ type, id, data, props? }`);
the host registers one React component per `type`; the renderer looks it up;
card interactions become the next agent message plus a model-only annotation;
interaction telemetry is batched. Spec: `docs/design/ai-abstractions.md` §3.5.

| Concept | Import | One-liner |
|---|---|---|
| Registry | `createArtifactRegistry()`, `ArtifactRegistryProvider`, `useArtifactRegistry` | `register('note-card', NoteCard)`; the framework ships no cards |
| Renderer | `ArtifactRenderer({ artifact, onAction, fallback? })` | looks up the type; unknown types get a fallback |
| Container | `ArtifactContainer` | frame with `data-artifact-id`/`data-artifact-type`, variants, loading and error states, `onShown` once |
| Actions | `useArtifactActions({ sendMessage })` → `dispatch(artifactId, actionType, data?, message?)` | sends `message` with `{ artifactAction, annotations: [formatArtifactAnnotation(action)] }` |
| Events | `useArtifactEvents({ artifactType, artifactId, sink })` | `recordShown/FieldChange/Submit/Action`; per-field debounce 300ms, batch 1000ms; submit flushes pending field changes first |

Server side: pass the `annotations` through to `session.run(text, { annotations })`; the
model sees `[Artifact Action: submit on party-form-1 …]`, the UI shows only `text`.
