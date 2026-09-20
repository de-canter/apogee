# @de_canter/apogee-ai

One model client for every AI call in an Apogee product. Vision and PDF input,
structured output validated by Zod, prompt caching on by default, models chosen
by role, and a usage ledger that prices cache tokens. Spec:
`docs/design/ai-abstractions.md` §3.1.

## Rule

No package and no host constructs the Anthropic SDK client. `createAnthropicModelClient`
in this package is the only place that does. Everything else takes a `ModelClient`.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Client | `createAnthropicModelClient({ apiKey?, resolveModel?, catalog?, usageSink?, maxRetries? })` | the real client; `sdk` can be injected for tests |
| Generate | `client.generate({ model?: role, system, messages, tools?, effort?, thinking?, cache? })` | text plus tool uses, priced usage, refusal as `RefusalError` |
| Structured | `client.generateObject(zodSchema, request)` | `output_config.format` json_schema, validated; `StructuredOutputError` carries the raw text |
| Stream | `for await (const ev of client.stream(request))` | `text_delta`, `tool_use_start/delta/end`, `message_end`, `error` |
| Roles | `staticResolver(map)`, `DEFAULT_ROLE_MAP` | ask for `default`, `fast`, `vision`, or your own role; the host maps roles to models |
| Catalog | `createCatalog(overrides?)`, `catalog.costOf(model, usage)` | current models, context and output limits, USD per MTok including cache read and write |
| Usage | `client.usage.total()`, `.byModel()`, `.records()`, `UsageSink` | every call recorded with role, operation, label, and cost |
| Content | `Message`, `ContentBlock` (`text`, `image`, `document`) | vision and PDF-native requests through the same client |
| Errors | `AiError` and subclasses, `mapSdkError` | `retryable` flag; rate limit, overloaded, context too long, invalid request, auth, refusal, structured output |
| Fake | `createFakeModelClient(script)` | scripted turns for downstream tests; validates `generateObject` turns against the schema |

## Defaults

- Adaptive thinking is on unless `thinking: false`.
- `cache_control` goes on the last system block (or the block marked `cache: true`) and on the last tool.
- `max_tokens` 16000 for `generate`, 64000 for `stream`, 4096 for `generateObject`.
- Retries: 2, backoff 500ms doubling, only on retryable errors. The SDK's own retries are disabled.
- Role map: `default` and `vision` → `claude-opus-5`, `fast` → `claude-haiku-4-5`.

## Example

```ts
import { createAnthropicModelClient, staticResolver } from '@de_canter/apogee-ai';
import { z } from 'zod';

const client = createAnthropicModelClient({
  resolveModel: staticResolver({ default: 'claude-opus-5', fast: 'claude-haiku-4-5', extraction: 'claude-sonnet-5' }),
  usageSink: (r) => db.usage.insert(r),
});

const { value } = await client.generateObject(
  z.object({ vendor: z.string(), customer: z.string() }),
  { model: 'extraction', messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', mediaType: 'application/pdf', data: pdf } }, { type: 'text', text: 'Extract the parties.' }] }] },
);
```
