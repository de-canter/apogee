import { describe, expect, it } from 'vitest';
import { definePrompt, text } from '../prompt';
import { PromptNotFoundError, applyOverrides, createPromptRegistry, overrideSection } from '../registry';

const a1 = definePrompt({ name: 'a', version: '1.0.0', sections: [text('s', 'one')] });
const a12 = definePrompt({ name: 'a', version: '1.2.0', sections: [text('s', 'one-two')] });
const a2 = definePrompt({ name: 'a', version: '1.10.0', sections: [text('s', 'one-ten')] });

describe('PromptRegistry', () => {
  it('returns the latest version by numeric compare, or an explicit one', () => {
    const r = createPromptRegistry();
    r.register(a1); r.register(a2); r.register(a12);
    expect(r.get('a').version).toBe('1.10.0');
    expect(r.get('a', '1.0.0').version).toBe('1.0.0');
    expect(r.list()).toHaveLength(3);
    expect(() => r.get('b')).toThrow(PromptNotFoundError);
    expect(() => r.get('a', '9.9.9')).toThrow(PromptNotFoundError);
  });
  it('overrideSection returns a new prompt and leaves the original untouched', () => {
    const o = overrideSection(a1, 's', 'replaced');
    expect(o.sections[0]).toEqual({ id: 's', kind: 'text', text: 'replaced', stable: true });
    expect(a1.sections[0]).toMatchObject({ text: 'one' });
    expect(() => overrideSection(a1, 'nope', 'x')).toThrow();
  });
  it('applyOverrides validates the stored document and checks the name', () => {
    const o = applyOverrides(a1, { name: 'a', version: '1.0.0', sections: [{ id: 's', text: 'from-db' }] });
    expect(o.sections[0]).toMatchObject({ text: 'from-db' });
    expect(() => applyOverrides(a1, { name: 'b', version: '1.0.0', sections: [] })).toThrow();
    expect(() => applyOverrides(a1, { name: 'a', version: 'bad', sections: [] })).toThrow();
  });
});
