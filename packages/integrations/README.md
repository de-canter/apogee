# @de_canter/apogee-integrations

No-code REST integrations for an assistant to run and an administrator to
manage. A pattern says what triggers it, the request it makes (templates
over the host context, the pattern's variables, and vault secrets), how it
authenticates, and how the response maps. The engine runs it through a rate
limit, a circuit breaker, retries with backoff, a dead-letter queue with
real replay, schema-drift detection, optional AI post-processing, and a
traced audit. Inbound webhooks are the mirror: verify the sender, match or
classify the pattern, correlate or map the payload. Spec:
`docs/design/ai-abstractions.md` §3.9.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Pattern | `definePattern`, `IntegrationPatternSchema`, `approvePattern`, `pausePattern`, `resumePattern`, `updatePattern`, `evaluateTrigger` | `draft` → `active` ⇄ `paused`; approval records who; behavior changes return to draft |
| Store | `PatternStore`, `createInMemoryPatternStore` | Persistence port |
| Templates | `interpolate`, `interpolateObject`, `findVaultRefs`, `resolvePath` | `{{ctx.path}}`, `{{vars.name}}`, `{{vault:key}}` |
| Transforms | `TRANSFORMS`, `applyTransform`, `applyMapping` | `to_number`, `date_format`, `lookup`, `regex_extract`, … ; unknown names are errors |
| Vault | `VaultPort`, `createInMemoryVault`, `encryptSecret`, `decryptSecret` | Secrets by key; AES-256-GCM helpers for adapters; values never listed |
| Auth | `AUTH`, `getAuthMethod`, `signJwt`, `verifyJwt`, `maskHeaders`, `redactUrl` | `api_key`, `basic`, `oauth2` (client credentials, cached), `hmac`, `jwt_bearer` (HS256); each injects outbound and verifies inbound |
| Resilience | `createRateLimiter`, `createCircuitBreaker`, `retry`, `createInMemoryDeadLetterQueue`, `fingerprint`, `checkDrift` | Sliding windows; open/half-open with one probe; capped jittered backoff; replay that re-runs; shape fingerprints |
| Execute | `executePattern(pattern, { ctx, subject, event, dryRun }, deps)`, `buildRequest` | Gates, build, dry run or fetch, drift, AI post-processing, mapping, `onOutput`, audit with `X-Request-Id` |
| Audit | `ExecutionAuditSink`, `createInMemoryExecutionAudit` | Traces with masked requests; `health()` per pattern |
| Inbound | `receiveWebhook`, `verifySender`, `matchInbound`, `classifyInbound`, `CorrelationStore` | Sender auth and allowlist; header/body matching; classification as an assertion with thresholds; correlation to pending callbacks |
| Tools | `integrationTools({ store, vault, deps, actorFromCtx })` | Fourteen admin tools for `@de_canter/apogee-agent` |
| Prompts | `integrationsPromptRegistry()` | `integrations.post-process`, `integrations.classify-inbound` |

## Guarantees

- Secrets never leave the vault except into the request: traces, dead letters, tool results, and classification prompts carry masked headers and redacted query strings.
- Every model claim is an `Assertion` with `source.kind = 'ai'` and a confidence; inbound classification below the review threshold executes nothing.
- A pattern runs only while `active`; approval is recorded; resuming needs a prior approval.
- Failures are never silent: retries are counted, the breaker records them, the dead letter keeps the masked request and the context, and replay re-executes.
- No vendor, entity, or field name ships in the package; the host's context, `onOutput`, and `variables` carry all of it.

## Example

```ts
const vault = createInMemoryVault();
await vault.set('mock_api_key', process.env.MOCK_API_KEY!);
const store = createInMemoryPatternStore();
const deps = { vault, audit: createInMemoryExecutionAudit(), deadLetters: createInMemoryDeadLetterQueue(), breaker: createCircuitBreaker(), limiter: createRateLimiter(), engine: { client, domain: 'an equipment rental company' } };

// Admin assistant: patterns through conversation.
const admin = createAgentSession({ sessionId, client, prompt, ctx, tools: integrationTools({ store, vault, deps, actorFromCtx: (c) => ref('User', c.manager) }) });

// A host event runs the active patterns for it.
for (const p of await store.list({ status: 'active', direction: 'outbound' })) await executePattern(p, { ctx: rental, event: 'rental.created', subject: ref('Rental', rental.id) }, { ...deps, onOutput: (o) => saveWeather(rental.id, o) });

// A webhook route.
const result = await receiveWebhook({ sender: courier, headers, rawBody, sourceIp }, { patterns: store, vault, ...deps });
```
