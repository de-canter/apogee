import type { ContentBlock, Message, Usage } from '@de_canter/apogee-ai';
import type { ISODate } from '@de_canter/apogee-kernel';
import type { ArtifactDescriptor, ToolResult } from './tool';

export interface ToolCallRecord {
  toolUseId: string;
  name: string;
  input: unknown;
  result?: ToolResult;
  durationMs?: number;
  isError?: boolean;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'summary';
  /** User-visible text: what the user typed, or the assistant's concatenated text. */
  content: string;
  /** Server-side additions the model sees and the UI does not (artifact actions, uploads). */
  annotations?: string[];
  /** Exact model content blocks for tool-use turns, so history replays faithfully. */
  blocks?: ContentBlock[];
  toolCalls?: ToolCallRecord[];
  artifacts?: ArtifactDescriptor[];
  usage?: Usage;
  /** Intermediate tool-use turns and tool-result turns: replayed to the model, skipped by UIs. */
  hidden?: boolean;
  at: ISODate;
}

export const SUMMARY_USER_PREFIX = '[Conversation summary from earlier in this session]:\n';
export const SUMMARY_ASSISTANT_ACK = 'Understood. I have the context from our earlier conversation and will continue from here.';

export function newMessageId(): string {
  return crypto.randomUUID();
}

function userText(m: AgentMessage): string {
  return [m.content, ...(m.annotations ?? [])].filter((s) => s.trim() !== '').join('\n\n');
}

/** Convert stored history into model messages. Summaries expand to a user/assistant pair. */
export function toModelMessages(history: readonly AgentMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of history) {
    if (m.role === 'summary') {
      if (m.content.trim() === '') continue;
      out.push({ role: 'user', content: SUMMARY_USER_PREFIX + m.content });
      out.push({ role: 'assistant', content: SUMMARY_ASSISTANT_ACK });
      continue;
    }
    if (m.blocks && m.blocks.length > 0) {
      out.push({ role: m.role, content: m.blocks });
      continue;
    }
    const text = m.role === 'user' ? userText(m) : m.content;
    if (text.trim() === '') continue;
    out.push({ role: m.role, content: text });
  }
  return out;
}
