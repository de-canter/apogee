import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_MAP, staticResolver } from '../models';

describe('model roles', () => {
  it('default map resolves the three built-in roles', () => {
    const r = staticResolver(DEFAULT_ROLE_MAP);
    expect(r('default')).toBe('claude-opus-5');
    expect(r('fast')).toBe('claude-haiku-4-5');
    expect(r('vision')).toBe('claude-opus-5');
  });
  it('unknown roles fall back to the default role, or to an explicit fallback', () => {
    expect(staticResolver(DEFAULT_ROLE_MAP)('extraction')).toBe('claude-opus-5');
    expect(staticResolver({ default: 'claude-sonnet-5' }, 'claude-haiku-4-5')('anything')).toBe('claude-haiku-4-5');
  });
  it('host overrides win', () => {
    expect(staticResolver({ ...DEFAULT_ROLE_MAP, default: 'claude-sonnet-5' })('default')).toBe('claude-sonnet-5');
  });
});
