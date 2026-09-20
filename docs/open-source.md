# Going public

**Decision (2026-09-19):** the `de-canter/apogee` repo becomes public under
Apache-2.0. de_canter LLC holds the copyright; Verve Technologies consumes the
packages the same way anyone else will. **Done 2026-09-20.** The checklist below
is kept as the record of what it took.

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
| Git history | rewritten 2026-09-20; verified no revision, message, or path carries the name |

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
- [x] `de_canter` org created on npm (2026-09-19)
- [x] `publishConfig.access: public` in every package; `release.yml`
      publishes with provenance when `NPM_TOKEN` is set
- [x] `NPM_TOKEN` repo secret added (2026-09-20); every package published at its
      new version the same day
- [x] `.claude-shared/` and `scripts/` stay in the repo (public but harmless).
      Revisit if the harness grows product-specific.
- [x] Every package tagged and released at its new version (2026-09-20).
- [x] apogee.build installs from npm and drops the vendored tarballs (2026-09-20).
- [x] History rewritten with `git filter-repo` (2026-09-20) so no revision names
      the reference product or carries a local path, then pushed to a fresh
      repository. The original, with its pull-request history, stays private
      as `de-canter/apogee-archive`.
- [x] Public since 2026-09-20; GitHub detects Apache License 2.0. `NPM_TOKEN` re-set on
      the fresh repo the same day, so provenance is on for the next tag.

## npm

The `@apogee` scope belongs to someone else (the org exists; the registry
returns it), and the unscoped `apogee` name is taken too. Packages publish as
`@de_canter/apogee-<name>`.

Tags publish in dependency order (kernel first, integrations last), since
`pnpm publish` rewrites `workspace:*` to the real version and that version
must already be on npm. After the first full round, replace the tarball
install block on apogee.build with a normal install line.
