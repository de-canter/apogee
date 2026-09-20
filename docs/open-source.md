# Going public

**Decision (2026-09-19):** the `de-canter/apogee` repo becomes public under
Apache-2.0. de_canter LLC holds the copyright; Verve Technologies consumes the
packages the same way anyone else will. The flip waits on the checklist below.

## Audit (2026-09-19)

Scope: every path ever committed (265), every blob on every branch, excluding
`pnpm-lock.yaml`.

| Check | Result |
|---|---|
| Secret-shaped strings (Anthropic, AWS, GitHub, Slack, Stripe, npm tokens; private keys; age keys; Mongo URIs) | none, in any revision |
| Sensitive paths (`.env*`, `secrets/`, `*.pem`, `*.key`, `*.enc.*`) | none ever committed |
| GitHub workflows | `release.yml` uses `github.token` only |
| Package source (`packages/*/src`) | no product names, no internal hosts |
| Product and company names | present in docs, plans, `CLAUDE.md`, `.claude-shared/`, `scripts/` (see below) |

What the docs contain that a reader will see:

- Design specs and plans cite the reference product as the origin of most abstractions,
  with file paths inside the the reference product repo. No the reference product code, no
  customer data.
- Three plans contain absolute local paths (`~/...`) and a
  machine name (Selene). Harmless, but untidy.
- `.claude-shared/CLAUDE.md` and `scripts/apogee-*.sh` are the autonomous-run
  harness for Verve product repos. They name the products, the stack, and the
  owner's work email. They are operations tooling, not framework.

## Before the flip

- [x] `LICENSE` (Apache-2.0), `NOTICE`, `CONTRIBUTING.md`
- [x] `license: Apache-2.0`, `repository`, `homepage` in every package.json
- [ ] Decide where `.claude-shared/` and `scripts/` live. Options: leave them
      (public but harmless), or move them to a private ops repo and update the
      `@../apogee/.claude-shared/CLAUDE.md` import in each product repo.
- [ ] Replace absolute local paths in `docs/plans/` with repo-relative ones.
- [ ] Squash nothing. History is clean; keep it.
- [ ] Flip visibility on GitHub. Confirm the license badge shows Apache-2.0.

## npm

The `@apogee` scope on npm belongs to someone else (the org exists; the
registry returns it). `@decanter` is unclaimed as of 2026-09-19. Options,
in order of preference:

1. Publish as `@decanter/apogee-<name>` (`@decanter/apogee-kernel`). Package
   directories and the workspace stay as they are; only the published name
   changes. Consumers' imports change once.
2. Ask the `@apogee` owner to transfer the scope. Slow and uncertain.

Either way: claim the scope, add `publishConfig.access: public`, extend
`release.yml` with `pnpm publish --provenance`, then replace the tarball
install block on apogee.build and in `docs/consuming.md` with a normal
install line.
