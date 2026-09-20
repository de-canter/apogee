import { createFakeModelClient, StructuredOutputError, type ContentBlock, type SystemBlock } from '@de_canter/apogee-ai';
import { isoDate } from '@de_canter/apogee-kernel';
import { describe, expect, it } from 'vitest';
import { classify } from '../classify';
import { DocumentsError } from '../errors';
import type { DocumentInput } from '../input';
import { documentsPromptRegistry } from '../prompts';
import { defineTaxonomy } from '../taxonomy';

const taxonomy = defineTaxonomy([
  { code: 'agreement', label: 'Rental agreement', hints: ['lists equipment and dates'] },
  { code: 'invoice', label: 'Invoice', hints: ['totals and due date'] },
]);
const now = () => isoDate('2026-09-19T12:00:00Z');
let t = 0;
const engine = { taxonomy, domain: 'an equipment rental company', now, clock: () => (t += 7) };
const systemText = (system: string | SystemBlock[] | undefined): string => (typeof system === 'string' ? system : (system ?? []).map((b) => b.text).join('\n'));
const text: DocumentInput = { kind: 'text', text: 'INVOICE INV-7 total 2250.00 due 2026-10-01', filename: 'inv-7.txt' };

describe('classify', () => {
  it('returns the type, a confidence, and a proposed assertion', async () => {
    const client = createFakeModelClient([{ object: { code: 'invoice', confidence: 0.93, reasoning: 'Has totals and a due date.' }, usage: { input: 20, output: 4 } }]);
    const c = await classify(text, { ...engine, client }, { expectedCodes: ['invoice', 'agreement'] });
    expect(c.code).toBe('invoice');
    expect(c.type?.label).toBe('Invoice');
    expect(c.confidence).toEqual({ value: 0.93, level: 'high', factors: ['Has totals and a due date.'] });
    expect(c.assertion).toMatchObject({ status: 'proposed', predicate: 'classified-as', object: { code: 'invoice', reasoning: 'Has totals and a due date.' } });
    expect(c.assertion.provenance).toEqual({ source: { kind: 'ai', name: 'documents.classify@1.0.0' }, method: 'classify', confidence: 0.93, recordedAt: '2026-09-19T12:00:00.000Z' });
    expect(c.subject.kind).toBe('Document');
    expect(c.assertion.subject).toEqual(c.subject);
    expect(c.usage.input).toBe(20);
    expect(c.durationMs).toBe(7);

    const call = client.calls[0]!;
    expect(call.model).toBe('default');
    const system = systemText(call.system);
    expect(system).toContain('an equipment rental company');
    expect(system).toContain('- invoice: Invoice — totals and due date');
    const blocks = call.messages[0]!.content as ContentBlock[];
    expect(blocks[0]).toMatchObject({ type: 'document', title: 'inv-7.txt' });
    const last = blocks[blocks.length - 1];
    expect(last?.type === 'text' && last.text).toContain('Filename: inv-7.txt');
    expect(last?.type === 'text' && last.text).toContain('Expected types: invoice, agreement');
  });

  it('uses the vision role for images and honors an engine override', async () => {
    const image: DocumentInput = { kind: 'image', mediaType: 'image/png', data: 'AAAA' };
    const client = createFakeModelClient([{ object: { code: 'agreement', confidence: 0.8, reasoning: 'r' } }, { object: { code: 'agreement', confidence: 0.8, reasoning: 'r' } }]);
    await classify(image, { ...engine, client });
    expect(client.calls[0]!.model).toBe('vision');
    await classify(image, { ...engine, client, model: 'fast' });
    expect(client.calls[1]!.model).toBe('fast');
  });

  it('accepts unknown and rejects codes outside the taxonomy', async () => {
    const unknown = await classify(text, { ...engine, client: createFakeModelClient([{ object: { code: 'unknown', confidence: 0.3, reasoning: 'Unreadable.' } }]) });
    expect(unknown.code).toBe('unknown');
    expect(unknown.type).toBeUndefined();
    expect(unknown.confidence.level).toBe('low');
    await expect(classify(text, { ...engine, client: createFakeModelClient([{ object: { code: 'deed', confidence: 0.9, reasoning: 'r' } }]) })).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('needs a client and honors a subject', async () => {
    await expect(classify(text, engine)).rejects.toBeInstanceOf(DocumentsError);
    const c = await classify(text, { ...engine, client: createFakeModelClient([{ object: { code: 'invoice', confidence: 0.9, reasoning: 'r' } }]) }, { subject: { kind: 'Upload', id: 'u1' } });
    expect(c.subject).toEqual({ kind: 'Upload', id: 'u1' });
  });
});

describe('documentsPromptRegistry', () => {
  it('registers the classify prompt', () => {
    expect(documentsPromptRegistry().list().map((p) => p.name)).toContain('documents.classify');
  });
});
