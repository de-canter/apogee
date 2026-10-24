import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { formatCurrency } from '../utils/formatting';
import { formatDate } from '../utils/dates';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!p.includes('__tests__')) out.push(p);
  }
  return out;
}
const sources = walk(root).map((p) => ({ p, text: readFileSync(p, 'utf8') }));

describe('no product residue in the package', () => {
  it('has no title-workflow stage tokens and no undefined text token', () => {
    for (const { p, text } of sources) {
      expect(text, p).not.toMatch(/--gc-stage-/);
      expect(text, p).not.toMatch(/--gc-text-primary/);
    }
  });
  it('has no issue numbers or title-industry words', () => {
    for (const { p, text } of sources) {
      expect(text, p).not.toMatch(/#(909|920|862|1286)\b/);
      expect(text, p).not.toMatch(/\b(GF|title company|TitlePrompt|titleprompt|order number|lender|examination)\b/i);
    }
  });
  it('has no module-level clock', () => {
    for (const { p, text } of sources) expect(text, p).not.toMatch(/setGridClock|gridNow/);
  });
  it('formats money and dates for the locale it is given', () => {
    expect(formatCurrency(1234.5, { locale: 'de-DE', currency: 'EUR' })).toContain('€');
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatDate('2026-10-28', { locale: 'en-GB' })).toBe('28/10/2026');
    expect(formatDate('2026-10-28')).toBe('10/28/26');
  });
});
