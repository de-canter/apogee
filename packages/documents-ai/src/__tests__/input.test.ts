import { describe, expect, it } from 'vitest';
import { DocumentsError } from '../errors';
import { inputFromMime, roleFor, toContentBlocks } from '../input';

describe('toContentBlocks', () => {
  it('sends text as a text/plain document block before the prompt', () => {
    expect(toContentBlocks({ kind: 'text', text: 'INVOICE 7', filename: 'inv.txt' }, 'Classify.')).toEqual([
      { type: 'document', source: { type: 'text', mediaType: 'text/plain', data: 'INVOICE 7' }, title: 'inv.txt' },
      { type: 'text', text: 'Classify.' },
    ]);
  });
  it('truncates long text and says so, leaving the prompt alone', () => {
    const blocks = toContentBlocks({ kind: 'text', text: 'x'.repeat(50) }, 'Classify.', { maxTextChars: 10 });
    expect(blocks[0]).toMatchObject({ type: 'document', source: { data: 'x'.repeat(10) + '\n\n[truncated]' } });
    expect(blocks[1]).toEqual({ type: 'text', text: 'Classify.' });
  });
  it('sends images and PDFs as media blocks first', () => {
    expect(toContentBlocks({ kind: 'image', mediaType: 'image/png', data: 'AAAA' }, 'p')).toEqual([
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'p' },
    ]);
    expect(toContentBlocks({ kind: 'pdf', data: 'BBBB', filename: 'a.pdf' }, 'p')[0]).toEqual({ type: 'document', source: { type: 'base64', mediaType: 'application/pdf', data: 'BBBB' }, title: 'a.pdf' });
  });
});

describe('roleFor', () => {
  it('uses vision for media and default for text', () => {
    expect(roleFor({ kind: 'text', text: '' })).toBe('default');
    expect(roleFor({ kind: 'image', mediaType: 'image/jpeg', data: '' })).toBe('vision');
    expect(roleFor({ kind: 'pdf', data: '' })).toBe('vision');
  });
});

describe('inputFromMime', () => {
  it('maps MIME types to inputs', () => {
    expect(inputFromMime('image/png', 'AAAA', 'a.png')).toEqual({ kind: 'image', mediaType: 'image/png', data: 'AAAA', filename: 'a.png' });
    expect(inputFromMime('application/pdf', 'BBBB')).toEqual({ kind: 'pdf', data: 'BBBB' });
    expect(inputFromMime('text/markdown', '# hi')).toEqual({ kind: 'text', text: '# hi' });
    expect(() => inputFromMime('application/zip', '')).toThrow(DocumentsError);
  });
});
