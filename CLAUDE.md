# CLAUDE.md — apogee

@.claude-shared/CLAUDE.md

Apogee is de|canter's TypeScript framework for production AI applications,
used by Verve Technologies products (the reference product, The Somm, NailNotes,
MacMethod). Licensed Apache-2.0; the repo goes public once
`docs/open-source.md` is closed out. Nothing product-specific belongs here.

## Orientation (read in this order at session start)

1. `docs/TODO.md` — Jeff's action list and the **queue of plans to run next**.
2. `docs/design/kernel-ontology.md` — Track A spec (domain vocabulary).
3. `docs/design/ai-abstractions.md` — Track B spec (AI packages) and the apogee.build showcase.
4. `docs/plans/` — open plans and kickoff notes; `docs/plans/completed/` — what shipped, with outcome notes.
5. `docs/consuming.md` — how other repos install the packages (tarballs + overrides; repo is private).

## Workspace

pnpm 9.15.9 + Turborepo. Packages under `packages/*`, each: tsup dual build, Vitest, strict TS, ESLint flat config at the root. Root scripts: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Run them unfiltered before every commit; turbo output hides errors when piped through grep.

Releases: bump `version` in the package, tag `<name>-v<version>`, push the tag; `release.yml` attaches the tarball to a GitHub Release. Consumers vendor the tarball.

## Working pattern that held

- One plan per track in `docs/plans/<date>-<slug>.md` (TDD tasks, interfaces per task), executed on `feature/<name>`, PR to `main`, tag after merge, file the plan under `completed/` with an outcome note.
- Tests never touch the network: `createFakeModelClient` from `@apogee/ai` scripts model turns and validates `generateObject` objects against the schema.
- Domain vocabulary is injected by the host; nothing in a package knows what an order or a rental is (the showcase's equipment-rental domain lives in apogee-build).
- Shell gotchas on Selene: `NODE_ENV=development` is exported (breaks `next build`); `rm -rf` and cross-repo `cd` are denied; do not chain commit, push, and PR creation in one command.
