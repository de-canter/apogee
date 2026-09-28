import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { App } from '@modelcontextprotocol/ext-apps';
import { AnyEnvelopeSchema, describeEnvelope, type ActionDescriptor, type Envelope, type ListEnvelope } from '@de_canter/apogee-chat-kit';
import { parseToolResult, type FragmentError, type ToolResultLike } from './parse';

export interface EnvelopeTransport {
  /** Rejects with a FragmentError-shaped object. */
  call(capability: string, args: Record<string, unknown>): Promise<Envelope | ListEnvelope>;
  /** Pushes from the host (tool results). Returns an unsubscribe. */
  subscribe?(onEnvelope: (e: Envelope) => void, onError: (e: FragmentError) => void): () => void;
  /** After a successful act, e.g. tell the model what changed. */
  afterAct?(e: Envelope): Promise<void>;
}

function toFragmentError(err: unknown): FragmentError {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; allowed_next_actions?: ActionDescriptor[] };
    if (typeof e.code === 'string') {
      return e.allowed_next_actions
        ? { code: e.code, message: e.message, allowed_next_actions: e.allowed_next_actions }
        : { code: e.code, message: e.message };
    }
    return { code: 'INTERNAL', message: e.message };
  }
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const e = err as { code: unknown; message: unknown; allowed_next_actions?: ActionDescriptor[] };
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return e.allowed_next_actions ? { code: e.code, message: e.message, allowed_next_actions: e.allowed_next_actions } : { code: e.code, message: e.message };
    }
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}

function fragmentError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** For fragments: tools/call through the App, results parsed as envelopes, model context updated after each act. */
export function mcpAppTransport(app: App): EnvelopeTransport {
  return {
    async call(capability, args) {
      const result = await app.callServerTool({ name: capability, arguments: args });
      const parsed = parseToolResult(result as ToolResultLike);
      if ('error' in parsed) throw fragmentErrorFrom(parsed.error);
      return parsed.envelope;
    },
    subscribe(onEnvelope, onError) {
      app.ontoolresult = (params) => {
        const parsed = parseToolResult(params as ToolResultLike);
        if ('envelope' in parsed) onEnvelope(parsed.envelope);
        else onError(parsed.error);
      };
      return () => { app.ontoolresult = undefined; };
    },
    async afterAct(e) {
      await app.updateModelContext({ content: [{ type: 'text', text: describeEnvelope(e) }], structuredContent: e as unknown as Record<string, unknown> }).catch(() => undefined);
    },
  };
}

function fragmentErrorFrom(e: FragmentError): Error & { code: string; allowed_next_actions?: ActionDescriptor[] } {
  const err = Object.assign(new Error(e.message), { code: e.code });
  return e.allowed_next_actions ? Object.assign(err, { allowed_next_actions: e.allowed_next_actions }) : err;
}

/** For the product app: the host supplies one function that posts to its kit route and returns the parsed body (or throws). */
export function httpTransport(call: (capability: string, args: Record<string, unknown>) => Promise<unknown>): EnvelopeTransport {
  return {
    async call(capability, args) {
      let body: unknown;
      try {
        body = await call(capability, args);
      } catch (err) {
        throw fragmentErrorFrom(toFragmentError(err));
      }
      const asError = (body as { error?: unknown } | null)?.error;
      if (asError) throw fragmentErrorFrom(toFragmentError(asError));
      const parsed = AnyEnvelopeSchema.safeParse(body);
      if (parsed.success) return parsed.data;
      const list = (body as { items?: unknown } | null)?.items;
      if (Array.isArray(list)) return body as ListEnvelope;
      throw fragmentError('INVALID_INPUT', 'Response is not an envelope');
    },
  };
}

export interface EnvelopeState<TView> {
  envelope: Envelope<TView> | null;
  status: 'idle' | 'acting' | 'error';
  error: FragmentError | null;
  act: (action: ActionDescriptor, extraArgs?: Record<string, unknown>) => Promise<void>;
}

const Ctx = createContext<EnvelopeState<unknown> | null>(null);

export function EnvelopeProvider<TView>(props: { transport: EnvelopeTransport; initial?: Envelope<TView> | undefined; children: ReactNode }) {
  const { transport } = props;
  const [envelope, setEnvelope] = useState<Envelope<TView> | null>(props.initial ?? null);
  const [status, setStatus] = useState<EnvelopeState<TView>['status']>('idle');
  const [error, setError] = useState<FragmentError | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (!transport.subscribe) return undefined;
    return transport.subscribe(
      (e) => { setEnvelope(e as Envelope<TView>); setError(null); setStatus('idle'); },
      (e) => { setError(e); setStatus('error'); },
    );
  }, [transport]);

  const act = useCallback(async (action: ActionDescriptor, extraArgs: Record<string, unknown> = {}) => {
    if (pending.current) return;
    pending.current = true;
    setStatus('acting');
    setError(null);
    try {
      const next = await transport.call(action.capability, { ...action.args, ...extraArgs });
      if ('items' in next) throw fragmentError('INVALID_INPUT', 'Expected a single envelope');
      setEnvelope(next as Envelope<TView>);
      setStatus('idle');
      if (transport.afterAct) await transport.afterAct(next);
    } catch (err) {
      setError(toFragmentError(err));
      setStatus('error');
    } finally {
      pending.current = false;
    }
  }, [transport]);

  const value = useMemo<EnvelopeState<unknown>>(() => ({ envelope, status, error, act }), [envelope, status, error, act]);
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useEnvelope<TView = unknown>(): EnvelopeState<TView> {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEnvelope must be used inside <EnvelopeProvider>');
  return v as EnvelopeState<TView>;
}

export function useAction(action: ActionDescriptor): { run(extraArgs?: Record<string, unknown>): Promise<void>; pending: boolean } {
  const { act, status } = useEnvelope();
  const run = useCallback((extraArgs?: Record<string, unknown>) => act(action, extraArgs), [act, action]);
  return { run, pending: status === 'acting' };
}
