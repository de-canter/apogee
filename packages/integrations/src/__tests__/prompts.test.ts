import { describe, expect, it } from 'vitest';
import { integrationsPromptRegistry } from '../prompts';

describe('integrationsPromptRegistry', () => {
  it('registers the two prompts this package sends', () => {
    expect(integrationsPromptRegistry().list().map((p) => p.name).sort()).toEqual(['integrations.classify-inbound', 'integrations.post-process']);
  });
});
