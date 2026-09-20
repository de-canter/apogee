# Apogee

The shared TypeScript framework behind de|canter's products: a domain kernel
plus a set of AI packages that turn one model client, registered prompts,
an agentic session, and natural-language business rules into things a
product can compose. Every package is domain-agnostic; the product supplies
the vocabulary. The live showcase is [apogee.build](https://apogee.build).

Private repo. © de|canter LLC.

## Packages

| Package | Version | What it is |
|---|---|---|
| [`@apogee/kernel`](packages/kernel) | 0.1.0 | Domain kernel: `Money`, `Quantity`, `Identifier`, `Interval`, `Provenance` and `Assertion`, `Lifecycle`, `Role`, `Classification` |
| [`@apogee/ai`](packages/ai) | 0.2.0 | One model client for every AI call: vision and PDF input, Zod-validated structured output, prompt caching, model roles, priced usage, a scripted fake for tests |
| [`@apogee/prompts`](packages/prompts) | 0.1.1 | Named, versioned prompts composed from sections with a cache-aware boundary and contributor slots |
| [`@apogee/agent`](packages/agent) | 0.1.0 | The agentic session: bounded tool loop, one event stream that is also the SSE protocol, history compaction, bounded memory, persistence ports |
| [`@apogee/agent-react`](packages/agent-react) | 0.1.0 | React client: SSE decoder, pure reducer, `useAgentSession`, unstyled chat shells |
| [`@apogee/artifacts`](packages/artifacts) | 0.1.0 | Tool results as UI: a registry the host fills with components, a renderer, action dispatch, interaction telemetry |
| [`@apogee/rules`](packages/rules) | 0.1.0 | Natural-language business rules: host-declared condition dimensions, parsing into assertions, validation, conflict detection, two-layer evaluation, prompt compilation, audit |
| [`@apogee/documents-ai`](packages/documents-ai) | 0.1.0 | Classify, extract, confirm: host taxonomy and per-type Zod schemas, every claim an assertion with confidence, corrections and an audit sink, cross-document reconciliation, a staged resumable pipeline |
| [`@apogee/knowledge`](packages/knowledge) | 0.1.0 | Retrieval: markdown chunking with stable ids, lexical and vector chunk stores with scopes and reingest, excerpts with citations as a prompt contributor |
| [`@apogee/integrations`](packages/integrations) | 0.1.0 | No-code REST patterns: templates over the host context with vault secrets, five auth methods, rate limit, circuit breaker, retry, dead letters with replay, drift detection, inbound webhooks with classification, admin tools |

Each package README has its surface table, guarantees, and an example.

## Principles

- **Domain vocabulary is injected, never declared.** Document types, rule
  dimensions, tool sets, artifact cards, identifier schemes: all come from the
  host as typed configuration. A package that ships a product's enum is wrong.
- **One model client.** Nothing constructs the Anthropic SDK except
  `@apogee/ai`. Packages ask for a model *role*; the host maps roles to models.
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

Packages are distributed as tarballs attached to GitHub Releases, one release
per `<name>-v<version>` tag. Because the repo is private, consumers vendor the
`.tgz` files and add `pnpm.overrides`; see [`docs/consuming.md`](docs/consuming.md).

## Working in this repo

pnpm 9.15.9 and Turborepo; each package is a tsup dual build with Vitest and
strict TypeScript, linted by the flat ESLint config at the root.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Run the four unfiltered before every commit; Turbo hides errors when its
output is piped through `grep`.

Releasing: bump the package `version`, tag `<name>-v<version>`, push the tag.
`release.yml` builds the workspace, packs the package, and attaches the
tarball to a GitHub Release.

## Documents

- [`docs/design/kernel-ontology.md`](docs/design/kernel-ontology.md): the
  kernel spec (Track A) and its vocabulary.
- [`docs/design/ai-abstractions.md`](docs/design/ai-abstractions.md): the AI
  packages spec (Track B) and the apogee.build showcase.
- [`docs/plans/`](docs/plans): open plans; [`completed/`](docs/plans/completed)
  holds what shipped, each with an outcome note.
- [`docs/consuming.md`](docs/consuming.md): installing the packages elsewhere.
- [`docs/TODO.md`](docs/TODO.md): the action list and the queue of plans.
