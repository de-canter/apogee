# Consuming `@de_canter/apogee-*` packages from another repo

Packages are distributed as tarballs attached to GitHub Releases, one release
per package tag (`<name>-v<version>`). The `release.yml` workflow builds and
attaches them on every tag push.

Why not a git URL with `#path:`? pnpm clones the subdirectory without
workspace context, so any package with `workspace:*` dependencies (everything
except `kernel`) fails to install. Tarballs are packed inside the workspace,
so `workspace:*` is rewritten to the real version, and `pnpm.overrides` tells
the consumer where those versions come from.

## The block

Declare every package you import directly. Add overrides for all ten so the
transitive `@de_canter/apogee-*` versions resolve to tarballs instead of a registry.

```jsonc
{
  "dependencies": {
    "@de_canter/apogee-rules": "https://github.com/de-canter/apogee/releases/download/rules-v0.2.0/de_canter-apogee-rules-0.2.0.tgz",
    "@de_canter/apogee-documents-ai": "https://github.com/de-canter/apogee/releases/download/documents-ai-v0.2.0/de_canter-apogee-documents-ai-0.2.0.tgz",
    "@de_canter/apogee-knowledge": "https://github.com/de-canter/apogee/releases/download/knowledge-v0.2.0/de_canter-apogee-knowledge-0.2.0.tgz",
    "@de_canter/apogee-integrations": "https://github.com/de-canter/apogee/releases/download/integrations-v0.2.0/de_canter-apogee-integrations-0.2.0.tgz",
    "@de_canter/apogee-agent": "https://github.com/de-canter/apogee/releases/download/agent-v0.2.0/de_canter-apogee-agent-0.2.0.tgz",
    "@de_canter/apogee-agent-react": "https://github.com/de-canter/apogee/releases/download/agent-react-v0.2.0/de_canter-apogee-agent-react-0.2.0.tgz",
    "@de_canter/apogee-artifacts": "https://github.com/de-canter/apogee/releases/download/artifacts-v0.2.0/de_canter-apogee-artifacts-0.2.0.tgz",
    "@de_canter/apogee-ai": "https://github.com/de-canter/apogee/releases/download/ai-v0.3.0/de_canter-apogee-ai-0.3.0.tgz",
    "@de_canter/apogee-prompts": "https://github.com/de-canter/apogee/releases/download/prompts-v0.2.0/de_canter-apogee-prompts-0.2.0.tgz",
    "@de_canter/apogee-kernel": "https://github.com/de-canter/apogee/releases/download/kernel-v0.2.0/de_canter-apogee-kernel-0.2.0.tgz"
  },
  "pnpm": {
    "overrides": {
      "@de_canter/apogee-kernel": "https://github.com/de-canter/apogee/releases/download/kernel-v0.2.0/de_canter-apogee-kernel-0.2.0.tgz",
      "@de_canter/apogee-ai": "https://github.com/de-canter/apogee/releases/download/ai-v0.3.0/de_canter-apogee-ai-0.3.0.tgz",
      "@de_canter/apogee-prompts": "https://github.com/de-canter/apogee/releases/download/prompts-v0.2.0/de_canter-apogee-prompts-0.2.0.tgz",
      "@de_canter/apogee-agent": "https://github.com/de-canter/apogee/releases/download/agent-v0.2.0/de_canter-apogee-agent-0.2.0.tgz",
      "@de_canter/apogee-agent-react": "https://github.com/de-canter/apogee/releases/download/agent-react-v0.2.0/de_canter-apogee-agent-react-0.2.0.tgz",
      "@de_canter/apogee-artifacts": "https://github.com/de-canter/apogee/releases/download/artifacts-v0.2.0/de_canter-apogee-artifacts-0.2.0.tgz",
      "@de_canter/apogee-rules": "https://github.com/de-canter/apogee/releases/download/rules-v0.2.0/de_canter-apogee-rules-0.2.0.tgz",
      "@de_canter/apogee-documents-ai": "https://github.com/de-canter/apogee/releases/download/documents-ai-v0.2.0/de_canter-apogee-documents-ai-0.2.0.tgz",
      "@de_canter/apogee-knowledge": "https://github.com/de-canter/apogee/releases/download/knowledge-v0.2.0/de_canter-apogee-knowledge-0.2.0.tgz",
      "@de_canter/apogee-integrations": "https://github.com/de-canter/apogee/releases/download/integrations-v0.2.0/de_canter-apogee-integrations-0.2.0.tgz"
    }
  }
}
```

The React packages have `react` and `react-dom` (18 or 19) as peers.

## Releasing

```bash
git tag agent-v0.1.1 && git push origin agent-v0.1.1      # triggers release.yml
gh workflow run release.yml -f tag=agent-v0.1.1            # or run it by hand for an existing tag
gh release view agent-v0.2.0                               # confirm the .tgz asset
```

Bump the package's `version` in `package.json` before tagging; the tarball
file name comes from it.

## While the repo is private

Release assets on a private repo need authentication, so the URLs above
return 404 to an unauthenticated `pnpm install` (and to Vercel). Until the
repo is public, consumers copy the `.tgz` files into their own repo (for
example `vendor/`) and use `file:vendor/de_canter-apogee-<name>-<version>.tgz` in both
the dependency and the override. apogee-build does this; see its
`vendor/README.md`.

## npm

Packages publish to npm as `@de_canter/apogee-<name>` from the same tags:
`release.yml` runs `pnpm publish --provenance` when the `NPM_TOKEN` repo
secret is set. Once a package is on npm, the tarball URL and the overrides
entry for it go away and a normal dependency works:

```bash
pnpm add @de_canter/apogee-kernel
```

Publish in dependency order (kernel, ai, prompts, agent, agent-react,
artifacts, rules, documents-ai, knowledge, integrations): `pnpm publish`
rewrites `workspace:*` to the real version, which must already be on npm.
