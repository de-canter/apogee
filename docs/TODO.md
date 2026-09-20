# Jeff's TODO (apogee)

Updated 2026-09-18. Things only you can do, plus the queue.

## Needs you

- [ ] **Vercel project for apogee.build** — in the **de|canter** Vercel account (de|canter LLC holds the IP; Verve runs the products). Import `de-canter/apogee-build` (`main`), framework preset Next.js, pnpm from `packageManager`, attach the `apogee.build` domain.
- [ ] **`ANTHROPIC_API_KEY` in Vercel production** — flips `/demo/chat` and `/demo/rules` from the scripted fake to Claude Haiku. Leave it unset on previews so they stay free.
- [ ] **Approve de-canter/apogee-build#4** (`feature/documents-knowledge-demo`: `/demo/documents` and `/demo/knowledge`). It vendors the same tarballs; no re-vendoring needed after the tags.
- [ ] **Approve de-canter/apogee#16** (`feature/b5-integrations`, the B5 package), then tag `integrations-v0.1.0` and confirm the release carries its tarball.
- [ ] **Approve the apogee-build integration demo PR** (`feature/integrations-demo`: `/demo/integrations`, `/api/webhooks/courier`, the admin assistant's integration tools). It vendors the same tarball.
- [ ] **Run the live smoke once** — `packages/ai/scripts/smoke.ts` (needs `ANTHROPIC_API_KEY` or `ant auth login`). One Haiku `generateObject` plus one short `stream`; confirms the structured-output and caching wire shapes the tests only type-check.
- [ ] **Decide on `@apogee/agent-mongoose` timing** — the products need real `SessionStore`/`MessageStore` adapters before any rewrite; planned after B5.

## Decided

- apogee repo stays **private**; consumers vendor the release tarballs (`vendor/*.tgz` + `pnpm.overrides`, see `docs/consuming.md`). Revisit public/npm later.
- the reference product adopts by **clean-room rewrite**, not migration, once Track A and Track B are tagged.

## Queue (Claude runs these)

1. **B3** `@apogee/rules` — done: apogee#11 and apogee-build#2 merged, `rules-v0.1.0` released with its tarball. Plan filed under `docs/plans/completed/`.
2. **B4** `@apogee/documents-ai` + `@apogee/knowledge` — packages merged and released (`documents-ai-v0.1.0`, `knowledge-v0.1.0`); demos pending apogee-build#4. Plan filed under `docs/plans/completed/`.
3. **B5** `@apogee/integrations` — done pending merges: apogee#16 (package) and the apogee-build integration demo PR. Plan filed under `docs/plans/completed/`.
4. **B6b** apogee.build API reference (typedoc from the installed `.d.ts`), one demo per package as B3–B5 land.
5. **Track A Phase 2** kernel entity categories (Party, Place, Resource tiers, Document, Event, Activity, Commitment + Fulfillment, Transaction) and `extendEntity`; then `@apogee/kernel-mongoose`.
6. Workflow-engine hook: `StateMachine` accepts a kernel `LifecycleDefinition`.
7. the reference product clean-room rewrite plan (in the the reference product repo), gated on 1–6.

## Local gotchas

- Your shell exports `NODE_ENV=development`; `next build` fails on that. Site build script sets production.
- `rm -rf` and `cd <other repo> && git …` are denied by the shared settings; use `git -C`.
