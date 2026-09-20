# B3 kickoff notes — `@de_canter/apogee-rules` (behavior engine lift)

**Created:** 2026-09-18, written before a context compaction so the survey facts survive.
**Spec:** `docs/design/ai-abstractions.md` §3.6. **Prerequisites:** B1, B2 merged (ai 0.2.0, prompts 0.1.1, agent 0.1.0, kernel 0.1.0).

## Source in the reference product

Survey 2026-09-18: ~7,900 LOC non-test across ~22 files; the cleanest extraction in the repo.

- Types: `packages/shared/src/types/behavior-rules.ts` (710) — `BehaviorRule`, `RuleConditions`, `BehaviorAuditEntry`, `CompiledPromptSection`, `PromptCompilerContext`, `NLRuleParseResult`, `RuleDiagnostic`, `RuleValidationResult`, `TestScenario`, `SimulationResult`, `StructuredCheck`, `GateCheckOperator`, `GateEvaluationResult`, `RuleConflict`, `ConflictReport`, suggestion types.
- Schemas: `packages/database/src/schemas/behavior-rule.schema.ts` (187), `behavior-audit.schema.ts` (180), `test-scenario.schema.ts`.
- Static fallback rules: `apps/api/src/config/behavior-rules.ts` (451).
- Services (`apps/api/src/services/`): `behavior-rule-loader.ts` (400, DB-first with 30s TTL + file fallback + fs-watch hot reload), `behavior-audit-service.ts` (314), `nl-rule-parser-service.ts` (246, NL → rule via Claude, returns `{ rule, confidence, ambiguities[] }`), `rule-validator-service.ts` (586), `rule-conflict-service.ts` (428), `rule-suggestion-service.ts` (415, from audit log), `rule-simulation-service.ts` (199), `gate-evaluation-service.ts` (316, structured checks first then optional LLM on `instruction`), `behavior-rule-import-export-service.ts`; non-LLM consumers `workflow-rule-engine.ts`, `compliance-rule-engine.ts`, `notification-rule-engine.ts`.
- Compiler: `apps/api/src/chat/prompt-compiler.ts` (274) — "compilation" = markdown section injected into the system prompt (`compile(context)`, `formatRule`).
- Tools: `chat/tools/behavior-rule-tools.ts` (371), `admin-behavior-rule-tools.ts` (325), `admin-gate-rule-tools.ts` (273).
- Routes: `routes/admin/behavior-rules.ts` (625), `routes/admin/rule-simulation.ts` (273), `routes/behavior-audit.ts` (224).
- Rule shape: `{ ruleId, name, category: document|workflow|task|notification|validation|compliance|gate, conditions, instruction, suggestedActions, defaultAction, gate?, structuredChecks[], priority, enabled, version, companyId, isSystem, publishedFromEnterpriseId }`.
- Every LLM call there uses `@anthropic-ai/sdk` directly with `systemDefaultsService.getDefaultValue('ai','defaultModel')`; all become `@de_canter/apogee-ai` roles.

## What is product-specific (and how to remove it)

Only the enum vocabularies inside `RuleConditions` (`documentType`, `orderStatus`, `transactionType`, `workflowState`) and the parser prompt's product-specific system description that interpolates `RuleCategory`/`OrderStatus` from the product's shared package. Replace with `defineDimensions({ documentType: z.enum([...]), status: ... })` supplied by the host; generate the parser prompt, validator, and evaluator from the dimensions.

## Package design (from spec §3.6)

- `Rule` shape as above with `conditions` typed by host dimensions and kernel `Provenance`.
- `parseRule(text)` → kernel `Assertion` (object: `Rule`, provenance ai + confidence + ambiguities); admin confirms.
- `validateRule`, `detectConflicts(rules)`, `suggestRules(auditLog)` through `@de_canter/apogee-ai` `generateObject` with registered prompts (`@de_canter/apogee-prompts`).
- `evaluate(rule, facts)`: structured checks (deterministic) then LLM instruction; result says which layer decided.
- `compileRulesSection(rules, context)`: a prompts `Contributor` for the agent's `rules` slot.
- `simulate(rule, scenarios)`, `RuleAudit` sink, `RuleStore` port with DB-first/file-fallback loader.
- Demo (apogee.build): admin assistant = `@de_canter/apogee-agent` + rule tools + memory on the rental domain: "when a rental over $2,000 is created, require a deposit note".

## Toolchain reminders

Same package shape as `packages/agent` (tsup, vitest, `@types/node`), tests with `createFakeModelClient` (its `generateObject` validates scripted objects against the schema). ESLint: `ignoreRestSiblings` on; `import type` for type-only imports; no `any`.
