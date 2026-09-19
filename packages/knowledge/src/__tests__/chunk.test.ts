import { describe, expect, it } from 'vitest';
import { chunkId, chunkMarkdown, contentHash, deriveSection, slug, tokenize } from '../chunk';

const words = (n: number, prefix = 'w'): string => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

const doc = `Preamble before any heading.

# Rental policies

Rentals run by the calendar day.

## Deposits

A deposit is held on high-value rentals.

### Refunds

Deposits are refundable within 7 days of return.

#### Not a boundary

Still part of refunds.

\`\`\`
# not a heading
\`\`\`

## Long section

${words(450)}

${words(450, 'x')}

${words(300, 'y')}
`;

describe('chunkMarkdown', () => {
  const chunks = chunkMarkdown('policies/rental.md', doc);

  it('splits on h1 to h3 and titles the preamble by the file', () => {
    expect(chunks.map((c) => c.title)).toEqual(['rental', 'Rental policies', 'Deposits', 'Refunds', 'Long section (Part 1)', 'Long section (Part 2)', 'Long section (Part 3)']);
    expect(chunks.map((c) => c.id)).toEqual([
      'policies/rental.md#rental', 'policies/rental.md#rental-policies', 'policies/rental.md#deposits', 'policies/rental.md#refunds',
      'policies/rental.md#long-section#1', 'policies/rental.md#long-section#2', 'policies/rental.md#long-section#3',
    ]);
  });
  it('keeps deeper headings and fenced code inside the chunk', () => {
    const refunds = chunks[3]!;
    expect(refunds.content).toContain('#### Not a boundary');
    expect(refunds.content).toContain('# not a heading');
    expect(refunds.metadata.headingLevel).toBe(3);
  });
  it('splits long sections at paragraph boundaries under the word limit', () => {
    const parts = chunks.slice(4);
    expect(parts.map((p) => p.metadata.wordCount)).toEqual([450, 450, 300]);
    expect(parts.map((p) => p.metadata.part)).toEqual([1, 2, 3]);
    expect(parts[0]!.content.startsWith('w0 ')).toBe(true);
  });
  it('derives section and scope and hashes content stably', () => {
    expect(chunks.every((c) => c.section === 'policies')).toBe(true);
    expect(chunks.every((c) => c.scope === 'user')).toBe(true);
    expect(chunks[2]!.hash).toHaveLength(16);
    expect(chunkMarkdown('policies/rental.md', doc)[2]!.hash).toBe(chunks[2]!.hash);
    const admin = chunkMarkdown('rental.md', '# A\n\ntext', { scope: 'admin', section: 'ops', metadata: { version: 2 } });
    expect(admin[0]).toMatchObject({ section: 'ops', scope: 'admin', metadata: { version: 2, headingLevel: 1, wordCount: 1 } });
  });
  it('drops empty chunks and respects headingDepth', () => {
    expect(chunkMarkdown('a.md', '# Only\n\n## Empty\n\n## Filled\n\ntext').map((c) => c.title)).toEqual(['Filled']);
    expect(chunkMarkdown('a.md', '# One\n\ntext\n\n## Two\n\nmore', { headingDepth: 1 }).map((c) => c.title)).toEqual(['One']);
  });
});

describe('helpers', () => {
  it('slug, chunkId, deriveSection, contentHash, tokenize', () => {
    expect(slug('Long Section (Part 1)!')).toBe('long-section-part-1');
    expect(chunkId('a/b.md', 'Deposits')).toBe('a/b.md#deposits');
    expect(chunkId('a/b.md', 'Deposits', 2)).toBe('a/b.md#deposits#2');
    expect(deriveSection('user-guide/guides/foo.md')).toBe('user-guide');
    expect(deriveSection('foo.md')).toBe('general');
    expect(contentHash('abc')).toBe('ba7816bf8f01cfea');
    expect(tokenize('The Deposit is refundable, within 7 days!')).toEqual(['deposit', 'refundable', 'within', 'days']);
  });
});
