import { describe, expect, it } from 'vitest';
import { createInMemoryMemory, memoryContributor, memoryTool } from '../memory';

interface Ctx { tenant?: string; user: string }
type Key = { tenant: string };

describe('config memory', () => {
  const port = createInMemoryMemory<Key>((k) => k.tenant);
  const tool = memoryTool<Ctx, Key>({ port, keyFromCtx: (c) => (c.tenant ? { tenant: c.tenant } : undefined), byFromCtx: (c) => c.user, maxChars: 50 });
  const contributor = memoryContributor<Ctx, Key>({ port, keyFromCtx: (c) => (c.tenant ? { tenant: c.tenant } : undefined) });
  const call = (ctx: Ctx, content: string, summary?: Record<string, unknown>) =>
    tool.execute({ content, ...(summary ? { summary } : {}) }, { ctx, toolUseId: 't', sessionId: 's' });

  it('contributor is empty before any memory exists', async () => {
    expect(await contributor({ tenant: 'acme', user: 'u1' })).toBeUndefined();
    expect(await contributor({ user: 'u1' })).toBeUndefined();
  });
  it('tool replaces content, merges summary, increments version, and is bounded', async () => {
    expect(await call({ tenant: 'acme', user: 'u1' }, 'v1 doc', { open: 1 })).toMatchObject({ success: true, data: { version: 1 } });
    expect(await call({ tenant: 'acme', user: 'u2' }, 'v2 doc', { next: 'x' })).toMatchObject({ success: true, data: { version: 2 } });
    const doc = await port.get({ tenant: 'acme' });
    expect(doc).toMatchObject({ content: 'v2 doc', summary: { open: 1, next: 'x' }, version: 2, updatedBy: 'u2' });
    expect(await call({ tenant: 'acme', user: 'u1' }, 'x'.repeat(51))).toMatchObject({ success: false });
    expect(await call({ user: 'u1' }, 'no key')).toMatchObject({ success: false });
    expect(await contributor({ tenant: 'acme', user: 'u1' })).toBe('## Design Memory\n\nv2 doc');
  });
});
