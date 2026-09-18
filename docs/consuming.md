# Consuming `@apogee/*` packages from another repo

Packages are distributed as tarballs attached to GitHub Releases, one release
per package tag (`<name>-v<version>`). The `release.yml` workflow builds and
attaches them on every tag push.

Why not a git URL with `#path:`? pnpm clones the subdirectory without
workspace context, so any package with `workspace:*` dependencies (everything
except `kernel`) fails to install. Tarballs are packed inside the workspace,
so `workspace:*` is rewritten to the real version, and `pnpm.overrides` tells
the consumer where those versions come from.

## The block

Declare every package you import directly. Add overrides for all six so the
transitive `@apogee/*` versions resolve to tarballs instead of a registry.

```jsonc
{
  "dependencies": {
    "@apogee/agent": "https://github.com/de-canter/apogee/releases/download/agent-v0.1.0/apogee-agent-0.1.0.tgz",
    "@apogee/agent-react": "https://github.com/de-canter/apogee/releases/download/agent-react-v0.1.0/apogee-agent-react-0.1.0.tgz",
    "@apogee/artifacts": "https://github.com/de-canter/apogee/releases/download/artifacts-v0.1.0/apogee-artifacts-0.1.0.tgz",
    "@apogee/ai": "https://github.com/de-canter/apogee/releases/download/ai-v0.2.0/apogee-ai-0.2.0.tgz",
    "@apogee/prompts": "https://github.com/de-canter/apogee/releases/download/prompts-v0.1.1/apogee-prompts-0.1.1.tgz",
    "@apogee/kernel": "https://github.com/de-canter/apogee/releases/download/kernel-v0.1.0/apogee-kernel-0.1.0.tgz"
  },
  "pnpm": {
    "overrides": {
      "@apogee/kernel": "https://github.com/de-canter/apogee/releases/download/kernel-v0.1.0/apogee-kernel-0.1.0.tgz",
      "@apogee/ai": "https://github.com/de-canter/apogee/releases/download/ai-v0.2.0/apogee-ai-0.2.0.tgz",
      "@apogee/prompts": "https://github.com/de-canter/apogee/releases/download/prompts-v0.1.1/apogee-prompts-0.1.1.tgz",
      "@apogee/agent": "https://github.com/de-canter/apogee/releases/download/agent-v0.1.0/apogee-agent-0.1.0.tgz",
      "@apogee/agent-react": "https://github.com/de-canter/apogee/releases/download/agent-react-v0.1.0/apogee-agent-react-0.1.0.tgz",
      "@apogee/artifacts": "https://github.com/de-canter/apogee/releases/download/artifacts-v0.1.0/apogee-artifacts-0.1.0.tgz"
    }
  }
}
```

The React packages have `react` and `react-dom` (18 or 19) as peers.

## Releasing

```bash
git tag agent-v0.1.1 && git push origin agent-v0.1.1      # triggers release.yml
gh workflow run release.yml -f tag=agent-v0.1.1            # or run it by hand for an existing tag
gh release view agent-v0.1.1                               # confirm the .tgz asset
```

Bump the package's `version` in `package.json` before tagging; the tarball
file name comes from it.

## While the repo is private

Release assets on a private repo need authentication, so the URLs above
return 404 to an unauthenticated `pnpm install` (and to Vercel). Until the
repo is public, consumers copy the `.tgz` files into their own repo (for
example `vendor/`) and use `file:vendor/apogee-<name>-<version>.tgz` in both
the dependency and the override. apogee-build does this; see its
`vendor/README.md`.

## npm

Nothing is published to npm. If the `@apogee` scope is ever claimed, the
same tags can publish there and the overrides block goes away.
