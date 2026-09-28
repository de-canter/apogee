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
  it('rejects a non snake_case name', () => {
    expect(() => defineCapability({ name: 'Home', title: 'x', input: z.object({}), view: z.unknown(), execute: () => Promise.resolve({ data: null }) })).toThrow(/snake_case/);
  });
});
