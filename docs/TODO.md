# Jeff's TODO (apogee)

Updated 2026-09-18. Things only you can do, plus the queue.

## Needs you

- [ ] **Vercel project for apogee.build** — no project exists in `verve-technologies` or `de-canter`. Create it from `de-canter/apogee-build` (`main`), attach the `apogee.build` domain, framework preset Next.js, package manager pnpm (lockfile is committed).
- [ ] **`ANTHROPIC_API_KEY` in Vercel production** — flips `/demo/chat` from the scripted fake to Claude Haiku. Leave it unset on previews so they stay free.
- [ ] **Merge the B3 PR** (`feature/b3-rules`) and confirm the `rules-v0.1.0` release attached its tarball.
- [ ] **Run the live smoke once** — `packages/ai/scripts/smoke.ts` (needs `ANTHROPIC_API_KEY` or `ant auth login`). One Haiku `generateObject` plus one short `stream`; confirms the structured-output and caching wire shapes the tests only type-check.
- [ ] **Decide on `@apogee/agent-mongoose` timing** — the products need real `SessionStore`/`MessageStore` adapters before any rewrite; planned after B5.

## Decided

- apogee repo stays **private**; consumers vendor the release tarballs (`vendor/*.tgz` + `pnpm.overrides`, see `docs/consuming.md`). Revisit public/npm later.
- the reference product adopts by **clean-room rewrite**, not migration, once Track A and Track B are tagged.

## Queue (Claude runs these)

1. **B3** `@apogee/rules` — package built on `feature/b3-rules` (125 tests, 97% lines; plan `docs/plans/2026-09-18-b3-rules.md`); PR to merge, then tag `rules-v0.1.0`; admin-assistant demo lands in apogee-build on `feature/rules-demo`.
2. **B4** `@apogee/documents-ai` + `@apogee/knowledge` — document and knowledge demos.
3. **B5** `@apogee/integrations` — integration demo.
4. **B6b** apogee.build API reference (typedoc from the installed `.d.ts`), one demo per package as B3–B5 land.
5. **Track A Phase 2** kernel entity categories (Party, Place, Resource tiers, Document, Event, Activity, Commitment + Fulfillment, Transaction) and `extendEntity`; then `@apogee/kernel-mongoose`.
6. Workflow-engine hook: `StateMachine` accepts a kernel `LifecycleDefinition`.
7. the reference product clean-room rewrite plan (in the the reference product repo), gated on 1–6.

## Local gotchas

- Your shell exports `NODE_ENV=development`; `next build` fails on that. Site build script sets production.
- `rm -rf` and `cd <other repo> && git …` are denied by the shared settings; use `git -C`.
