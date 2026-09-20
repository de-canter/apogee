import { defineTool, type AnyTool, type ArtifactDescriptor, type ToolResult } from '@de_canter/apogee-agent';
import { StructuredOutputError } from '@de_canter/apogee-ai';
import { nowIso, type Ref } from '@de_canter/apogee-kernel';
import { z } from 'zod';
import type { RuleAuditSink } from './audit';
import { detectConflicts } from './conflicts';
import type { DimensionShape } from './dimensions';
import { RulesError } from './errors';
import { confirmRule, parseRule, rejectRule, type ParsedRule } from './parse';
import { requireClient, type RuleEngineOptions } from './prompts';
import { RULE_LIMITS, ruleSchema, type Rule } from './rule';
import { simulate } from './simulate';
import type { RuleStore } from './store';
import { validateRule, type RuleDiagnostic } from './validate';

export interface RuleToolsOptions<TCtx, S extends DimensionShape> {
  /** `client` is required for propose_rule and AI conflict checks. */
  engine: RuleEngineOptions<S>;
  store: RuleStore<S>;
  audit?: RuleAuditSink;
  actorFromCtx: (ctx: TCtx) => Ref;
  scopeFromCtx?: (ctx: TCtx) => Ref | undefined;
  sessionIdFromCtx?: (ctx: TCtx) => string | undefined;
  /** Called after any store change; wire it to a loader's invalidate(). */
  onChange?: () => void;
}

export interface RuleToolSet<TCtx, S extends DimensionShape> {
  tools: AnyTool<TCtx>[];
  /** Pending proposals keyed by assertion id, until confirmed or rejected. */
  proposals: Map<string, ParsedRule<S>>;
}

export const RULE_CARD = 'rule-card';
export const RULE_PROPOSAL_CARD = 'rule-proposal';

