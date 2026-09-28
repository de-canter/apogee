import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseToolResult } from '../parse';
import { ticketEnvelope } from './harness';

describe('parseToolResult', () => {
  it('returns the envelope from structuredContent', () => {
    const r = parseToolResult({ content: [], structuredContent: ticketEnvelope() as unknown as Record<string, unknown> });
    expect('envelope' in r && r.envelope.state).toBe('open');
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
  it('a non-envelope structuredContent is INVALID_INPUT, not a throw', () => {
    const r = parseToolResult({ content: [], structuredContent: { weather: 'sunny' } });
    expect('error' in r && r.error.code).toBe('INVALID_INPUT');
  });
});
