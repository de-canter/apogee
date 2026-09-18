import { describe, expect, it } from 'vitest';
import { rulesPromptRegistry } from '../prompts';

describe('rulesPromptRegistry', () => {
  it('registers the five prompts this package sends', () => {
    const registry = rulesPromptRegistry();
    expect(registry.list().map((p) => p.name).sort()).toEqual(['rules.detect-conflicts', 'rules.evaluate-gate', 'rules.parse-rule', 'rules.suggest-rules', 'rules.validate-rule']);
    expect(registry.get('rules.parse-rule').version).toBe('1.0.0');
  });
});