const EditsSchema = z.object({
  name: z.string().min(1).max(RULE_LIMITS.nameMax).optional(),
  instruction: z.string().min(1).optional(),
  priority: z.number().int().min(RULE_LIMITS.priorityMin).max(RULE_LIMITS.priorityMax).optional(),
  category: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
type Edits = z.infer<typeof EditsSchema>;

const ListInput = z.object({ category: z.string().optional(), includeDisabled: z.boolean().optional().describe('Also show disabled rules') });
const ProposeInput = z.object({ text: z.string().min(1).describe("The rule in the administrator's words"), categoryHint: z.string().optional() });
const ConfirmInput = z.object({ assertionId: z.string().min(1), edits: EditsSchema.optional() });
const RejectInput = z.object({ assertionId: z.string().min(1), reason: z.string().optional() });
const ToggleInput = z.object({ ruleId: z.string().min(1), enabled: z.boolean() });
const DeleteInput = z.object({ ruleId: z.string().min(1) });
const SimulateInput = z.object({ facts: z.record(z.string(), z.unknown()), subject: z.record(z.string(), z.unknown()).optional().describe('Optional data to run structured checks against') });
const ConflictsInput = z.object({ ai: z.boolean().optional().describe('Also ask the model about contradictory instructions') });

function ruleCard<S extends DimensionShape>(rule: Rule<S>, toolUseId: string): ArtifactDescriptor {
  return {
    type: RULE_CARD,
    id: `rule-${rule.id}-${toolUseId}`,
    data: {
      ruleId: rule.id, name: rule.name, description: rule.description, category: rule.category, priority: rule.priority, enabled: rule.enabled, version: rule.version,
      conditions: rule.conditions, instruction: rule.instruction, suggestedActions: rule.suggestedActions, structuredChecks: rule.structuredChecks,
      provenance: rule.provenance,
    },
  };
}

function ruleSummary<S extends DimensionShape>(r: Rule<S>): Record<string, unknown> {
  return { id: r.id, name: r.name, category: r.category, priority: r.priority, enabled: r.enabled, conditions: r.conditions, instruction: r.instruction };
}

const fail = (error: string): ToolResult => ({ success: false, error });
const errorMessage = (e: unknown): string => {
  if (e instanceof StructuredOutputError) return `Structured output did not match the rule schema: ${e.message}`;
  if (e instanceof RulesError || e instanceof Error) return e.message;
  return String(e);
};

/** The administrator's tool set for `@de_canter/apogee-agent`: propose (parse), confirm, reject, list, toggle, delete, simulate, check conflicts. */
export function ruleTools<TCtx, S extends DimensionShape>(opts: RuleToolsOptions<TCtx, S>): RuleToolSet<TCtx, S> {
  const { engine, store, audit } = opts;
  const proposals = new Map<string, ParsedRule<S>>();
  const now = engine.now ?? nowIso;
  const changed = (): void => opts.onChange?.();

  const record = async (ctx: TCtx, rule: Rule<S>, trigger: string, action: string, metadata?: Record<string, unknown>): Promise<void> => {
    if (!audit) return;
    const sessionId = opts.sessionIdFromCtx?.(ctx);
    await audit.record({
      ruleId: rule.id, ruleName: rule.name, category: rule.category, trigger, action, actor: opts.actorFromCtx(ctx),
      ...(sessionId !== undefined ? { sessionId } : {}), ...(metadata ? { metadata } : {}),
    });
  };

  const listRules = defineTool<TCtx, z.infer<typeof ListInput>>({
    name: 'list_rules',
    description: 'List the business rules currently in effect, optionally by category. Shows one card per rule. Call it before changing rules so you know what exists.',
    input: ListInput,
    async execute(input, { toolUseId }) {
      const rules = (await store.list()).filter((r) => (input.includeDisabled || r.enabled) && (input.category === undefined || r.category === input.category));
      return { success: true, message: `${rules.length} rule(s).`, data: rules.map(ruleSummary), artifacts: rules.map((r) => ruleCard(r, toolUseId)) };
    },
  });

  const proposeRule = defineTool<TCtx, z.infer<typeof ProposeInput>>({
    name: 'propose_rule',
    description: 'Turn a natural-language description of a business rule into a structured proposal. The proposal is NOT active until the administrator confirms it with confirm_rule; tell the user to review the card. Pass the user\'s wording as text.',
    input: ProposeInput,
    async execute(input, { ctx, toolUseId }) {
      let parsed: ParsedRule<S>;
      try {
        requireClient(engine, 'propose_rule');
        const scope = opts.scopeFromCtx?.(ctx);
        parsed = await parseRule(input.text, engine, { ...(input.categoryHint !== undefined ? { categoryHint: input.categoryHint } : {}), ...(scope ? { scope } : {}), label: 'rules:propose' });
      } catch (e) {
        return fail(errorMessage(e));
      }
      const validation = await validateRule(parsed.rule, engine, { others: await store.list() });
      proposals.set(parsed.assertion.id, parsed);
      const data = {
        assertionId: parsed.assertion.id, rule: parsed.rule, confidence: parsed.confidence, confidenceLevel: parsed.confidenceLevel,
        ambiguities: parsed.ambiguities, summary: parsed.summary, diagnostics: validation.diagnostics,
      };
      return {
        success: true,
        message: `${parsed.summary} Confidence ${parsed.confidenceLevel}. The proposal is pending: the administrator confirms it with confirm_rule (assertionId ${parsed.assertion.id}) or rejects it with reject_rule.`,
        data,
        artifact: { type: RULE_PROPOSAL_CARD, id: `proposal-${parsed.assertion.id}`, data: { ...data, toolUseId } },
      };
    },
  });

  const applyEdits = (rule: Rule<S>, edits: Edits | undefined): Rule<S> => {
    if (!edits) return rule;
    const { name, instruction, priority, category, enabled } = edits;
    return ruleSchema(engine.dims).parse({
      ...rule,
      ...(name !== undefined ? { name } : {}), ...(instruction !== undefined ? { instruction } : {}), ...(priority !== undefined ? { priority } : {}),
      ...(category !== undefined ? { category } : {}), ...(enabled !== undefined ? { enabled } : {}),
    });
  };

  const confirmTool = defineTool<TCtx, z.infer<typeof ConfirmInput>>({
    name: 'confirm_rule',
    description: 'Activate a pending proposal from propose_rule, optionally with edits. Only call this when the administrator has explicitly confirmed (a card action or a clear yes). Records who confirmed it.',
    input: ConfirmInput,
    async execute(input, { ctx, toolUseId }) {
      const pending = proposals.get(input.assertionId);
      if (!pending) return fail(`No pending proposal ${input.assertionId}`);
      let edited: Rule<S>;
      try {
        edited = applyEdits(pending.rule, input.edits);
      } catch (e) {
        return fail(`Edits rejected: ${errorMessage(e)}`);
      }
      const confirmed = confirmRule({ assertion: pending.assertion, rule: edited }, opts.actorFromCtx(ctx), now());
      await store.upsert(confirmed.rule);
      proposals.delete(input.assertionId);
      await record(ctx, confirmed.rule, 'rule.confirmed', 'confirm_rule');
      changed();
      return { success: true, message: `Rule "${confirmed.rule.name}" is now active (id ${confirmed.rule.id}).`, data: ruleSummary(confirmed.rule), artifact: ruleCard(confirmed.rule, toolUseId) };
    },
  });

  const rejectTool = defineTool<TCtx, z.infer<typeof RejectInput>>({
    name: 'reject_rule',
    description: 'Discard a pending proposal from propose_rule. Only when the administrator declines it.',
    input: RejectInput,
    async execute(input, { ctx }) {
      const pending = proposals.get(input.assertionId);
      if (!pending) return fail(`No pending proposal ${input.assertionId}`);
      rejectRule(pending, opts.actorFromCtx(ctx), now());
      proposals.delete(input.assertionId);
      await record(ctx, pending.rule, 'rule.rejected', 'reject_rule', input.reason !== undefined ? { reason: input.reason } : undefined);
      return { success: true, message: `Proposal "${pending.rule.name}" discarded.` };
    },
  });

  const toggleTool = defineTool<TCtx, z.infer<typeof ToggleInput>>({
    name: 'set_rule_enabled',
    description: 'Enable or disable an existing rule by id.',
    input: ToggleInput,
    async execute(input, { ctx, toolUseId }) {
      const rule = await store.get(input.ruleId);
      if (!rule) return fail(`No rule ${input.ruleId}`);
      const next = await store.upsert({ ...rule, enabled: input.enabled, version: rule.version + 1 });
      await record(ctx, next, 'rule.toggled', 'set_rule_enabled', { enabled: input.enabled });
      changed();
      return { success: true, message: `Rule "${next.name}" ${input.enabled ? 'enabled' : 'disabled'}.`, data: ruleSummary(next), artifact: ruleCard(next, toolUseId) };
    },
  });

  const deleteTool = defineTool<TCtx, z.infer<typeof DeleteInput>>({
    name: 'delete_rule',
    description: 'Delete an existing rule by id. Prefer set_rule_enabled unless the administrator explicitly asks to delete.',
    input: DeleteInput,
    async execute(input, { ctx }) {
      const rule = await store.get(input.ruleId);
      if (!rule) return fail(`No rule ${input.ruleId}`);
      await store.remove(input.ruleId);
      await record(ctx, rule, 'rule.deleted', 'delete_rule');
      changed();
      return { success: true, message: `Rule "${rule.name}" deleted.` };
    },
  });

  const simulateTool = defineTool<TCtx, z.infer<typeof SimulateInput>>({
    name: 'simulate_rules',
    description: `Show which rules would apply for a set of facts, and the prompt section they compile to. Facts are one value per dimension:\n${engine.dims.describe()}`,
    input: SimulateInput,
    async execute(input) {
      const facts = engine.dims.facts.safeParse(input.facts);
      if (!facts.success) return fail(`Invalid facts: ${facts.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      const [result] = simulate(await store.list(), [{ id: 'adhoc', name: 'Ad hoc', facts: facts.data, ...(input.subject ? { subject: input.subject } : {}) }], { dims: engine.dims });
      return {
        success: true,
        message: `${result!.matched.length} of ${result!.totalRulesEvaluated} rule(s) apply.`,
        data: { matched: result!.matched.map((m) => ({ ruleId: m.ruleId, name: m.name, priority: m.priority, ...(m.checks ? { checks: m.checks } : {}) })), compiled: result!.compiled.text },
      };
    },
  });

  const conflictsTool = defineTool<TCtx, z.infer<typeof ConflictsInput>>({
    name: 'check_conflicts',
    description: 'Find rules that collide: identical or nested conditions, priority ties, and (with ai: true) contradictory instructions.',
    input: ConflictsInput,
    async execute(input) {
      try {
        const report = await detectConflicts(await store.list(), engine, { ...(input.ai !== undefined ? { ai: input.ai } : {}), label: 'rules:conflicts' });
        return {
          success: true,
          message: report.summary,
          data: { summary: report.summary, conflicts: report.conflicts.map((c) => ({ id: c.id, type: c.type, severity: c.severity, description: c.description, ruleIds: c.ruleIds, resolutions: c.resolutions })) },
        };
      } catch (e) {
        return fail(errorMessage(e));
      }
    },
  });

  const tools: AnyTool<TCtx>[] = [listRules, proposeRule, confirmTool, rejectTool, toggleTool, deleteTool, simulateTool, conflictsTool];
  return { tools, proposals };
}

export type { RuleDiagnostic };
