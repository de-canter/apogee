# Consuming `@de_canter/apogee-*` packages from another repo

The packages are on npm as `@de_canter/apogee-<name>`. Install the ones you
import; the framework's internal dependencies resolve on their own.

```bash
pnpm add @de_canter/apogee-kernel @de_canter/apogee-ai @de_canter/apogee-prompts \
  @de_canter/apogee-agent @de_canter/apogee-agent-react @de_canter/apogee-artifacts \
  @de_canter/apogee-rules @de_canter/apogee-documents-ai @de_canter/apogee-knowledge \
  @de_canter/apogee-integrations
```

Prerequisites: Node 20 or later, TypeScript 5 in strict mode, React 18 or 19
for `agent-react` and `artifacts`.

## Releases

`release.yml` runs on every `<name>-v<version>` tag: it packs the package,
publishes it to npm (with provenance once the source repo is public), and
attaches the tarball to a GitHub Release. Publish in dependency order (kernel,
ai, prompts, agent, agent-react, artifacts, rules, documents-ai, knowledge,
integrations): `pnpm publish` rewrites `workspace:*` to the real version,
which must already be on npm.

## Tarballs

If you cannot use the registry, the same tarball is on the GitHub Release for
the tag, named `de_canter-apogee-<name>-<version>.tgz`. Vendor it and point the
dependency at `file:vendor/<tarball>`; add a matching `pnpm.overrides` entry so
the framework's internal dependencies resolve to your vendored copies.
