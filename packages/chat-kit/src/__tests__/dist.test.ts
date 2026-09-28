import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineLifecycle } from '@de_canter/apogee-kernel';

// Smoke test against the BUILT bundles: each entry point ships as its own file, so an error class
// duplicated across entries (or split into a shared chunk) must still be recognized by the
// projections. turbo runs `build` before `test`, so dist/ is normally present.
const distIndex = new URL('../../dist/index.js', import.meta.url);
const distHttp = new URL('../../dist/http.js', import.meta.url);
const haveDist = existsSync(fileURLToPath(distIndex)) && existsSync(fileURLToPath(distHttp));

if (!haveDist) console.warn('[chat-kit dist smoke] dist/ is missing; run `pnpm --filter @de_canter/apogee-chat-kit build` first. Skipping.');

describe.skipIf(!haveDist)('built dist bundles', () => {
  it('errors thrown by createKit keep their code through createHttpHandler', async () => {
    const root = (await import(distIndex.href)) as typeof import('../index');
    const http = (await import(distHttp.href)) as typeof import('../http');
    type S = 'open' | 'closed';
    const lifecycle = defineLifecycle<S>({ states: ['open', 'closed'], initial: 'open', terminal: [], transitions: [{ name: 'close', from: 'open', to: 'closed' }] });
    const View = z.object({ title: z.string() });
    const ticket = root.defineResource<null, { user: string }, z.infer<typeof View>, S>({
      name: 'ticket', lifecycle, view: View,
      load: (id) => Promise.resolve(id === 't1' ? { state: 'open', view: { title: 'Leak' } } : null),
      transitions: {
        close: { from: 'open', to: 'closed', input: z.object({}), title: 'Close', execute: (_i: Record<string, never>, c) => Promise.resolve({ state: 'closed', view: c.current.view }) },
      },
    });
    const kit = root.createKit<null, { user: string }>({ resources: [ticket], ctx: null, principal: () => Promise.resolve({ user: 'ann' }) });
    const handle = http.createHttpHandler(kit);

    expect((await handle({ capability: 'nope', args: {}, auth: undefined })).status).toBe(404);
    const invalid = await handle({ capability: 'ticket_get', args: { id: 7 }, auth: undefined });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    expect((await handle({ capability: 'ticket_get', args: { id: 't1' }, auth: undefined })).status).toBe(200);
  });
});
