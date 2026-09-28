import type { z } from 'zod';
import { AnyEnvelopeSchema, envelopeSchema, type ActionDescriptor, type Envelope } from '@de_canter/apogee-chat-kit';

export interface FragmentError {
  code: string;
  message: string;
  allowed_next_actions?: ActionDescriptor[] | undefined;
}

/** The subset of the MCP CallToolResult a fragment cares about. */
export interface ToolResultLike {
  content?: Array<{ type: string; text?: string | undefined }> | undefined;
  structuredContent?: Record<string, unknown> | undefined;
  isError?: boolean | undefined;
}

export type ParsedToolResult<TView> = { envelope: Envelope<TView> } | { error: FragmentError };

function textOf(r: ToolResultLike): string {
  return r.content?.find((c) => c.type === 'text')?.text ?? 'Tool call failed';
}

/** Never throws: an isError result becomes a FragmentError; a non-envelope payload is INVALID_INPUT. */
export function parseToolResult<TView = unknown>(r: ToolResultLike, view?: z.ZodType<TView>): ParsedToolResult<TView> {
  if (r.isError) {
    const err = (r.structuredContent as { error?: Partial<FragmentError> } | undefined)?.error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') {
      const out: FragmentError = { code: err.code, message: err.message };
      if (err.allowed_next_actions) out.allowed_next_actions = err.allowed_next_actions;
      return { error: out };
    }
    return { error: { code: 'INTERNAL', message: textOf(r) } };
  }
  const schema = view ? envelopeSchema(view) : AnyEnvelopeSchema;
  const parsed = schema.safeParse(r.structuredContent);
  if (!parsed.success) return { error: { code: 'INVALID_INPUT', message: 'Tool result is not an envelope' } };
  return { envelope: parsed.data as Envelope<TView> };
}
