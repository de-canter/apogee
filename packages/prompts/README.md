# @de_canter/apogee-prompts

Named, versioned prompts composed from sections. One way to store prompts
instead of six. Spec: `docs/design/ai-abstractions.md` §3.2.

## Sections

| Helper | Stable by default | Use for |
|---|---|---|
| `text(id, str)` | yes | identity, capabilities, domain knowledge |
| `fromContext(id, ctx => string)` | no | tenant, jurisdiction, current state |
| `slot(id, slotName)` | no | content another package contributes: behavior rules, retrieved knowledge, config memory |

`stable: true` means "identical for every request", so it can sit in the
cached prefix. Pass `{ stable: true }` to `fromContext` when the rendered
text is the same across a session (a tenant's fixed configuration).

## The boundary rule

`composePrompt` renders sections in declaration order, drops empty ones, and
places one cache breakpoint at the end of the leading run of stable blocks.
Stable sections declared after a volatile one are not cached, because prompt
caching is a prefix match. Put everything stable first.

```ts
const assistant = definePrompt<Ctx>({
  name: 'assistant', version: '1.0.0',
  sections: [
    text('identity', 'You are the Acme assistant.'),
    text('capabilities', '...'),
    fromContext('tenant', (c) => `Tenant: ${c.tenantName}`, { stable: true }),
    slot('rules', 'behavior-rules'),
    slot('knowledge', 'retrieved-knowledge'),
    fromContext('now', (c) => `Current time: ${c.now}`),
  ],
});

const composed = await composePrompt(assistant, ctx, { contributors: { 'behavior-rules': rulesContributor } });
await client.generate({ system: toSystemBlocks(composed), messages });
```

## Registry and overrides

`createPromptRegistry()` holds versions by name; `get(name)` returns the latest.
`overrideSection(prompt, id, text)` and `applyOverrides(prompt, storedDoc)` let a
product keep tenant overrides in its database and merge them at compose time.
`PromptOverrideSchema` validates the stored document.

## Evals

`evalPrompt(prompt, cases, { client, judge?, role? })` composes each case,
calls the client, scores the output (default: substring judge), and reports
the mean score and total cost. Use `createFakeModelClient` from `@de_canter/apogee-ai`
in tests; a real client spends money.
