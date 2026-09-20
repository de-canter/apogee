/** Two policy files, a hybrid store, a prompt slot filled with cited excerpts, and an answer with citations. */
import { createFakeModelClient } from '@apogee/ai';
import { composePrompt, definePrompt, slot, text } from '@apogee/prompts';
import { describe, expect, it } from 'vitest';
import { chunkMarkdown } from '../chunk';
import { createHashEmbedder, createHybridChunkStore, createVectorChunkStore } from '../embedding';
import { answer, knowledgeContributor } from '../retrieve';
import { createLexicalChunkStore, reingest } from '../store';

const deposits = `# Deposits and damage

## Deposit amounts

A deposit of 20 percent is held on high-value rentals (totals of $2,000 or more).

## Refunds

Deposits are refundable within 7 days of the return inspection. Damage found at inspection is deducted first.
`;
const delivery = `# Delivery and pickup

## Delivery

Delivery is available within 40 miles for a flat $95 each way.

## After-hours pickup

Pickups after 15:00 roll to the next morning.
`;

describe('acceptance: policies in, cited excerpts out', () => {
  it('fills an agent prompt slot and answers with citations', async () => {
    const store = createHybridChunkStore({ lexical: createLexicalChunkStore(), vector: createVectorChunkStore({ embedder: createHashEmbedder() }) });
    await reingest(store, 'policies/deposits.md', chunkMarkdown('policies/deposits.md', deposits));
    await reingest(store, 'policies/delivery.md', chunkMarkdown('policies/delivery.md', delivery));
    expect((await store.stats()).chunks).toBe(4);

    const prompt = definePrompt<{ question?: string }>({ name: 'desk', version: '1.0.0', sections: [text('id', 'You run the rental desk.'), slot('knowledge', 'knowledge')] });
    const contributor = knowledgeContributor<{ question?: string }>({ store, queryFromCtx: (c) => c.question, scope: 'user', limit: 2 });
    const composed = await composePrompt(prompt, { question: 'How do refunds work?' }, { contributors: { knowledge: contributor } });
    expect(composed.text).toContain('### Refunds [1]');
    expect(composed.text).toContain('_Source: policies/deposits.md_');
    expect(composed.blocks.map((b) => b.id)).toEqual(['id', 'knowledge']);
    const silent = await composePrompt(prompt, { question: 'book it' }, { contributors: { knowledge: contributor } });
    expect(silent.blocks.map((b) => b.id)).toEqual(['id']);

    const client = createFakeModelClient([{ text: 'Deposits come back within 7 days of the return inspection, minus any damage [1].' }]);
    const a = await answer(store, 'How do refunds work?', { client, domain: 'an equipment rental company', scope: 'user', limit: 2 });
    expect(a.text).toContain('[1]');
    expect(a.retrieval.citations[0]).toMatchObject({ n: 1, title: 'Refunds', source: 'policies/deposits.md' });
  });
});
