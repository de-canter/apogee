import type { ModelClient, ModelRole, Usage } from '@apogee/ai';
import { composePrompt, toSystemBlocks, type ComposeOptions, type Prompt } from './prompt';

export interface EvalCase<TCtx> {
  id: string;
  ctx: TCtx;
  input: string;
  /** For the default judge: a substring the output must contain. */
  expect?: string;
}

export interface JudgeResult { score: number; notes?: string }
export type Judge<TCtx> = (c: EvalCase<TCtx>, output: string) => JudgeResult | Promise<JudgeResult>;

/** Score 1 when `expect` is a substring of the output (case-insensitive), else 0. No `expect` scores 1. */
export const includesJudge: Judge<unknown> = (c, output) => {
  if (c.expect === undefined) return { score: 1 };
  const hit = output.toLowerCase().includes(c.expect.toLowerCase());
  return { score: hit ? 1 : 0, ...(hit ? {} : { notes: `expected to include: ${c.expect}` }) };
};

export interface EvalCaseResult { id: string; output: string; score: number; notes?: string; usage: Usage }
export interface EvalReport {
  prompt: { name: string; version: string };
  cases: EvalCaseResult[];
  meanScore: number;
  totalCostUsd: number;
}

export interface EvalOptions<TCtx> extends ComposeOptions<TCtx> {
  client: ModelClient;
  judge?: Judge<TCtx>;
  role?: ModelRole;
}

/** Run every case through the composed prompt and score it. Costs money with a real client. */
export async function evalPrompt<TCtx>(prompt: Prompt<TCtx>, cases: readonly EvalCase<TCtx>[], opts: EvalOptions<TCtx>): Promise<EvalReport> {
  const judge = opts.judge ?? includesJudge;
  const results: EvalCaseResult[] = [];
  for (const c of cases) {
    const composed = await composePrompt(prompt, c.ctx, opts);
    const r = await opts.client.generate(
      { ...(opts.role !== undefined ? { model: opts.role } : {}), system: toSystemBlocks(composed), messages: [{ role: 'user', content: c.input }] },
      { label: `eval:${prompt.name}@${prompt.version}:${c.id}` },
    );
    const j = await judge(c, r.text);
    results.push({ id: c.id, output: r.text, score: j.score, ...(j.notes !== undefined ? { notes: j.notes } : {}), usage: r.usage });
  }
  const meanScore = results.length === 0 ? 0 : results.reduce((s, r) => s + r.score, 0) / results.length;
  const totalCostUsd = results.reduce((s, r) => s + r.usage.costUsd, 0);
  return { prompt: { name: prompt.name, version: prompt.version }, cases: results, meanScore, totalCostUsd };
}
