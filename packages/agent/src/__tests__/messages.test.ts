import { isoDate } from '@apogee/kernel';
import { describe, expect, it } from 'vitest';
import { SUMMARY_ASSISTANT_ACK, SUMMARY_USER_PREFIX, newMessageId, toModelMessages, type AgentMessage } from '../messages';

const at = isoDate('2026-01-01');

describe('toModelMessages', () => {
  it('appends annotations, replays blocks, expands summaries, drops empties', () => {
    const history: AgentMessage[] = [
      { id: '1', role: 'summary', content: 'earlier stuff', at },
      { id: '2', role: 'user', content: 'Add a note', annotations: ['[Artifact Action: submit on note-1]'], at },
      { id: '3', role: 'assistant', content: 'Adding.', blocks: [{ type: 'text', text: 'Adding.' }, { type: 'tool_use', id: 'tu1', name: 'add_note', input: { text: 'x' } }], at },
      { id: '4', role: 'user', content: '', blocks: [{ type: 'tool_result', toolUseId: 'tu1', content: '{"success":true}' }], at },
      { id: '5', role: 'assistant', content: 'Done.', at },
      { id: '6', role: 'user', content: '   ', at },
      { id: '7', role: 'user', content: 'Thanks', at },
    ];
    const out = toModelMessages(history);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
    expect(out[0]?.content).toBe(SUMMARY_USER_PREFIX + 'earlier stuff');
    expect(out[1]?.content).toBe(SUMMARY_ASSISTANT_ACK);
    expect(out[2]?.content).toBe('Add a note\n\n[Artifact Action: submit on note-1]');
    expect(out[3]?.content).toEqual(history[2]?.blocks);
    expect(out[4]?.content).toEqual(history[3]?.blocks);
    expect(out[5]?.content).toBe('Done.');
    expect(out[6]?.content).toBe('Thanks');
  });
  it('mints unique ids', () => {
    expect(newMessageId()).not.toBe(newMessageId());
  });
});
