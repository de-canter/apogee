import type { ContentBlock, ModelRole } from '@apogee/ai';
import { DocumentsError } from './errors';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
const IMAGE_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** What a document arrives as. `data` is base64 for image and pdf. */
export type DocumentInput =
  | { kind: 'text'; text: string; filename?: string }
  | { kind: 'image'; mediaType: ImageMediaType; data: string; filename?: string }
  | { kind: 'pdf'; data: string; filename?: string };

export const DEFAULT_MAX_TEXT_CHARS = 100_000;
export const TRUNCATION_NOTE = '\n\n[truncated]';

/** Media block first, then the prompt text, as the provider prefers. Text becomes a text/plain document block. */
export function toContentBlocks(input: DocumentInput, prompt: string, opts: { maxTextChars?: number } = {}): ContentBlock[] {
  const title = input.filename !== undefined ? { title: input.filename } : {};
  let media: ContentBlock;
  switch (input.kind) {
    case 'text': {
      const max = opts.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
      const data = input.text.length > max ? input.text.slice(0, max) + TRUNCATION_NOTE : input.text;
      media = { type: 'document', source: { type: 'text', mediaType: 'text/plain', data }, ...title };
      break;
    }
    case 'image':
      media = { type: 'image', source: { type: 'base64', mediaType: input.mediaType, data: input.data } };
      break;
    case 'pdf':
      media = { type: 'document', source: { type: 'base64', mediaType: 'application/pdf', data: input.data }, ...title };
      break;
  }
  return [media, { type: 'text', text: prompt }];
}

/** 'vision' for image and pdf, 'default' for text. */
export function roleFor(input: DocumentInput): ModelRole {
  return input.kind === 'text' ? 'default' : 'vision';
}

/** From a MIME type: the four image types, application/pdf, or text/*. `data` is base64 for media, the text itself for text/*. */
export function inputFromMime(mediaType: string, data: string, filename?: string): DocumentInput {
  const named = filename !== undefined ? { filename } : {};
  if ((IMAGE_TYPES as readonly string[]).includes(mediaType)) return { kind: 'image', mediaType: mediaType as ImageMediaType, data, ...named };
  if (mediaType === 'application/pdf') return { kind: 'pdf', data, ...named };
  if (mediaType.startsWith('text/')) return { kind: 'text', text: data, ...named };
  throw new DocumentsError(`Unsupported document type ${mediaType}`, 'UNSUPPORTED_TYPE');
}
