# Plan B6a — Release Tarballs + apogee.build Showcase (chat demo) Implementation Plan

> **Outcome (2026-09-18):** Tasks 1–2 done in this repo (PR #9: `release.yml`, `docs/consuming.md`, prompts 0.1.1; six releases published with tarballs). Tasks 3–7 done in apogee-build on `feature/showcase`, PR de-canter/apogee-build#1, awaiting merge. Deviations: the apogee repo is private, so release URLs 404 unauthenticated and apogee-build vendors the tarballs under `vendor/`; no Vercel project exists for apogee.build yet, so the preview step could not run (build verified locally and over HTTP in demo mode). The dev shell's `NODE_ENV=development` breaks `next build`; the site's build script sets production.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-18
**Origin:** `docs/design/ai-abstractions.md` §5 (showcase) and §6 (B6). Prerequisites B1 and B2 are merged and tagged. Consumption spike 2026-09-18: `github:…#path:` fails for packages with `workspace:*` deps (pnpm clones the subdirectory without workspace context); packed tarballs + `pnpm.overrides` for transitive packages work.

**Goal:** Make every `@de_canter/apogee-*` package consumable from any repo through GitHub Release tarballs, then turn apogee.build from a static landing page into the living showcase with a generated package index, rendered package READMEs, and the first live demo: an agent chat on the equipment-rental demo domain, running the real model when a key is present and a scripted fake otherwise.

**Architecture:** In the apogee repo, a `release.yml` workflow packs one package per tag (`<name>-v<version>`) and attaches the `.tgz` to a GitHub Release; a `docs/consuming.md` shows the dependency plus overrides block. In `apogee-build`, the site moves to pnpm, depends on the six tarballs, and gets three surfaces: `/` (hero + package index generated from a manifest), `/packages/[name]` (README rendered from the installed package), `/demo/chat` (client built on `@de_canter/apogee-agent-react` + `@de_canter/apogee-artifacts`, server route built on `@de_canter/apogee-agent` with `agentEventsToReadableStream`). The demo domain lives in `src/demo/rental/` on kernel nouns.

**Tech Stack:** apogee repo: GitHub Actions. apogee-build: Next.js 16 App Router, React 19, Tailwind v4, pnpm 9, Vitest 4 (route + tools tests with `createFakeModelClient`), `marked` for README rendering, Vercel (auto-deploy from `main`).

**Spec:** `docs/design/ai-abstractions.md` §5.

## Global Constraints

- Two repos. Tasks 1–2 in `de-canter/apogee` (branch `feature/b6a-showcase`, PR to `main`). Tasks 3–7 in `de-canter/apogee-build` (branch `feature/showcase`, PR to `main`; Vercel deploys `main`).
- Tarball URL shape: `https://github.com/de-canter/apogee/releases/download/<name>-v<version>/apogee-<name>-<version>.tgz`. Consumers declare every package they import directly and add `pnpm.overrides` for the rest.
- apogee-build never constructs the Anthropic SDK; it calls `createAnthropicModelClient()` (env `ANTHROPIC_API_KEY`) or `createFakeModelClient(demoScript)` when the key is absent. Demo mode is the default for previews and CI.
- Per-visitor rate limit on the demo route: 20 turns per hour per IP, 200 turns per day per instance, in-memory. Max 6 tool rounds, `fast` model role (Haiku) for cost.
- Demo domain is the equipment rental company (§5): no Verve product vocabulary.
- The existing visual language stays (Inter, JetBrains Mono, `apogee-*` blues, dark hero). New pages use the same Tailwind tokens.
- No `any`, strict TS, ESLint clean, `pnpm build` clean. Vitest for server logic; no browser tests in this plan.

## File Structure

```
apogee/                                     (Tasks 1–2)
├── .github/workflows/release.yml           # tag push or manual: pack + release
├── docs/consuming.md                       # how any repo depends on @de_canter/apogee-*
└── packages/prompts/package.json           # peer @de_canter/apogee-ai ">=0.1.0"

apogee-build/                               (Tasks 3–7)
├── package.json pnpm-lock.yaml .npmrc      # pnpm, tarball deps, overrides
├── vitest.config.ts  eslint.config.mjs (existing)
├── src/app/
│   ├── layout.tsx page.tsx globals.css     # existing, page.tsx regenerates packages from manifest
│   ├── packages/[name]/page.tsx            # README rendered from node_modules/@de_canter/apogee-<name>/README.md
│   ├── demo/chat/page.tsx                  # client demo
│   └── api/agent/route.ts                  # POST -> SSE
├── src/packages.ts                         # manifest: name, tagline, status, version (read from node_modules package.json)
├── src/demo/rental/
│   ├── domain.ts                           # kernel-based fixtures: equipment types/units, customers, rentals
│   ├── tools.ts                            # list_equipment, check_availability, create_rental, add_note (+ memory)
│   ├── prompt.ts                           # rental desk prompt (sections + memory slot)
│   ├── script.ts                           # scripted fake turns for demo mode
│   └── server.ts                           # createDemoSession(sessionId): registry, stores, client selection, rate limit
├── src/components/                         # existing + Chat.tsx, cards/{EquipmentCard,RentalCard}.tsx, PackageCard changes
└── src/__tests__/ domain, tools, route
```

---

### Task 1: Release workflow + consuming doc (apogee repo)

**Files:** Create `.github/workflows/release.yml`, `docs/consuming.md`; Modify `packages/prompts/package.json` (`peerDependencies["@de_canter/apogee-ai"] = ">=0.1.0"`), `packages/ai/README.md` and `packages/kernel/README.md` consuming sections (point to `docs/consuming.md`).

**Interfaces:**
- Trigger on `push: tags: ['*-v*']` and `workflow_dispatch` with input `tag` (e.g. `agent-v0.1.0`).
- Steps: checkout the tag; pnpm 9.15.9; Node 22; `pnpm install --frozen-lockfile`; `pnpm build`; derive `name` and `version` from the tag with `sed -E 's/^(.+)-v([0-9.]+)$/\1 \2/'`; `pnpm -C packages/$name pack --pack-destination ../../release`; `gh release create "$tag" release/*.tgz --title "$tag" --notes "..."` (or `gh release upload --clobber` if it exists). Needs `permissions: contents: write`.
- `docs/consuming.md`: the dependency block and the overrides block for all six packages at current versions; a note that `github:…#path:` works only for packages without workspace deps (kernel) and is not recommended.

- [ ] **Step 1:** Write the workflow and doc; fix the prompts peer spec; `pnpm install` to refresh the lockfile.
- [ ] **Step 2:** Verify `pnpm typecheck lint build test` clean. Commit `chore(release): add tarball release workflow and consuming guide`. Push, open PR, merge.
- [ ] **Step 3:** Publish the six existing tags: `for t in kernel-v0.1.0 ai-v0.2.0 prompts-v0.1.0 agent-v0.1.0 agent-react-v0.1.0 artifacts-v0.1.0; do gh workflow run release.yml -f tag=$t; done`. Wait for the runs; confirm `gh release view agent-v0.1.0` lists `apogee-agent-0.1.0.tgz`. Note: prompts-v0.1.0's tarball will carry the old peer spec; consumers override it anyway. Cut `prompts-v0.1.1` after merge so the fixed peer ships.

---

### Task 2: Re-verify consumption from the published URLs

- [ ] In a scratch directory, `package.json` with `@de_canter/apogee-agent`, `@de_canter/apogee-agent-react`, `@de_canter/apogee-artifacts`, `@de_canter/apogee-ai`, `@de_canter/apogee-prompts`, `@de_canter/apogee-kernel` as tarball URLs, `react`/`react-dom` 19, and `pnpm.overrides` for the six; `pnpm install`; `node -e "require('@de_canter/apogee-agent')"` prints a function. Record the exact block that worked into `docs/consuming.md` if it differs (commit as `docs(consuming): verified block`).

---

### Task 3: apogee-build on pnpm with the framework installed

**Files:** Delete `package-lock.json`; Modify `package.json` (add `"packageManager": "pnpm@9.15.9"`, deps: six tarballs, `marked`, `zod`; devDeps: `vitest`, `@vitest/coverage-v8`; scripts `test`, `typecheck`); Create `.npmrc` (`auto-install-peers=true`), `vitest.config.ts` (node environment, `src/**/*.test.ts`).

- [ ] **Step 1:** `pnpm install`; `pnpm build` (Next) passes with the packages resolvable: add a temporary `src/__tests__/smoke.test.ts` that imports `createFakeModelClient` from `@de_canter/apogee-ai` and `createAgentSession` from `@de_canter/apogee-agent` and asserts they are functions.
- [ ] **Step 2:** Commit `chore: move to pnpm and install @apogee packages from release tarballs`.

---

### Task 4: Demo domain and tools

**Files:** `src/demo/rental/domain.ts`, `tools.ts`, `prompt.ts`, `script.ts`; tests `src/__tests__/domain.test.ts`, `tools.test.ts`.

**Interfaces:**
- `domain.ts`: `EquipmentType = { code; name; category: Classification; dailyRate: Money; description }` (8 types: excavator, skid steer, scissor lift, generator, compactor, trencher, concrete mixer, pressure washer); `EquipmentUnit = { id; typeCode; serial: Identifier ('serial' scheme); yard: 'north' | 'south'; status: LifecycleState<'available' | 'rented' | 'maintenance'> }` (2–3 units per type); `Customer = { id: Ref; name; identifiers: Identifier[] }` (3 customers); `Rental = { id; unitId; customerId; period: Interval; total: Money; status }`. `createRentalWorld()` returns a fresh mutable world (per session). Pure helpers: `availableUnits(world, typeCode, period)`, `quote(type, period)` using kernel `multiply`/`intervalDurationMs`.
- `tools.ts`: `list_equipment({ category? })` → data + `equipment-card` artifacts (one per type, `id: equipment-<code>-<toolUseId>`); `check_availability({ typeCode, start, end })` → available unit count and quote; `create_rental({ typeCode, customerName, start, end })` → picks a unit, moves its lifecycle to `rented`, returns a `rental-card` artifact with total in `formatMoney`; `add_note({ text })`. Plus `memoryTool` keyed by `ctx.customerName ?? 'walk-in'` with `maxChars: 2000`. Context type `RentalCtx = { world: RentalWorld; customerName?: string }`.
- `prompt.ts`: `rentalDeskPrompt` with identity, capabilities (list the tools and when to use them), a stable yard-hours section, `slot('memory','memory')`, and a volatile `fromContext` "Today is …" line.
- `script.ts`: `demoScript` — a function script keyed by turn index that answers the first three common questions with tool rounds (list equipment → cards; availability → quote; create rental → rental card) and a generic fallback afterwards, so demo mode looks alive.

- [ ] **Step 1: Failing tests**: `quote` for 3 days of a $450/day type is `$1,350.00`; `availableUnits` excludes rented units; `create_rental` flips the unit to `rented` and the second call for the same dates returns a different unit or a failure when none left; every artifact id embeds the `toolUseId`; `list_equipment` returns 8 artifacts.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(demo): add equipment-rental domain, tools, prompt, and demo script`.

---

### Task 5: Server route

**Files:** `src/demo/rental/server.ts`, `src/app/api/agent/route.ts`; test `src/__tests__/route.test.ts`.

**Interfaces:**
- `server.ts`: `getModelClient()` → `createAnthropicModelClient({ resolveModel: staticResolver({ default: 'claude-haiku-4-5', fast: 'claude-haiku-4-5' }) })` when `process.env.ANTHROPIC_API_KEY` is set, else `createFakeModelClient(demoScript)`; `isDemoMode()`. `sessions = createSessionRegistry<AgentSession<RentalCtx>>({ idleMs: 30 * 60_000 })`; `getOrCreateSession(sessionId)` builds a session with `createRentalWorld()`, tools, prompt, in-memory message store, `maxRounds: 6`, `model: 'fast'`, `compaction: { budgetTokens: 20_000 }`. `rateLimit(ip)` → `{ ok: boolean; retryAfterSec? }` with the constants above.
- `route.ts`: `POST` reads `{ message, annotations?, artifactAction? }` (Zod), reads or sets a `apogee-demo-session` cookie (random id), applies the rate limit (429 with JSON body when exceeded), runs `session.run(message, { annotations })`, returns `new Response(agentEventsToReadableStream(events), { headers: { ...SSE_HEADERS, 'x-apogee-demo-mode': isDemoMode() ? '1' : '0' } })`. `GET` returns `{ demoMode, sessionId, messages }` for reload. Export `runtime = 'nodejs'`.

- [ ] **Step 1: Failing test** calls the exported `POST` with a `Request` (no key in env → demo mode): the response is `text/event-stream`, decoding the body with `decodeSseStream` from `@de_canter/apogee-agent-react` yields a `turn_end`; a second call with the same cookie continues the session (history length grows); 21 calls from one IP within the window → 429.
- [ ] **Step 2: Implement. Step 3: Verify, commit** `feat(demo): add agent SSE route with session registry, demo mode, and rate limit`.

---

### Task 6: Client demo page and cards

**Files:** `src/app/demo/chat/page.tsx`, `src/components/Chat.tsx` (client), `src/components/cards/EquipmentCard.tsx`, `src/components/cards/RentalCard.tsx`, `src/components/DemoBanner.tsx`.

- `Chat.tsx`: `'use client'`; `useAgentSession({ transport: fetchSseTransport('/api/agent') })`; `ArtifactRegistryProvider` with the two cards; `MessageList` with `renderArtifact={(a) => <ArtifactRenderer artifact={a} onAction={(type, data, msg) => dispatch(a.id, type, data, msg)} />}` where `dispatch` comes from `useArtifactActions({ sendMessage: (text, { artifactAction, annotations }) => sendMessage(text, { artifactAction, annotations }) })`; `ToolActivity`, `ContextMeter` (budget 200k), a usage line (`totalUsage.costUsd` to 4 decimals), and three suggested-prompt chips. Demo-mode banner when the `x-apogee-demo-mode` header is `1` (read once via a `GET /api/agent` on mount).
- Cards use `ArtifactContainer`; `EquipmentCard` shows name, rate, category, a "Check availability" button → `onAction('check_availability', { typeCode }, 'Check availability for <name> next week')`; `RentalCard` shows unit serial, period, total, and a "Add pickup note" button → `onAction('edit', { rentalId })`.
- Styling with Tailwind classes consistent with the landing page.

- [ ] **Step 1:** Build the page and cards; `pnpm typecheck && pnpm lint && pnpm build`; run `pnpm dev` and exercise the three chips manually in demo mode (record what was seen in the commit message).
- [ ] **Step 2: Commit** `feat(demo): add live chat demo page with equipment and rental cards`.

---

### Task 7: Package index and package pages, landing page wiring, PR

**Files:** `src/packages.ts`, `src/components/PackagesSection.tsx` (regenerate from manifest), `src/app/packages/[name]/page.tsx`, `src/components/Header.tsx` (add Demo link), `src/components/GetStartedSection.tsx` (real install block from `docs/consuming.md`), `src/components/CodeExample.tsx` (real snippet: `createAgentSession` + `agentEventsToReadableStream`), `README.md`.

- `packages.ts`: array of `{ name, tagline, status: 'shipped' | 'planned', color }` for kernel, ai, prompts, agent, agent-react, artifacts (shipped) and rules, documents-ai, knowledge, integrations (planned); `version` read at build time from `require('@de_canter/apogee-<name>/package.json')` for shipped ones.
- `packages/[name]/page.tsx`: `generateStaticParams` over shipped names; reads `node_modules/@de_canter/apogee-<name>/README.md` with `fs` at build time, renders with `marked` into a prose container; shows version, install line, and a link to the demo for `agent`, `agent-react`, `artifacts`.

- [ ] **Step 1:** Implement; `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [ ] **Step 2: Commit** `feat(site): generate package index from the workspace, render package READMEs, real install and code examples`.
- [ ] **Step 3:** Push `feature/showcase`, open the PR with this plan as the body, wait for the Vercel preview, open the preview's `/demo/chat` and confirm demo mode works. Report the preview URL. After merge: set `ANTHROPIC_API_KEY` in Vercel (production only) to switch the demo to the live model.

---

## Self-review

- **§5 coverage:** demo domain (T4), one section per shipped package with README (T7), live demo with server-side key + rate limit + in-memory adapters (T5–T6), consumption through the real mechanism (T1–T3), generated package list (T7). API reference generation (typedoc) is deferred to B6b.
- **Out of scope:** admin, document, integration, knowledge demos (land with B3–B5); Playwright tests; typedoc.
- **Type consistency:** `RentalCtx` (T4) is the `TCtx` of the session in T5 and the memory key source; artifact types `equipment-card` / `rental-card` are produced in T4 and registered in T6; `demoScript` (T4) feeds `createFakeModelClient` in T5.
