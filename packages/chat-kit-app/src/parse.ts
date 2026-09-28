import { z } from 'zod';
import {
  ActionDescriptorSchema, AnyEnvelopeSchema, AnyListEnvelopeSchema, envelopeSchema, listEnvelopeSchema,
  type ActionDescriptor, type Envelope, type ListEnvelope,
} from '@de_canter/apogee-chat-kit';

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

export type ParsedToolResult<TView> = { envelope: Envelope<TView> | ListEnvelope<TView> } | { error: FragmentError };

/** The first text content block of a tool result: the server's model-facing describe text. */
export function toolResultText(r: ToolResultLike): string | undefined {
  return r.content?.find((c) => c.type === 'text' && typeof c.text === 'string')?.text;
}

const ActionListSchema = z.array(ActionDescriptorSchema);

/** Never throws: an isError result becomes a FragmentError; a payload that is neither an envelope nor a list envelope is INVALID_INPUT. */
export function parseToolResult<TView = unknown>(r: ToolResultLike, view?: z.ZodType<TView>): ParsedToolResult<TView> {
  if (r.isError) {
    const err = (r.structuredContent as { error?: { code?: unknown; message?: unknown; allowed_next_actions?: unknown } } | undefined)?.error;
    if (err && typeof err.code === 'string' && typeof err.message === 'string') {
      const out: FragmentError = { code: err.code, message: err.message };
      if (err.allowed_next_actions !== undefined) {
        // Dropped, not trusted, when the server sent something that is not an action list.
        const actions = ActionListSchema.safeParse(err.allowed_next_actions);
        if (actions.success) out.allowed_next_actions = actions.data;
      }
      return { error: out };
    }
    return { error: { code: 'INTERNAL', message: toolResultText(r) ?? 'Tool call failed' } };
  }
  const one = (view ? envelopeSchema(view) : AnyEnvelopeSchema).safeParse(r.structuredContent);
  if (one.success) return { envelope: one.data as Envelope<TView> };
  const list = (view ? listEnvelopeSchema(view) : AnyListEnvelopeSchema).safeParse(r.structuredContent);
  if (list.success) return { envelope: list.data as ListEnvelope<TView> };
  return { error: { code: 'INVALID_INPUT', message: 'Tool result is not an envelope' } };
}
