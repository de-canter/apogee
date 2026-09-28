import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isListEnvelope } from '@de_canter/apogee-chat-kit';
import { parseToolResult, toolResultText } from '../parse';
import { ticketEnvelope, ticketListEnvelope } from './harness';

describe('parseToolResult', () => {
  it('returns the envelope from structuredContent', () => {
    const r = parseToolResult({ content: [], structuredContent: ticketEnvelope() as unknown as Record<string, unknown> });
    expect('envelope' in r && !isListEnvelope(r.envelope) && r.envelope.state).toBe('open');
  });
  it('validates the view when given', () => {
    const r = parseToolResult({ content: [], structuredContent: ticketEnvelope() as unknown as Record<string, unknown> }, z.object({ title: z.number() }));
    expect('error' in r && r.error.code).toBe('INVALID_INPUT');
  });
  it('maps an isError result to a FragmentError with allowed actions', () => {
    const r = parseToolResult({ isError: true, content: [{ type: 'text', text: 'x' }], structuredContent: { error: { code: 'ILLEGAL_TRANSITION', message: 'no', allowed_next_actions: [{ capability: 'ticket_get', title: 'Back', args: { id: 't1' } }] } } });
    expect(r).toEqual({ error: { code: 'ILLEGAL_TRANSITION', message: 'no', allowed_next_actions: [{ capability: 'ticket_get', title: 'Back', args: { id: 't1' } }] } });
  });
  it('maps an isError result without JSON to INTERNAL with the text', () => {
    const r = parseToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(r).toEqual({ error: { code: 'INTERNAL', message: 'boom' } });
  });
  it('accepts a list envelope, validating each item view when given', () => {
    const r = parseToolResult({ content: [], structuredContent: ticketListEnvelope() as unknown as Record<string, unknown> });
    expect('envelope' in r && isListEnvelope(r.envelope) && r.envelope.items.map((i) => i.id)).toEqual(['t1', 't2']);
    const typed = parseToolResult({ content: [], structuredContent: ticketListEnvelope() as unknown as Record<string, unknown> }, z.object({ title: z.string() }));
    expect('envelope' in typed && isListEnvelope(typed.envelope)).toBe(true);
    const wrong = parseToolResult({ content: [], structuredContent: ticketListEnvelope() as unknown as Record<string, unknown> }, z.object({ title: z.number() }));
    expect('error' in wrong && wrong.error.code).toBe('INVALID_INPUT');
  });
  it('drops invalid allowed_next_actions on an error result', () => {
    const r = parseToolResult({ isError: true, content: [], structuredContent: { error: { code: 'FORBIDDEN', message: 'no', allowed_next_actions: [{ capability: 42 }] } } });
    expect(r).toEqual({ error: { code: 'FORBIDDEN', message: 'no' } });
  });
  it('an isError result with no text falls back to a generic message; toolResultText finds the first text block', () => {
    expect(parseToolResult({ isError: true })).toEqual({ error: { code: 'INTERNAL', message: 'Tool call failed' } });
    expect(toolResultText({ content: [{ type: 'image' }, { type: 'text', text: 'hello' }] })).toBe('hello');
    expect(toolResultText({})).toBeUndefined();
  });
  it('a non-envelope structuredContent is INVALID_INPUT, not a throw', () => {
    const r = parseToolResult({ content: [], structuredContent: { weather: 'sunny' } });
    expect('error' in r && r.error.code).toBe('INVALID_INPUT');
  });
});
