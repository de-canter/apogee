import { createHash } from 'node:crypto';

/** One retrievable piece of a source document. */
export interface Chunk {
  /** Stable: `${source}#${slug(title)}` plus `#${part}` for split parts. */
  id: string;
  /** Host path or URL of the source. */
  source: string;
  /** First path segment of the source, or 'general'. */
  section: string;
  /** Nearest heading, else the source's basename. */
  title: string;
  content: string;
  /** sha256 of the content, first 16 hex chars; change detection on reingest. */
  hash: string;
  /** Host-defined visibility, e.g. 'user' | 'admin' | 'platform'. */
  scope: string;
  metadata: { headingLevel: number; wordCount: number; part?: number; [k: string]: unknown };
}

export interface ChunkOptions {
  section?: string;
  scope?: string;
  /** Sections over this many words are split at paragraph boundaries. */
  maxWords?: number;
  /** Headings deeper than this stay inside the chunk. */
  headingDepth?: 1 | 2 | 3;
  metadata?: Record<string, unknown>;
}

export const DEFAULT_SCOPE = 'user';
export const DEFAULT_MAX_WORDS = 500;
export const DEFAULT_SECTION = 'general';

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function chunkId(source: string, title: string, part?: number): string {
  return `${source}#${slug(title)}${part !== undefined ? `#${part}` : ''}`;
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function deriveSection(source: string): string {
  const parts = source.split('/').filter((p) => p !== '');
  return parts.length > 1 ? parts[0]! : DEFAULT_SECTION;
}

export const STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'his', 'how', 'its', 'may', 'who', 'did',
  'this', 'that', 'with', 'from', 'they', 'will', 'have', 'been', 'were', 'what', 'when', 'your', 'them', 'than', 'then', 'into', 'some', 'does', 'each', 'also',
  'about', 'would', 'there', 'their', 'which', 'these', 'those', 'where', 'while', 'should', 'could', 'other',
]);

/** Light plural stemming: policies -> policy, refunds -> refund, classes -> class. */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.length > 4 && token.endsWith('sses')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Lowercase, stemmed words of three or more characters, minus stopwords. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem);
}

const wordCount = (text: string): number => text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
const basename = (source: string): string => (source.split('/').pop() ?? source).replace(/\.[^.]+$/, '');

interface Section { title: string; level: number; lines: string[] }

/** Split into parts at blank lines so no part exceeds maxWords (a single oversized paragraph stays whole). */
function splitParagraphs(text: string, maxWords: number): string[] {
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter((p) => p !== '');
  const parts: string[] = [];
  let buffer: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    const n = wordCount(p);
    if (count + n > maxWords && buffer.length > 0) {
      parts.push(buffer.join('\n\n'));
      buffer = [];
      count = 0;
    }
    buffer.push(p);
    count += n;
  }
  if (buffer.length > 0) parts.push(buffer.join('\n\n'));
  return parts;
}

/**
 * Headings from h1 to `headingDepth` start a new chunk; text before the first heading is
 * titled by the file. Fenced code never starts a chunk. Sections over `maxWords` split at
 * paragraph boundaries into `Title (Part n)` chunks.
 */
export function chunkMarkdown(source: string, markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const maxWords = opts.maxWords ?? DEFAULT_MAX_WORDS;
  const depth = opts.headingDepth ?? 3;
  const section = opts.section ?? deriveSection(source);
  const scope = opts.scope ?? DEFAULT_SCOPE;
  const sections: Section[] = [{ title: basename(source), level: 0, lines: [] }];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && heading[1]!.length <= depth) {
      sections.push({ title: heading[2]!, level: heading[1]!.length, lines: [] });
      continue;
    }
    sections[sections.length - 1]!.lines.push(line);
  }

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const text = s.lines.join('\n').trim();
    if (text === '') continue;
    const total = wordCount(text);
    const base = { source, section, scope, ...(opts.metadata ?? {}) };
    if (total <= maxWords) {
      chunks.push({ id: chunkId(source, s.title), title: s.title, content: text, hash: contentHash(text), ...base, metadata: { ...(opts.metadata ?? {}), headingLevel: s.level, wordCount: total } });
      continue;
    }
    const parts = splitParagraphs(text, maxWords);
    parts.forEach((content, i) => {
      const part = i + 1;
      chunks.push({
        id: chunkId(source, s.title, part),
        title: parts.length === 1 ? s.title : `${s.title} (Part ${part})`,
        content,
        hash: contentHash(content),
        ...base,
        metadata: { ...(opts.metadata ?? {}), headingLevel: s.level, wordCount: wordCount(content), part },
      });
    });
  }
  return chunks;
}
