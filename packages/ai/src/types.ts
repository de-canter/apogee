import type { ModelId, RawUsage } from './catalog';
import type { AiError } from './errors';
import type { ModelRole } from './models';

export interface TextBlock { type: 'text'; text: string }
export interface ImageBlock {
  type: 'image';
  source:
    | { type: 'base64'; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }
    | { type: 'url'; url: string };
}
export interface DocumentBlock {
  type: 'document';
  source:
    | { type: 'base64'; mediaType: 'application/pdf'; data: string }
    | { type: 'text'; mediaType: 'text/plain'; data: string };
  title?: string;
}
/** A tool call the model made, replayed in assistant history for multi-round loops. */
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
/** The result of a tool call, sent back in a user message. */
export interface ToolResultBlock { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
export type ContentBlock = TextBlock | ImageBlock | DocumentBlock | ToolUseBlock | ToolResultBlock;

export interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[] }

/** A system prompt section. `cache: true` marks the end of the stable, cacheable prefix. */
export interface SystemBlock { text: string; cache?: boolean }

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  strict?: boolean;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface GenerateRequest {
  /** A role, never a model ID. Resolved by the host's ModelResolver. */
  model?: ModelRole;
  system?: string | SystemBlock[];
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  effort?: Effort;
  /** Adaptive thinking is on unless explicitly false. */
  thinking?: boolean;
  stopSequences?: string[];
  /** Prompt caching on system and tools; on unless explicitly false. */
  cache?: boolean;
  metadata?: Record<string, string>;
}

export type StopReason =
  | 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'refusal'
  | 'compaction' | 'model_context_window_exceeded';

export interface ToolUse { id: string; name: string; input: unknown }

export interface Usage extends RawUsage { model: ModelId; costUsd: number }

export interface GenerateResult {
  text: string;
  toolUses: ToolUse[];
  stopReason: StopReason;
  usage: Usage;
  raw: unknown;
}

export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string; name: string; input: unknown; parseError?: string }
  | { type: 'message_end'; stopReason: StopReason; usage: Usage; text: string; toolUses: ToolUse[] }
  | { type: 'error'; error: AiError };
