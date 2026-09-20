import type { Usage } from '@apogee/ai';
import { assertion, nowIso, type Assertion, type ISODate, type Ref } from '@apogee/kernel';
import { composePrompt, toSystemBlocks } from '@apogee/prompts';
import { getAuthMethod, maskHeaders } from './auth';
import type { ExecutionAuditSink, ExecutionRecordInput } from './audit';
import type { AuthMethodName, IntegrationPattern, PatternStore } from './pattern';
import { CLASSIFY_INBOUND_PROMPT, ClassificationSchema, DEFAULT_DOMAIN, type IntegrationEngineOptions } from './prompts';
import type { DeadLetterQueue } from './resilience';
import { resolvePath } from './template';
import { applyMapping } from './transforms';
import type { VaultPort } from './vault';

/** Who may post to a webhook and how they prove it. */
export interface SenderConfig {
  id: string;
  auth?: { method: AuthMethodName; vaultKey: string; config?: Record<string, unknown> };
  ipAllowlist?: string[];
  /** Restrict candidate patterns; default every active inbound pattern. */
  patternIds?: string[];
}

export interface InboundRequestInput { headers: Record<string, string>; rawBody: string; sourceIp?: string }

export async function verifySender(sender: SenderConfig, req: InboundRequestInput, vault: VaultPort): Promise<{ valid: boolean; identity?: string; error?: string }> {
  if (sender.ipAllowlist && sender.ipAllowlist.length > 0 && (req.sourceIp === undefined || !sender.ipAllowlist.includes(req.sourceIp))) {
    return { valid: false, error: `Source IP ${req.sourceIp ?? 'unknown'} is not allowed for sender ${sender.id}` };
  }
  if (!sender.auth) return { valid: true };
  const secret = await vault.get(sender.auth.vaultKey);
  if (secret === undefined) return { valid: false, error: `No vault entry ${sender.auth.vaultKey} for sender ${sender.id}` };
  return getAuthMethod(sender.auth.method).verify({ headers: req.headers, rawBody: req.rawBody }, secret, sender.auth.config ?? {}, { fetch: globalThis.fetch, now: () => Date.now() });
}

const headerValue = (headers: Record<string, string>, name: string): string | undefined => {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return v;
  return undefined;
};

/** Active inbound patterns whose declared headers and body fields all match; patterns with no match config never match here. */
export function matchInbound(patterns: readonly IntegrationPattern[], headers: Record<string, string>, payload: unknown): IntegrationPattern[] {
  return patterns.filter((p) => {
    if (p.direction !== 'inbound' || p.status !== 'active' || !p.inbound) return false;
    const heads = Object.entries(p.inbound.matchHeaders);
    const fields = Object.entries(p.inbound.matchBodyFields);
    if (heads.length === 0 && fields.length === 0) return false;
    return heads.every(([k, v]) => headerValue(headers, k) === v) && fields.every(([k, v]) => JSON.stringify(resolvePath(payload, k)) === JSON.stringify(v));
  });
}

export const CLASSIFY_SOURCE = `${CLASSIFY_INBOUND_PROMPT.name}@${CLASSIFY_INBOUND_PROMPT.version}`;
export const DEFAULT_MAX_PAYLOAD_CHARS = 2000;

export interface InboundClassification { pattern?: IntegrationPattern; confidence: number; reasoning: string; assertion: Assertion; usage: Usage }

/** Ask the model which candidate an unmatched payload belongs to. Headers are masked first; the payload is truncated. */
export async function classifyInbound(
  candidates: readonly IntegrationPattern[],
  headers: Record<string, string>,
  payload: unknown,
  engine: IntegrationEngineOptions,
  opts: { subject?: Ref; label?: string; maxPayloadChars?: number } = {},
): Promise<InboundClassification> {
  if (!engine.client) throw new Error('classifyInbound needs a model client');
  const max = opts.maxPayloadChars ?? DEFAULT_MAX_PAYLOAD_CHARS;
  const text = JSON.stringify(payload, null, 2);
  const truncated = text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
  const composed = await composePrompt(CLASSIFY_INBOUND_PROMPT, { domain: engine.domain ?? DEFAULT_DOMAIN });
  const user = [
    'Candidate patterns:',
    ...candidates.map((p) => `- ${p.id}: ${p.name}${p.description ? ` — ${p.description}` : ''}`),
    '',
    'Headers:',
    JSON.stringify(maskHeaders(headers), null, 2),
    '',
    'Payload:',
    truncated,
  ].join('\n');
  const { value, usage } = await engine.client.generateObject(
    ClassificationSchema,
    { model: engine.model ?? 'default', system: toSystemBlocks(composed), messages: [{ role: 'user', content: user }], maxTokens: 500 },
    { ...(opts.label !== undefined ? { label: opts.label } : {}) },
  );
  const pattern = value.patternId === null ? undefined : candidates.find((p) => p.id === value.patternId);
  const recordedAt = (engine.now ?? nowIso)();
  const a = assertion({
    id: crypto.randomUUID(),
    subject: opts.subject ?? { kind: 'Webhook', id: crypto.randomUUID() },
    predicate: 'matches-pattern',
    object: { patternId: pattern?.id ?? null, reasoning: value.reasoning },
    provenance: { source: { kind: 'ai', name: CLASSIFY_SOURCE }, method: 'classifyInbound', confidence: value.confidence, recordedAt },
  });
  return { ...(pattern ? { pattern } : {}), confidence: value.confidence, reasoning: value.reasoning, assertion: a, usage };
}

