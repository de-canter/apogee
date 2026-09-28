import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createKit } from '../kit';
import { defineCapability } from '../standalone';
import { STATELESS } from '../contract';
import type { Principal } from './fixtures/ticket';

const HomeView = z.object({ greeting: z.string(), open_count: z.number() });

const home = defineCapability<{ open: number }, Principal, z.infer<typeof HomeView>>({
  name: 'home',
  title: 'Home',
  input: z.object({}),
  view: HomeView,
  ui: 'ui://test/home.html',
  execute: (_input: Record<string, never>, { ctx, principal }) => Promise.resolve({
    data: { greeting: `Hi ${principal.user}`, open_count: ctx.open },
    allowed_next_actions: [{ capability: 'ticket_list', title: 'See tickets', args: {}, intent: 'primary' }],
  }),
});

describe('defineCapability', () => {
  it('returns a stateless envelope with the given actions and ui', async () => {
    const kit = createKit<{ open: number }, Principal>({ resources: [], capabilities: [home], ctx: { open: 2 }, principal: () => Promise.resolve({ user: 'ann', admin: false }) });
    const e = await kit.call('home', {}, undefined);
    expect(e).toMatchObject({ resource: 'home', id: null, state: STATELESS, data: { greeting: 'Hi ann', open_count: 2 }, ui: { resource_uri: 'ui://test/home.html' } });
    expect(e.allowed_next_actions[0]?.capability).toBe('ticket_list');
    expect(kit.get('home')?.output.safeParse(e).success).toBe(true);
  });
  it('invalid allowed_next_actions or an empty id from execute is INTERNAL', async () => {
    const bad = (result: { data: z.infer<typeof HomeView>; allowed_next_actions?: unknown; id?: unknown }) => defineCapability<null, Principal, z.infer<typeof HomeView>>({
      name: 'bad', title: 'Bad', input: z.object({}), view: HomeView,
      execute: () => Promise.resolve(result as never),
    });
    const kitWith = (cap: ReturnType<typeof bad>) => createKit<null, Principal>({ resources: [], capabilities: [cap], ctx: null, principal: () => Promise.resolve({ user: 'ann', admin: false }) });
    const data = { greeting: 'hi', open_count: 0 };
    await expect(kitWith(bad({ data, allowed_next_actions: [{ capability: '', title: 'x', args: {} }] })).call('bad', {}, undefined)).rejects.toMatchObject({ code: 'INTERNAL', message: /allowed_next_actions/ });
    await expect(kitWith(bad({ data, id: '' })).call('bad', {}, undefined)).rejects.toMatchObject({ code: 'INTERNAL', message: /invalid id/ });
    await expect(kitWith(bad({ data, id: 'h1' })).call('bad', {}, undefined)).resolves.toMatchObject({ id: 'h1' });
  });
  it('rejects a non snake_case name', () => {
    expect(() => defineCapability({ name: 'Home', title: 'x', input: z.object({}), view: z.unknown(), execute: () => Promise.resolve({ data: null }) })).toThrow(/snake_case/);
  });
});
