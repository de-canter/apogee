import type Anthropic from '@anthropic-ai/sdk';
import type { ModelId } from './catalog';
import type { ContentBlock, GenerateRequest, Message, SystemBlock } from './types';

const EPHEMERAL = { type: 'ephemeral' as const };

function toSdkBlock(b: ContentBlock): Anthropic.ContentBlockParam {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'image':
      return b.source.type === 'base64'
        ? { type: 'image', source: { type: 'base64', media_type: b.source.mediaType, data: b.source.data } }
        : { type: 'image', source: { type: 'url', url: b.source.url } };
    case 'document': {
      const source = b.source.type === 'base64'
        ? { type: 'base64' as const, media_type: 'application/pdf' as const, data: b.source.data }
        : { type: 'text' as const, media_type: 'text/plain' as const, data: b.source.data };
      return { type: 'document', source, ...(b.title !== undefined ? { title: b.title } : {}) };
    }
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content, ...(b.isError ? { is_error: true } : {}) };
  }
}

function toSdkMessage(m: Message): Anthropic.MessageParam {
  return { role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(toSdkBlock) };
}

/**
 * System blocks with one cache breakpoint: on the block marked `cache: true`
 * if any, else on the last block. Stable content must come first (prefix match).
 */
function toSystem(system: string | SystemBlock[] | undefined, cache: boolean): Anthropic.TextBlockParam[] | undefined {
  if (system === undefined) return undefined;
  const blocks = typeof system === 'string' ? [{ text: system }] : system;
  const explicit = blocks.some((b) => b.cache === true);
  return blocks.map((b, i) => {
    const flag = cache && (explicit ? b.cache === true : i === blocks.length - 1);
    return { type: 'text', text: b.text, ...(flag ? { cache_control: EPHEMERAL } : {}) };
  });
}

export interface BuildOptions { model: ModelId; streaming: boolean }

export function buildMessageParams(req: GenerateRequest, opts: BuildOptions): Anthropic.MessageCreateParams {
  const cache = req.cache !== false;
  const tools: Anthropic.Tool[] | undefined = req.tools?.map((t, i, arr) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    ...(t.strict ? { strict: true } : {}),
    ...(opts.streaming ? { eager_input_streaming: true } : {}),
    ...(cache && i === arr.length - 1 ? { cache_control: EPHEMERAL } : {}),
  }));
  const system = toSystem(req.system, cache);
  const userId = req.metadata?.['userId'];
  return {
    model: opts.model,
    max_tokens: req.maxTokens ?? (opts.streaming ? 64000 : 16000),
    messages: req.messages.map(toSdkMessage),
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(req.thinking === false ? {} : { thinking: { type: 'adaptive' } }),
    ...(req.effort ? { output_config: { effort: req.effort } } : {}),
    ...(req.stopSequences ? { stop_sequences: req.stopSequences } : {}),
    ...(userId !== undefined ? { metadata: { user_id: userId } } : {}),
  };
}