export interface Correlation {
  id: string;
  patternId: string;
  /** Payload path that must echo the correlation id. */
  field: string;
  subject?: Ref;
  createdAt: ISODate;
  expiresAt: ISODate;
  status: 'pending' | 'matched' | 'expired' | 'cancelled';
  matchedAt?: ISODate;
  payload?: unknown;
  onTimeout: 'retry' | 'escalate' | 'dead_letter';
}

export interface CorrelationStore {
  create(input: { patternId: string; field: string; subject?: Ref; timeoutMs: number; onTimeout: Correlation['onTimeout'] }): Promise<Correlation>;
  /** The pending correlation whose field the payload echoes. */
  match(payload: unknown, patternId?: string): Promise<Correlation | undefined>;
  complete(id: string, payload: unknown): Promise<Correlation | undefined>;
  cancel(id: string): Promise<boolean>;
  /** Marks pending correlations past their expiry and returns them. */
  expire(at?: ISODate): Promise<Correlation[]>;
  list(filter?: { patternId?: string; status?: Correlation['status'] }): Promise<Correlation[]>;
}

export function createInMemoryCorrelationStore(opts: { now?: () => ISODate } = {}): CorrelationStore {
  const now = opts.now ?? nowIso;
  const items = new Map<string, Correlation>();
  const clone = (c: Correlation): Correlation => structuredClone(c);
  return {
    create(input) {
      const at = now();
      const c: Correlation = { id: crypto.randomUUID(), patternId: input.patternId, field: input.field, ...(input.subject ? { subject: input.subject } : {}), createdAt: at, expiresAt: new Date(new Date(at).getTime() + input.timeoutMs).toISOString() as ISODate, status: 'pending', onTimeout: input.onTimeout };
      items.set(c.id, c);
      return Promise.resolve(clone(c));
    },
    match(payload, patternId) {
      for (const c of items.values()) {
        if (c.status !== 'pending' || (patternId !== undefined && c.patternId !== patternId)) continue;
        const v = resolvePath(payload, c.field);
        if (typeof v === 'string' && v === c.id) return Promise.resolve(clone(c));
      }
      return Promise.resolve(undefined);
    },
    complete(id, payload) {
      const c = items.get(id);
      if (!c || c.status !== 'pending') return Promise.resolve(undefined);
      c.status = 'matched';
      c.matchedAt = now();
      c.payload = payload;
      return Promise.resolve(clone(c));
    },
    cancel(id) {
      const c = items.get(id);
      if (!c || c.status !== 'pending') return Promise.resolve(false);
      c.status = 'cancelled';
      return Promise.resolve(true);
    },
    expire(at) {
      const cutoff = at ?? now();
      const out: Correlation[] = [];
      for (const c of items.values()) {
        if (c.status === 'pending' && c.expiresAt <= cutoff) {
          c.status = 'expired';
          out.push(clone(c));
        }
      }
      return Promise.resolve(out);
    },
    list: (filter = {}) => Promise.resolve([...items.values()].filter((c) => (filter.patternId === undefined || c.patternId === filter.patternId) && (filter.status === undefined || c.status === filter.status)).map(clone)),
  };
}

export interface InboundInput extends InboundRequestInput {
  sender: SenderConfig;
  /** Name the pattern instead of matching or classifying. */
  patternId?: string;
  subject?: Ref;
  label?: string;
}

export interface InboundDeps {
  patterns: PatternStore;
  vault: VaultPort;
  audit?: ExecutionAuditSink;
  deadLetters?: DeadLetterQueue;
  correlations?: CorrelationStore;
  engine?: IntegrationEngineOptions;
  /** Classification below deadLetterBelow is dead-lettered; below reviewBelow is returned for review; otherwise executed. */
  thresholds?: { deadLetterBelow?: number; reviewBelow?: number };
  onOutput?: (output: Record<string, unknown>, pattern: IntegrationPattern, input: InboundInput) => Promise<void> | void;
}

export const DEFAULT_THRESHOLDS = { deadLetterBelow: 0.75, reviewBelow: 0.95 };

export type InboundAction = 'executed' | 'classified' | 'needs_review' | 'correlated' | 'dead_lettered' | 'rejected';

