import { createFakeModelClient, type SystemBlock } from '@apogee/ai';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown, type Chunk } from '../chunk';
import { answer, formatRetrieval, isHelpQuery, knowledgeContributor, knowledgePromptRegistry, retrieve } from '../retrieve';
import { createLexicalChunkStore, type ScoredChunk } from '../store';

const chunk = (source: string, title: string, content: string, scope = 'user'): Chunk => chunkMarkdown(source, `# ${title}\n\n${content}`, { scope })[0]!;
const refunds = chunk('policies/deposits.md', 'Refunds', 'Deposits are refundable within 7 days of the return inspection.');
const delivery = chunk('policies/delivery.md', 'Delivery', 'Delivery is available within 40 miles for a flat fee each way.');
const overrides = chunk('ops/playbook.md', 'Refund overrides', 'Managers may override the refund window.', 'admin');
const systemText = (system: string | SystemBlock[] | undefined): string => (typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n'));

async function store() {
  const s = createLexicalChunkStore();
  await s.upsert([refunds, delivery, overrides]);
  return s;
}

describe('formatRetrieval', () => {
  it('numbers excerpts, cites sources, and returns citations', () => {
    const scored: ScoredChunk[] = [{ ...refunds, score: 2 }, { ...delivery, score: 1 }];
    const r = formatRetrieval(scored);
    expect(r.text).toBe(`## Relevant documentation

The following excerpts may help answer the question. Cite the source of anything you use.

### Refunds [1]
_Source: policies/deposits.md_

Deposits are refundable within 7 days of the return inspection.

---

### Delivery [2]
_Source: policies/delivery.md_

Delivery is available within 40 miles for a flat fee each way.`);
    expect(r.citations).toEqual([{ n: 1, id: refunds.id, source: 'policies/deposits.md', title: 'Refunds' }, { n: 2, id: delivery.id, source: 'policies/delivery.md', title: 'Delivery' }]);
    expect(r.chunks).toHaveLength(2);
  });
  it('stops adding excerpts at the character budget and is empty with no chunks', () => {
    const r = formatRetrieval([{ ...refunds, score: 2 }, { ...delivery, score: 1 }], { maxChars: 200 });
    expect(r.chunks.map((c) => c.title)).toEqual(['Refunds']);
    expect(formatRetrieval([])).toEqual({ chunks: [], text: '', citations: [] });
  });
});

describe('retrieve and isHelpQuery', () => {
  it('retrieves from the store with filters', async () => {
    const r = await retrieve(await store(), 'how are deposits refunded?', { scope: 'user', limit: 2, heading: '## Policies' });
    expect(r.chunks.map((c) => c.title)).toEqual(['Refunds']);
    expect(r.text.startsWith('## Policies')).toBe(true);
  });
  it('recognizes questions', () => {
    expect(isHelpQuery('how do I return a unit?')).toBe(true);
    expect(isHelpQuery('What is the deposit policy')).toBe(true);
    expect(isHelpQuery('explain the late fee')).toBe(true);
    expect(isHelpQuery('book it')).toBe(false);
  });
});

describe('knowledgeContributor', () => {
  it('fills a slot only for questions with matches, honoring the context scope', async () => {
    const s = await store();
    const contributor = knowledgeContributor<{ question?: string; admin?: boolean }>({ store: s, queryFromCtx: (c) => c.question, scopeFromCtx: (c) => (c.admin ? ['user', 'admin'] : 'user'), limit: 3 });
    expect(await contributor({})).toBeUndefined();
    expect(await contributor({ question: 'book it' })).toBeUndefined();
    expect(await contributor({ question: 'how do I get a refund?' })).toContain('### Refunds [1]');
    expect(await contributor({ question: 'how do I get a refund?' })).not.toContain('Refund overrides');
    expect(await contributor({ question: 'how do I get a refund?', admin: true })).toContain('Refund overrides');
    expect(await contributor({ question: 'what about zebras?' })).toBeUndefined();
    const always = knowledgeContributor<{ question?: string }>({ store: s, queryFromCtx: (c) => c.question, when: () => true });
    expect(await always({ question: 'delivery' })).toContain('### Delivery [1]');
  });
});

describe('answer', () => {
  it('asks the model with the excerpts and returns the citations', async () => {
    const client = createFakeModelClient([{ text: 'Deposits are refundable within 7 days [1].', usage: { input: 40 } }]);
    const a = await answer(await store(), 'How do refunds work?', { client, domain: 'an equipment rental company', scope: 'user' });
    expect(a.text).toBe('Deposits are refundable within 7 days [1].');
    expect(a.retrieval.citations[0]?.title).toBe('Refunds');
    expect(a.usage.input).toBe(40);
    const call = client.calls[0]!;
    expect(systemText(call.system)).toContain('an equipment rental company');
    expect(call.messages[0]!.content as string).toContain('### Refunds [1]');
    expect(call.messages[0]!.content as string).toContain('Question: How do refunds work?');
  });
  it('still asks when nothing matched', async () => {
    const client = createFakeModelClient([{ text: 'The documentation does not cover that.' }]);
    const a = await answer(await store(), 'zebras?', { client });
    expect(a.retrieval.chunks).toEqual([]);
    expect(client.calls[0]!.messages[0]!.content as string).toContain('No documentation matched.');
  });
});

describe('knowledgePromptRegistry', () => {
  it('registers the answer prompt', () => {
    expect(knowledgePromptRegistry().list().map((p) => p.name)).toEqual(['knowledge.answer']);
  });
});
