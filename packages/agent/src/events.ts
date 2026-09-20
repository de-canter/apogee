import type { Usage } from '@de_canter/apogee-ai';
import type { AgentMessage } from './messages';
import type { ArtifactDescriptor, ToolResult } from './tool';

export type TurnStopReason = 'end_turn' | 'max_rounds' | 'refusal' | 'max_tokens';

/** The one event stream: in-process API and, encoded one frame per event, the SSE wire protocol. */
export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; name: string; result: ToolResult; durationMs: number; isError: boolean }
  | { type: 'artifact'; toolUseId: string; artifact: ArtifactDescriptor }
  | { type: 'turn_end'; message: AgentMessage; usage: Usage; rounds: number; stopReason: TurnStopReason }
  | { type: 'error'; error: { code: string; message: string } };