export interface InboundResult {
  action: InboundAction;
  traceId: string;
  patternId?: string;
  classification?: { assertion: Assertion; confidence: number; reasoning: string };
  output?: Record<string, unknown>;
  correlationId?: string;
  error?: string;
}

/** Verify the sender, find the pattern (named, matched, or classified), then correlate or map the payload. */
export async function receiveWebhook(input: InboundInput, deps: InboundDeps): Promise<InboundResult> {
  const engine = deps.engine ?? {};
  const clock = engine.clock ?? (() => Date.now());
  const started = clock();
  const traceId = crypto.randomUUID();
  const thresholds = { ...DEFAULT_THRESHOLDS, ...deps.thresholds };
  const audit = async (patternId: string, extra: Partial<ExecutionRecordInput> = {}): Promise<void> => {
    if (!deps.audit) return;
    await deps.audit.record({ traceId, patternId, direction: 'inbound', status: 'inbound', latencyMs: clock() - started, attempts: 1, aiProcessed: false, request: { method: 'POST', url: `webhook:${input.sender.id}`, headers: maskHeaders(input.headers) }, ...(input.subject ? { subject: input.subject } : {}), ...extra });
  };
  const reject = async (error: string, patternId = 'unmatched'): Promise<InboundResult> => {
    await audit(patternId, { error, metadata: { action: 'rejected' } });
    return { action: 'rejected', traceId, error };
  };

  const verified = await verifySender(input.sender, input, deps.vault);
  if (!verified.valid) return reject(verified.error ?? 'Sender verification failed');

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    return reject('Body is not valid JSON');
  }

  const all = (await deps.patterns.list({ direction: 'inbound', status: 'active' })).filter((p) => !input.sender.patternIds || input.sender.patternIds.includes(p.id));
  let pattern: IntegrationPattern | undefined;
  let classification: InboundResult['classification'];
  let action: InboundAction = 'executed';

  if (input.patternId !== undefined) {
    pattern = all.find((p) => p.id === input.patternId);
    if (!pattern) return reject(`Pattern ${input.patternId} is not an active inbound pattern for sender ${input.sender.id}`, input.patternId);
  } else {
    pattern = matchInbound(all, input.headers, payload).sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!pattern) {
      if (!engine.client || all.length === 0) {
        await deps.deadLetters?.enqueue({ source: 'inbound_unmatched', payload, metadata: { sender: input.sender.id, traceId, headers: maskHeaders(input.headers) }, error: 'No pattern matched' });
        await audit('unmatched', { error: 'No pattern matched', metadata: { action: 'dead_lettered' } });
        return { action: 'dead_lettered', traceId, error: 'No pattern matched' };
      }
      const c = await classifyInbound(all, input.headers, payload, engine, { ...(input.subject ? { subject: input.subject } : {}), ...(input.label !== undefined ? { label: input.label } : {}) });
      classification = { assertion: c.assertion, confidence: c.confidence, reasoning: c.reasoning };
      if (!c.pattern || c.confidence < thresholds.deadLetterBelow) {
        await deps.deadLetters?.enqueue({ source: 'inbound_low_confidence', ...(c.pattern ? { patternId: c.pattern.id } : {}), payload, metadata: { sender: input.sender.id, traceId, confidence: c.confidence, reasoning: c.reasoning }, error: `Low confidence match: ${Math.round(c.confidence * 100)}%` });
        await audit(c.pattern?.id ?? 'unmatched', { error: `Low confidence match: ${Math.round(c.confidence * 100)}%`, aiProcessed: true, metadata: { action: 'dead_lettered', confidence: c.confidence } });
        return { action: 'dead_lettered', traceId, ...(c.pattern ? { patternId: c.pattern.id } : {}), classification, error: `Low confidence match: ${Math.round(c.confidence * 100)}%` };
      }
      pattern = c.pattern;
      if (c.confidence < thresholds.reviewBelow) {
        await audit(pattern.id, { aiProcessed: true, metadata: { action: 'needs_review', confidence: c.confidence } });
        return { action: 'needs_review', traceId, patternId: pattern.id, classification };
      }
      action = 'classified';
    }
  }

  if (deps.correlations && pattern.inbound?.correlationField !== undefined) {
    const hit = await deps.correlations.match(payload, pattern.id);
    if (hit) {
      await deps.correlations.complete(hit.id, payload);
      await audit(pattern.id, { metadata: { action: 'correlated', correlationId: hit.id } });
      return { action: 'correlated', traceId, patternId: pattern.id, correlationId: hit.id, ...(classification ? { classification } : {}) };
    }
  }

  const output = applyMapping(payload, pattern.inbound?.mapping ?? []);
  await deps.onOutput?.(output, pattern, input);
  await audit(pattern.id, { response: { output }, ...(classification ? { aiProcessed: true } : {}), metadata: { action } });
  return { action, traceId, patternId: pattern.id, output, ...(classification ? { classification } : {}) };
}
