import type Anthropic from '@anthropic-ai/sdk';
import type { ModelCatalog, ModelId } from './catalog';
import { mapSdkError } from './errors';
import type { ModelEvent, StopReason, ToolUse } from './types';
import { usageFromSdk } from './usage';

interface ToolBlockState { id: string; name: string; json: string }

/**
 * Turn the SDK's raw stream events into the provider-neutral ModelEvent set.
 * Tool inputs are parsed when their block closes; unparseable input is reported
 * on `tool_use_end.parseError` and excluded from `message_end.toolUses`.
 */
export async function* normalizeStream(
  events: AsyncIterable<Anthropic.MessageStreamEvent>,
  ctx: { model: ModelId; catalog: ModelCatalog },
): AsyncGenerator<ModelEvent, void, undefined> {
  const blocks = new Map<number, ToolBlockState>();
  let text = '';
  const toolUses: ToolUse[] = [];
  let stopReason: StopReason = 'end_turn';
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  try {
    for await (const ev of events) {
      switch (ev.type) {
        case 'message_start':
          usage.input_tokens = ev.message.usage.input_tokens;
          usage.cache_read_input_tokens = ev.message.usage.cache_read_input_tokens ?? 0;
          usage.cache_creation_input_tokens = ev.message.usage.cache_creation_input_tokens ?? 0;
          break;
        case 'content_block_start':
          if (ev.content_block.type === 'tool_use') {
            blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
            yield { type: 'tool_use_start', id: ev.content_block.id, name: ev.content_block.name };
          }
          break;
        case 'content_block_delta':
          if (ev.delta.type === 'text_delta') {
            text += ev.delta.text;
            yield { type: 'text_delta', text: ev.delta.text };
          } else if (ev.delta.type === 'input_json_delta') {
            const b = blocks.get(ev.index);
            if (b) {
              b.json += ev.delta.partial_json;
              yield { type: 'tool_use_delta', id: b.id, partialJson: ev.delta.partial_json };
            }
          }
          break;
        case 'content_block_stop': {
          const b = blocks.get(ev.index);
          if (b) {
            blocks.delete(ev.index);
            const raw = b.json.trim() === '' ? '{}' : b.json;
            try {
              const input: unknown = JSON.parse(raw);
              toolUses.push({ id: b.id, name: b.name, input });
              yield { type: 'tool_use_end', id: b.id, name: b.name, input };
            } catch (e) {
              yield { type: 'tool_use_end', id: b.id, name: b.name, input: undefined, parseError: e instanceof Error ? e.message : String(e) };
            }
          }
          break;
        }
        case 'message_delta':
          if (ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
          usage.output_tokens = ev.usage.output_tokens;
          break;
        case 'message_stop':
          yield { type: 'message_end', stopReason, usage: usageFromSdk(ctx.model, ctx.catalog, usage), text, toolUses };
          return;
      }
    }
    // Stream ended without message_stop: still close out so consumers are not left hanging.
    yield { type: 'message_end', stopReason, usage: usageFromSdk(ctx.model, ctx.catalog, usage), text, toolUses };
  } catch (e) {
    yield { type: 'error', error: mapSdkError(e) };
  }
}
