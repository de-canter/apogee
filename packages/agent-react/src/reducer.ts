import type { AgentEvent, AgentMessage } from '@apogee/agent';
import type { RawUsage, Usage } from '@apogee/ai';

export interface AgentUiMessage extends AgentMessage { streaming?: boolean }
export interface ActiveTool { toolUseId: string; name: string; input: unknown; startedAt: number }
export interface UsageTotals extends RawUsage { costUsd: number }

export interface AgentUiState {
  messages: AgentUiMessage[];
  streamingText: string;
  activeTools: ActiveTool[];
  isStreaming: boolean;
  lastUsage?: Usage;
  totalUsage: UsageTotals;
  error?: { code: string; message: string };
}

export type AgentUiAction =
  | { type: 'send'; message: AgentMessage }
  | { type: 'event'; event: AgentEvent; now?: number }
  | { type: 'reset'; messages?: AgentMessage[] };

const zero = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });

export function initialAgentUiState(messages: AgentMessage[] = []): AgentUiState {
  return { messages: messages.filter((m) => !m.hidden), streamingText: '', activeTools: [], isStreaming: false, totalUsage: zero() };
}

/** Pure: the same events the server emits drive the UI state. */
export function reduceAgentState(state: AgentUiState, action: AgentUiAction): AgentUiState {
  switch (action.type) {
    case 'reset':
      return initialAgentUiState(action.messages);
    case 'send': {
      const { error, ...rest } = state;
      return { ...rest, messages: [...state.messages, action.message], streamingText: '', activeTools: [], isStreaming: true };
    }
    case 'event': {
      const e = action.event;
      switch (e.type) {
        case 'text_delta':
          return { ...state, streamingText: state.streamingText + e.text };
        case 'tool_call':
          return { ...state, activeTools: [...state.activeTools, { toolUseId: e.toolUseId, name: e.name, input: e.input, startedAt: action.now ?? Date.now() }] };
        case 'tool_result':
          return { ...state, activeTools: state.activeTools.filter((t) => t.toolUseId !== e.toolUseId), streamingText: '' };
        case 'artifact':
          return state;
        case 'turn_end': {
          const u = e.usage;
          const t = state.totalUsage;
          return {
            ...state,
            messages: [...state.messages, e.message],
            streamingText: '',
            activeTools: [],
            isStreaming: false,
            lastUsage: u,
            totalUsage: { input: t.input + u.input, output: t.output + u.output, cacheRead: t.cacheRead + u.cacheRead, cacheWrite: t.cacheWrite + u.cacheWrite, costUsd: t.costUsd + u.costUsd },
          };
        }
        case 'error':
          return { ...state, isStreaming: false, activeTools: [], error: e.error };
      }
    }
  }
}

/** Messages plus a synthetic streaming assistant message while a turn is in flight. */
export function displayMessages(state: AgentUiState, now: () => string): AgentUiMessage[] {
  if (!state.isStreaming || state.streamingText === '') return state.messages;
  return [...state.messages, { id: 'streaming', role: 'assistant', content: state.streamingText, streaming: true, at: now() as AgentUiMessage['at'] }];
}
