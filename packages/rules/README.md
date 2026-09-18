# @apogee/rules

Natural-language business rules for an AI assistant: the host declares what a
rule can condition on, an administrator describes a rule in plain language, the
model proposes it as a kernel `Assertion`, the administrator confirms it, and
from then on the rule is injected into the assistant's prompt and evaluated in
two layers. Spec: `docs/design/ai-abstractions.md` §3.6.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Dimensions | `defineDimensions({ event: z.enum([...]), ... })` | The host's condition vocabulary; yields `conditions` and `facts` schemas and a prompt description |
| Rule | `Rule<S>`, `defineRule`, `ruleSchema`, `findMatchingRules`, `matchesConditions` | Conditions typed by the dimensions, instruction, actions, structured checks, priority, kernel `Provenance` |
| Checks | `evaluateChecks`, `resolvePath`, `CheckResult` | Deterministic checks (`exists`, `not_empty`, `eq`, `gt`, `matches`, `min_count`, ...) against a subject object |
| Evaluate | `evaluateGate(rules, engine, { facts, subject })`, `evaluateRule` | Layer 1 conditions and checks; layer 2 one model call over the instructions; `decidedBy` says which layer decided |
| Compile | `compileRules`, `formatRule`, `rulesContributor` | Matching rules as a prompt section; a `@apogee/prompts` contributor for a `rules` slot |
| Parse | `parseRule(text, engine)` → `ParsedRule`, `confirmRule`, `rejectRule` | Natural language to a proposed `Assertion` with confidence and ambiguities; confirmation records who and when |
| Validate | `validateRule`, `validateRules`, `structuralDiagnostics`, `crossRuleDiagnostics` | S0xx structural, C0xx cross-rule, optional A0xx model checks |
| Conflicts | `detectConflicts`, `deterministicConflicts`, `resolutionsFor` | Identical or nested conditions, priority ties, and (with `ai`) contradictory instructions, each with resolutions |
| Suggest | `suggestRules(auditEntries, rules, engine)`, `aggregateAudit` | Off-script actions and low-engagement rules become proposed rules |
| Simulate | `simulate(rules, scenarios, { dims })` | Which rules match a scenario, their checks, the compiled section; no model |
| Store | `RuleStore`, `createInMemoryRuleStore`, `createRuleLoader` | Persistence port; DB-first loader with a TTL cache and a fallback |
| Audit | `RuleAuditSink`, `createInMemoryRuleAudit` | Every rule firing and every admin decision, queryable |
| Tools | `ruleTools({ engine, store, audit, actorFromCtx })` | Admin tool set for `@apogee/agent`: propose, confirm, reject, list, toggle, delete, simulate, check conflicts |
| Prompts | `rulesPromptRegistry()`, `RULE_PARSER_PROMPT`, ... | The five registered prompts this package sends |

## Guarantees

- The deterministic layer always runs first; the model is consulted only when no error-severity check failed and a client is configured. Model errors propagate: a gate never fails open silently.
- Everything the model produces that a human might overrule (a parsed rule, a suggested rule) is a kernel `Assertion` with `source.kind = 'ai'` and a confidence; `confirmRule` records the decision in provenance.
- No domain vocabulary ships in the package. Dimensions, categories, the domain phrase, triggers, and the subject shape all come from the host.
- Every prompt is a `definePrompt` with a name and version; `rulesPromptRegistry()` exposes them for a central registry.
- Tests run against `createFakeModelClient`; its `generateObject` validates scripted objects against the same schemas the real client uses.

## Example

```ts
const dims = defineDimensions({
  event: z.enum(['rental.created', 'rental.returned']),
  rentalTier: z.enum(['standard', 'high-value']).describe('high-value when the total is $2,000 or more'),
});
const engine = { dims, client, domain: 'an equipment rental company', categories: ['desk', 'gate'] };
const store = createInMemoryRuleStore<typeof dims.shape>();
const loader = createRuleLoader({ store, fallback: () => seedRules });

// Admin assistant: an agent session with the rule tools and memory.
const { tools } = ruleTools({ engine, store, audit, actorFromCtx: (c) => ref('User', c.manager), onChange: () => loader.invalidate() });
const admin = createAgentSession({ sessionId, client, prompt: adminPrompt, tools: [...tools, memoryTool(...)], ctx });

// Desk assistant: the same rules, injected into its prompt.
const desk = createAgentSession({
  sessionId, client, prompt: deskPrompt, tools: deskTools, ctx,
  contributors: { rules: rulesContributor({ rules: () => loader.rules(), factsFromCtx: (c) => ({ rentalTier: tierOf(c) }) }) },
});

// Gate: structured checks, then the instructions.
const gate = await evaluateGate(await loader.rules(), engine, { facts: { event: 'rental.created', rentalTier: 'high-value' }, subject: rental });
if (!gate.passed) console.log(gate.errors, gate.ai?.findings);
```
