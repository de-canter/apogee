import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { artifactsOf, createToolRegistry, defineTool, toolResultContent } from '../tool';

interface Ctx { notes: string[] }

const addNote = defineTool<Ctx, { text: string }>({
  name: 'add_note',
  description: 'Add a note',
  input: z.object({ text: z.string().min(1) }),
  execute: (input, { ctx, toolUseId }) => {
    ctx.notes.push(input.text);
    return Promise.resolve({ success: true, artifact: { type: 'note-card', id: `note-card-${toolUseId}`, data: { text: input.text } } });
  },
});
const listNotes = defineTool<Ctx, Record<string, never>>({
  name: 'list_notes', description: 'List notes', input: z.object({}),
  execute: (_i, { ctx }) => Promise.resolve({ success: true, data: ctx.notes }),
});

describe('tool registry', () => {
  it('produces cached JSON-schema definitions and supports add/remove', () => {
    const reg = createToolRegistry<Ctx>([addNote]);
    const defs = reg.definitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('add_note');
    expect(defs[0]?.inputSchema['type']).toBe('object');
    expect((defs[0]?.inputSchema['properties'] as Record<string, unknown>)['text']).toBeDefined();
    expect(reg.definitions()).toBe(defs);
    reg.add(listNotes);
    expect(reg.definitions().map((d) => d.name)).toEqual(['add_note', 'list_notes']);
    reg.remove('add_note');
    expect(reg.get('add_note')).toBeUndefined();
    expect(reg.list().map((t) => t.name)).toEqual(['list_notes']);
  });
  it('executes with the tool context and returns artifacts', async () => {
    const ctx: Ctx = { notes: [] };
    const r = await addNote.execute({ text: 'hi' }, { ctx, toolUseId: 'tu1', sessionId: 's1' });
    expect(ctx.notes).toEqual(['hi']);
    expect(artifactsOf(r)).toEqual([{ type: 'note-card', id: 'note-card-tu1', data: { text: 'hi' } }]);
    expect(artifactsOf({ success: true, artifact: { type: 'a', id: '1', data: null }, artifacts: [{ type: 'b', id: '2', data: null }] })).toHaveLength(2);
    expect(artifactsOf({ success: false, error: 'x' })).toEqual([]);
    expect(toolResultContent({ success: true, data: [1] })).toBe('{"success":true,"data":[1]}');
  });
});
