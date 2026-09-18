import type { ModelClient, ModelRole } from '@apogee/ai';
import { nowIso, type ISODate } from '@apogee/kernel';
import { composePrompt, definePrompt, text, toSystemBlocks } from '@apogee/prompts';
import { newMessageId, type AgentMessage } from './messages';

export const COMPACTION_PROMPT = definePrompt<Record<string, never>>({
  name: 'agent.compact-history',
  version: '1.0.0',
  sections: [
    text('instructions', `Summarize this conversation history, preserving:
- Key decisions made (what was chosen and why)
- Configuration changes applied (rules created, templates modified)
- Important context and constraints mentioned
- Open questions or pending items
Keep the summary concise but complete enough to continue the conversation.`),
  ],
});

export interface CompactionOptions {
  client: ModelClient;
  budgetTokens?: number;
  thresholdRatio?: number;
  keepRecentPairs?: number;
  estimateTokens?: (text: string) => number;
  role?: ModelRole;
  maxTokens?: number;
  now?: () => ISODate;
}

export const DEFAULT_BUDGET_TOKENS = 80_000;
export const DEFAULT_THRESHOLD_RATIO = 0.7;
export const DEFAULT_KEEP_RECENT_PAIRS = 6;

/** Chars/4 heuristic; hosts may inject a real tokenizer. */
export const estimateTokensByChars = (s: string): number => Math.ceil(s.length / 4);

function messageText(m: AgentMessage): string {
  if (m.blocks && m.blocks.length > 0) {
    return m.blocks.map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : b.type === 'tool_use' ? JSON.stringify(b.input) : '')).join('\n');
  }
  return [m.content, ...(m.annotations ?? [])].join('\n');
}

export function estimateHistoryTokens(history: readonly AgentMessage[], estimate = estimateTokensByChars): number {
  return history.reduce((sum, m) => sum + estimate(messageText(m)), 0);
}

function renderForSummary(m: AgentMessage): string {
  if (m.role === 'summary') return `[Previous Summary]: ${m.content}`;
  return `${m.role === 'user' ? 'User' : 'Assistant'}: ${messageText(m)}`;
}

export interface CompactionResult { history: AgentMessage[]; compacted: boolean; summary?: AgentMessage }

/**
 * When history exceeds the threshold, summarize everything but the most recent
 * pairs into one `summary` message. Prior summaries feed into the new one, so
 * summaries compound instead of accumulating.
 */
export async function compactHistory(history: readonly AgentMessage[], opts: CompactionOptions): Promise<CompactionResult> {
  const budget = opts.budgetTokens ?? DEFAULT_BUDGET_TOKENS;
  const threshold = Math.floor(budget * (opts.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO));
  const keepCount = (opts.keepRecentPairs ?? DEFAULT_KEEP_RECENT_PAIRS) * 2;
  const estimate = opts.estimateTokens ?? estimateTokensByChars;
  const unchanged: CompactionResult = { history: [...history], compacted: false };

  if (estimateHistoryTokens(history, estimate) <= threshold) return unchanged;
  if (history.length <= keepCount) return unchanged;

  const older = history.slice(0, history.length - keepCount);
  const recent = history.slice(history.length - keepCount);
  const conversation = older.map(renderForSummary).join('\n\n');
  const composed = await composePrompt(COMPACTION_PROMPT, {});
  const r = await opts.client.generate(
    {
      ...(opts.role !== undefined ? { model: opts.role } : { model: 'fast' }),
      system: toSystemBlocks(composed),
      messages: [{ role: 'user', content: `Here is the conversation history to summarize:\n\n${conversation}` }],
      maxTokens: opts.maxTokens ?? 2048,
    },
    { label: 'agent:compact-history' },
  );
  if (r.text.trim() === '') return unchanged;
  const summary: AgentMessage = { id: newMessageId(), role: 'summary', content: r.text.trim(), usage: r.usage, at: (opts.now ?? nowIso)() };
  return { history: [summary, ...recent], compacted: true, summary };
}

/** Secondary guard: drop oldest message pairs until under the hard budget. */
export function pruneToBudget(history: readonly AgentMessage[], budgetTokens: number, estimate = estimateTokensByChars): AgentMessage[] {
  const out = [...history];
  while (out.length > 0 && estimateHistoryTokens(out, estimate) > budgetTokens) {
    const first = out.shift();
    if (first && out.length > 0 && out[0]!.role !== first.role) out.shift();
  }
  return out;
}
