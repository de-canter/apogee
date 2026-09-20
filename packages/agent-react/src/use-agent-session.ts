import { newMessageId, type AgentEvent, type AgentMessage } from '@de_canter/apogee-agent';
import { nowIso } from '@de_canter/apogee-kernel';
import { useCallback, useMemo, useReducer, useRef } from 'react';
import { displayMessages, initialAgentUiState, reduceAgentState, type AgentUiMessage, type AgentUiState } from './reducer';
import { decodeSseStream } from './sse-decoder';

export interface ArtifactActionInput { artifactId: string; actionType: string; data?: Record<string, unknown> }
export interface SendInput { text: string; annotations?: string[]; artifactAction?: ArtifactActionInput }
export type AgentTransport = (input: SendInput) => Promise<AsyncIterable<AgentEvent>>;

export interface UseAgentSessionOptions {
  transport: AgentTransport;
  initialMessages?: AgentMessage[];
  onEvent?: (event: AgentEvent) => void;
}

export interface UseAgentSessionResult {
  state: AgentUiState;
  displayMessages: AgentUiMessage[];
  sendMessage(text: string, opts?: Omit<SendInput, 'text'>): Promise<void>;
  reset(messages?: AgentMessage[]): void;
}

export function useAgentSession(options: UseAgentSessionOptions): UseAgentSessionResult {
  const [state, dispatch] = useReducer(reduceAgentState, options.initialMessages, initialAgentUiState);
  const inFlight = useRef(false);
  const onEvent = options.onEvent;
  const transport = options.transport;

  const sendMessage = useCallback(async (text: string, opts: Omit<SendInput, 'text'> = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: 'send', message: { id: newMessageId(), role: 'user', content: text, ...(opts.annotations ? { annotations: opts.annotations } : {}), at: nowIso() } });
    try {
      const events = await transport({ text, ...opts });
      for await (const event of events) {
        onEvent?.(event);
        dispatch({ type: 'event', event });
      }
    } catch (e) {
      dispatch({ type: 'event', event: { type: 'error', error: { code: 'TRANSPORT', message: e instanceof Error ? e.message : String(e) } } });
    } finally {
      inFlight.current = false;
    }
  }, [transport, onEvent]);

  const reset = useCallback((messages?: AgentMessage[]) => dispatch({ type: 'reset', ...(messages ? { messages } : {}) }), []);
  const shown = useMemo(() => displayMessages(state, nowIso), [state]);
  return { state, displayMessages: shown, sendMessage, reset };
}

export interface FetchSseTransportOptions {
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

/** POST JSON `{ message, annotations, artifactAction }` and decode the SSE body. */
export function fetchSseTransport(url: string, opts: FetchSseTransportOptions = {}): AgentTransport {
  const doFetch = opts.fetch ?? fetch;
  return async (input) => {
    const headers = typeof opts.headers === 'function' ? await opts.headers() : (opts.headers ?? {});
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ message: input.text, annotations: input.annotations ?? [], artifactAction: input.artifactAction }),
    });
    if (!res.ok || !res.body) throw new Error(`Agent request failed: ${res.status}`);
    return decodeSseStream(res.body);
  };
}
