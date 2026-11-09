# Consuming `@de_canter/apogee-*` packages from another repo

The packages are published to npm under the `@de_canter` org as
`@de_canter/apogee-<name>`. Install the ones you import; the framework's
internal dependencies resolve on their own. No tarballs, overrides, or
registry auth are needed.

```bash
pnpm add @de_canter/apogee-kernel @de_canter/apogee-ai @de_canter/apogee-prompts \
  @de_canter/apogee-agent @de_canter/apogee-agent-react @de_canter/apogee-artifacts \
  @de_canter/apogee-rules @de_canter/apogee-documents-ai @de_canter/apogee-knowledge \
  @de_canter/apogee-integrations @de_canter/apogee-chat-kit @de_canter/apogee-chat-kit-app \
  @de_canter/apogee-grid-commander
```

`grid-commander` is a React data-grid cockpit; import its stylesheet once: `import '@de_canter/apogee-grid-commander/styles.css'`.

Prerequisites: Node 20 or later, TypeScript 5 in strict mode, React 18 or 19
for `agent-react`, `artifacts`, `chat-kit-app`, and `grid-commander`.

## Upgrading

Packages follow semver from `0.x`: a minor bump may break, a patch never does.
Check what is current with `npm view @de_canter/apogee-<name> version`, then
`pnpm up @de_canter/apogee-<name>@<version>`. Prereleases (`-rc.N`) publish
under the `next` dist-tag, so `latest` is always a release.

## Releases

`release.yml` runs on every `<name>-v<version>` tag push:

1. builds the workspace and packs the package;
2. publishes it to npm with `--access public` and `--provenance` (the source
   repo is public, so npm records the build attestation), using the
   `NPM_TOKEN` repo secret;
3. attaches the same tarball to a GitHub Release for the tag.

To release: bump `version` in the package's `package.json`, merge to `main`,
then tag the merge commit and push the tag:

```bash
git tag -a <name>-v<version> <merge-sha> -m "<name> <version>"
git push origin <name>-v<version>
```

The workflow can also be re-run for an existing tag via `workflow_dispatch`
(input: the tag).

When several packages change together, tag in dependency order (kernel, ai,
prompts, agent, agent-react, artifacts, rules, documents-ai, knowledge,
integrations, chat-kit, chat-kit-app, grid-commander) and let each run finish
before the next: `pnpm publish` rewrites `workspace:*` to the real version,
which must already be on npm.

## Tarballs (fallback)

If you cannot reach the registry, the tarball is on the GitHub Release for the
tag, named `de_canter-apogee-<name>-<version>.tgz`. Vendor it and point the
dependency at `file:vendor/<tarball>`; add a matching `pnpm.overrides` entry so
the framework's internal dependencies resolve to your vendored copies.
