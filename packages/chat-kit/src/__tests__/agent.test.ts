import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@de_canter/apogee-agent';
import { toAgentTools } from '../agent';
import { createKit } from '../kit';
import { makeCtx, seed, ticket, type Principal } from './fixtures/ticket';

interface AgentCtx { userToken: string | undefined }

const kit = createKit<ReturnType<typeof makeCtx>, Principal>({
  resources: [ticket], ctx: makeCtx(structuredClone(seed)),
  principal: (a) => { if (!a?.token) throw new Error('nope'); return Promise.resolve({ user: a.token, admin: false }); },
});
const tools = toAgentTools<AgentCtx>(kit, { auth: (c) => (c.userToken ? { token: c.userToken } : undefined) });
const ctx = { ctx: { userToken: 'ann' }, toolUseId: 'tu_1', sessionId: 's1' };

describe('toAgentTools', () => {
  it('produces registry-compatible tools with JSON schema definitions', () => {
    const reg = createToolRegistry<AgentCtx>(tools);
    expect(reg.get('ticket_triage')?.description).toBe('Triage');
    expect(reg.definitions().find((d) => d.name === 'ticket_triage')?.inputSchema).toMatchObject({ type: 'object' });
  });
  it('returns the envelope as data and as an artifact typed by resource', async () => {
    const t = tools.find((x) => x.name === 'ticket_triage')!;
    const r = await t.execute({ id: 't1', assignee: 'bob' } as never, ctx);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ resource: 'ticket', state: 'triaged' });
    expect(r.artifact).toMatchObject({ type: 'ticket', id: 'tu_1', data: { state: 'triaged' } });
    expect(JSON.parse(r.message ?? '')).toMatchObject({ state: 'triaged' });
  });
  it('maps ChatKitError to a failed result the model can read', async () => {
    const t = tools.find((x) => x.name === 'ticket_triage')!;
    const r = await t.execute({ id: 't2', assignee: 'bob' } as never, ctx);
    expect(r).toMatchObject({ success: false, error: 'ILLEGAL_TRANSITION', data: { error: { code: 'ILLEGAL_TRANSITION' } } });
    const r2 = await t.execute({ id: 't1', assignee: 'bob' } as never, { ...ctx, ctx: { userToken: undefined } });
    expect(r2).toMatchObject({ success: false, error: 'UNAUTHENTICATED' });
  });
});
