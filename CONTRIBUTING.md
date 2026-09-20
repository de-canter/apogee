# Contributing to Apogee

Apogee is developed by de|canter and runs in production inside its operating
companies' products. Outside contributions are welcome, within the rules below.

## Before you start

- **Bug reports and questions:** open an issue.
- **Small fixes** (bugs, types, docs, tests): open a pull request directly.
- **Anything that adds a surface or changes a guarantee:** open an issue
  first. Every package README has a surface table and a guarantees list. A
  change to either is a design decision, and we would rather talk before you
  write code.

## Ground rules

The principles in the README are not negotiable in a pull request:

- Domain vocabulary is injected by the host, never declared by a package.
  A package that ships a product's enum will not be merged.
- Nothing constructs the Anthropic SDK except `@de_canter/apogee-ai`.
- Anything a model produces that a person might overrule enters as an
  `Assertion` with provenance and a confidence.
- Every prompt is registered: name, version, sections.
- Packages define storage ports and ship in-memory implementations. Adapters
  are separate packages.
- Tests never touch the network. Script model turns with
  `createFakeModelClient`.

## Working in the repo

pnpm 9.15.9 and Turborepo. Node 20 or later.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

Run all four unfiltered before every commit. Turbo hides errors when its
output is piped through `grep`.

## Pull requests

- Branch from `main`. One concern per pull request.
- All four checks above pass. New behavior has tests.
- If the package's surface table or guarantees change, update its README in
  the same pull request.
- Commit messages: `type(scope): summary`, where type is one of `feat`,
  `fix`, `refactor`, `test`, `docs`, `chore`.

## License

Apogee is licensed under the Apache License 2.0. By submitting a
contribution you agree that it is licensed under the same terms, as described
in Section 5 of the license. There is no separate contributor agreement.
