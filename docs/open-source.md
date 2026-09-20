# Going public

**Decision (2026-09-19):** the `de-canter/apogee` repo becomes public under
Apache-2.0. de_canter LLC holds the copyright; Verve Technologies consumes the
packages the same way anyone else will. The flip waits on the checklist below.

## Audit (2026-09-19)

Scope: every path ever committed, every blob on every branch, excluding
`pnpm-lock.yaml`.

| Check | Result |
|---|---|
| Secret-shaped strings (Anthropic, AWS, GitHub, Slack, Stripe, npm tokens; private keys; age keys; Mongo URIs) | none, in any revision |
| Sensitive paths (`.env*`, `secrets/`, `*.pem`, `*.key`, `*.enc.*`) | none ever committed |
| GitHub workflows | `release.yml` uses `github.token` only |
| Package source (`packages/*/src`) | no product names, no internal hosts |
| Product names in docs, plans, `CLAUDE.md`, `.claude-shared/`, `scripts/` | scrubbed 2026-09-19; the origin product is now "the reference product" |
| Absolute local paths and machine names in plans | scrubbed 2026-09-19 |

What a reader will still see:

- Design specs and plans cite an unnamed reference product as the origin of
  most abstractions. No product code, no customer data.
- The kernel's acceptance tests exercise a property-transaction domain
  (recorded instruments, settlement proration, multi-scheme identifiers).
  They name no product or real company.
- `.claude-shared/CLAUDE.md` and `scripts/apogee-*.sh` are the autonomous-run
  harness for the operating companies' product repos. They name the products,
  the stack, and the owner's work email. They are operations tooling, not
  framework.

## Before the flip

- [x] `LICENSE` (Apache-2.0), `NOTICE`, `CONTRIBUTING.md`
- [x] `license: Apache-2.0`, `repository`, `homepage` in every package.json
- [x] Packages renamed to `@de_canter/apogee-<name>`; every package bumped one
      minor version so the renamed tarballs get fresh tags
- [ ] Create the `de_canter` org on npm **before merging the rename**. The
      registry reports the scope as free and the name validates, but the org
      form is the final word. Fallback: `@de-canter`, which matches the GitHub
      org.
- [ ] Decide where `.claude-shared/` and `scripts/` live. Options: leave them
      (public but harmless), or move them to a private ops repo and update the
      `@../apogee/.claude-shared/CLAUDE.md` import in each product repo.
- [ ] Tag and release every package at its new version so the tarball URLs in
      `docs/consuming.md` resolve. Then update apogee.build's imports and
      install block, and re-vendor in each consumer.
- [ ] Squash nothing. History is clean; keep it.
- [ ] Flip visibility on GitHub. Confirm the license badge shows Apache-2.0.

## npm

The `@apogee` scope belongs to someone else (the org exists; the registry
returns it), and the unscoped `apogee` name is taken too. Packages publish as
`@de_canter/apogee-<name>`.

Once the org exists: add `publishConfig.access: public` to each package,
extend `release.yml` with `pnpm publish --provenance`, then replace the
tarball install block on apogee.build and in `docs/consuming.md` with a
normal install line.
