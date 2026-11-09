# Apogee

The shared TypeScript framework behind de|canter's products: a domain kernel
plus a set of AI packages that turn one model client, registered prompts,
an agentic session, and natural-language business rules into things a
product can compose. Every package is domain-agnostic; the product supplies
the vocabulary. The live showcase is [apogee.build](https://apogee.build).

Apache-2.0. © de_canter LLC (de|canter). Public since 2026-09-20; [`docs/open-source.md`](docs/open-source.md) records the audit.

## Packages

| Package | Version | What it is |
|---|---|---|
| [`@de_canter/apogee-kernel`](packages/kernel) | 0.2.0 | Domain kernel: `Money`, `Quantity`, `Identifier`, `Interval`, `Provenance` and `Assertion`, `Lifecycle`, `Role`, `Classification` |
| [`@de_canter/apogee-ai`](packages/ai) | 0.3.0 | One model client for every AI call: vision and PDF input, Zod-validated structured output, prompt caching, model roles, priced usage, a scripted fake for tests |
| [`@de_canter/apogee-prompts`](packages/prompts) | 0.2.0 | Named, versioned prompts composed from sections with a cache-aware boundary and contributor slots |
| [`@de_canter/apogee-agent`](packages/agent) | 0.2.1 | The agentic session: bounded tool loop, one event stream that is also the SSE protocol, history compaction, bounded memory, persistence ports |
| [`@de_canter/apogee-agent-react`](packages/agent-react) | 0.2.0 | React client: SSE decoder, pure reducer, `useAgentSession`, unstyled chat shells |
| [`@de_canter/apogee-artifacts`](packages/artifacts) | 0.2.0 | Tool results as UI: a registry the host fills with components, a renderer, action dispatch, interaction telemetry |
| [`@de_canter/apogee-rules`](packages/rules) | 0.2.0 | Natural-language business rules: host-declared condition dimensions, parsing into assertions, validation, conflict detection, two-layer evaluation, prompt compilation, audit |
| [`@de_canter/apogee-documents-ai`](packages/documents-ai) | 0.2.0 | Classify, extract, confirm: host taxonomy and per-type Zod schemas, every claim an assertion with confidence, corrections and an audit sink, cross-document reconciliation, a staged resumable pipeline |
| [`@de_canter/apogee-knowledge`](packages/knowledge) | 0.2.0 | Retrieval: markdown chunking with stable ids, lexical and vector chunk stores with scopes and reingest, excerpts with citations as a prompt contributor |
| [`@de_canter/apogee-integrations`](packages/integrations) | 0.2.0 | No-code REST patterns: templates over the host context with vault secrets, five auth methods, rate limit, circuit breaker, retry, dead letters with replay, drift detection, inbound webhooks with classification, admin tools |
| [`@de_canter/apogee-chat-kit`](packages/chat-kit) | 0.3.1 | Chat-native capabilities: one resource declaration becomes MCP tools (structured output, derived read-only/destructive annotations), agent tools, and an HTTP handler, all returning `{ state, allowed_next_actions, ui? }` |
| [`@de_canter/apogee-chat-kit-app`](packages/chat-kit-app) | 0.1.0 | Fragment runtime for chat-kit: render an envelope inside an MCP Apps host or a product app and act through tools, one React card for both |
| [`@de_canter/apogee-grid-commander`](packages/grid-commander) | 0.1.0 | Cockpit-grade React data grid over TanStack Table and Virtual: renderers, editors, context menu, detail panel, status bar, keyboard model, themes |

Versions are the latest on npm. Each package README has its surface table, guarantees, and an example.

## Principles

- **Domain vocabulary is injected, never declared.** Document types, rule
  dimensions, tool sets, artifact cards, identifier schemes: all come from the
  host as typed configuration. A package that ships a product's enum is wrong.
- **One model client.** Nothing constructs the Anthropic SDK except
  `@de_canter/apogee-ai`. Packages ask for a model *role*; the host maps roles to models.
- **AI output enters as an `Assertion`.** Anything a model produces that a
  person might overrule carries `Provenance` with `source.kind = 'ai'`, a
  confidence, and a `proposed` status until the host confirms it.
- **Every prompt is registered.** Name, version, sections; composed, not
  concatenated, so caching and evals are possible.
- **Ports, not persistence.** Packages define the storage interfaces they need
  and ship in-memory implementations; adapters are separate packages.
- **Tests never touch the network.** `createFakeModelClient` scripts model
  turns and validates structured objects against the real schemas.

## Using the packages

```bash
pnpm add @de_canter/apogee-kernel @de_canter/apogee-ai
```

Every package is on npm under the [`@de_canter`](https://www.npmjs.com/org/de_canter)
org, published with provenance. See [`docs/consuming.md`](docs/consuming.md)
for the full install line, upgrading, and the tarball fallback.

## Working in this repo

pnpm 9.15.9 and Turborepo; each package is a tsup dual build with Vitest and
strict TypeScript, linted by the flat ESLint config at the root.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Run the four unfiltered before every commit; Turbo hides errors when its
output is piped through `grep`.

Releasing: bump the package `version`, merge to `main`, tag the merge commit
`<name>-v<version>`, push the tag. `release.yml` builds the workspace, publishes
the package to npm with provenance, and attaches the tarball to a GitHub
Release. Tag in dependency order when several packages change.

## Documents

- [`docs/design/kernel-ontology.md`](docs/design/kernel-ontology.md): the
  kernel spec (Track A) and its vocabulary.
- [`docs/design/ai-abstractions.md`](docs/design/ai-abstractions.md): the AI
  packages spec (Track B) and the apogee.build showcase.
- [`docs/plans/`](docs/plans): open plans; [`completed/`](docs/plans/completed)
  holds what shipped, each with an outcome note.
- [`docs/consuming.md`](docs/consuming.md): installing the packages elsewhere.
- [`docs/TODO.md`](docs/TODO.md): the action list and the queue of plans.
- [`docs/open-source.md`](docs/open-source.md): the audit and the remaining
  steps before the repo goes public.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to propose changes.

## License

Apache License 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
