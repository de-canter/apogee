import { App, PostMessageTransport, type AppEventMap, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { describeEnvelope, type ActionDescriptor, type Envelope, type ListEnvelope } from '@de_canter/apogee-chat-kit';
import type { z } from 'zod';
import { parseToolResult, toolResultText, type FragmentError, type ParsedToolResult, type ToolResultLike } from './parse';
import { applyTheme, defaultThemeMap, type ThemeMap } from './theme';

export type FragmentStatus = 'idle' | 'acting' | 'error';

export interface FragmentContext<TView> {
  /** A single envelope or a list envelope; `isListEnvelope` from chat-kit tells them apart. */
  envelope: Envelope<TView> | ListEnvelope<TView> | null;
  host: McpUiHostContext | null;
  status: FragmentStatus;
  error: FragmentError | null;
  act(action: ActionDescriptor, extraArgs?: Record<string, unknown>): Promise<void>;
  ask(text: string): Promise<void>;
  openLink(url: string): Promise<void>;
}

export interface FragmentOptions<TView> {
  name: string;
  version: string;
  render(c: FragmentContext<TView>): void;
  view?: z.ZodType<TView> | undefined;
  theme?: ThemeMap | undefined;
  /** Injectable for tests; defaults to a new App. */
  app?: App | undefined;
}

export interface Fragment {
  app: App;
  connect(transport?: Parameters<App['connect']>[0]): Promise<void>;
  destroy(): void;
}

/** Wraps the MCP Apps App: tool results become envelopes, actions become tools/call, and the model is told what changed. */
export function createFragment<TView = unknown>(opts: FragmentOptions<TView>): Fragment {
  const app = opts.app ?? new App({ name: opts.name, version: opts.version });
  const theme = opts.theme ?? defaultThemeMap;
  let envelope: Envelope<TView> | ListEnvelope<TView> | null = null;
  let host: McpUiHostContext | null = null;
  let status: FragmentStatus = 'idle';
  let error: FragmentError | null = null;
  let pending = false;
  let destroyed = false;

  /** A throwing render never escapes: it lands in status 'error' (INTERNAL) and gets one more render. */
  const render = (): void => {
    if (destroyed) return;
    try {
      opts.render({ envelope, host, status, error, act, ask, openLink });
    } catch (err) {
      error = { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
      status = 'error';
      try {
        opts.render({ envelope, host, status, error, act, ask, openLink });
      } catch {
        // The product's render cannot even show the error; nothing more the runtime can do.
      }
    }
  };

  const receive = (r: ToolResultLike): ParsedToolResult<TView> => {
    const parsed = parseToolResult<TView>(r, opts.view);
    if ('envelope' in parsed) { envelope = parsed.envelope; error = null; status = 'idle'; }
    else { error = parsed.error; status = 'error'; }
    return parsed;
  };

  async function act(action: ActionDescriptor, extraArgs: Record<string, unknown> = {}): Promise<void> {
    if (pending || destroyed) return;
    pending = true;
    status = 'acting';
    error = null;
    render();
    try {
      const result = (await app.callServerTool({ name: action.capability, arguments: { ...action.args, ...extraArgs } })) as ToolResultLike;
      if (destroyed) return;
      const parsed = receive(result);
      render();
      if ('envelope' in parsed) {
        // Prefer the server's describe text: it is what the model would have seen for this tool.
        const text = toolResultText(result) ?? describeEnvelope(parsed.envelope);
        await app.updateModelContext({ content: [{ type: 'text', text }], structuredContent: parsed.envelope as unknown as Record<string, unknown> }).catch(() => undefined);
      }
    } catch (err) {
      if (destroyed) return;
      error = { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
      status = 'error';
      render();
    } finally {
      pending = false;
    }
  }

  async function ask(text: string): Promise<void> {
    await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
  }

  async function openLink(url: string): Promise<void> {
    await app.openLink({ url });
  }

  const onToolResult = (params: AppEventMap['toolresult']): void => { receive(params as ToolResultLike); render(); };
  const onToolInput = (): void => undefined;
  const onHostContext = (params: AppEventMap['hostcontextchanged']): void => {
    host = { ...(host ?? {}), ...params };
    applyTheme(host, theme);
    render();
  };
  // Registered before connect(), as the ext-apps SDK requires for one-shot events.
  app.addEventListener('toolresult', onToolResult);
  app.addEventListener('toolinput', onToolInput);
  app.addEventListener('hostcontextchanged', onHostContext);

  const close = (): void => { void app.close().catch(() => undefined); };

  function shutdown(closeNow: boolean): void {
    if (destroyed) return;
    destroyed = true;
    app.removeEventListener('toolresult', onToolResult);
    app.removeEventListener('toolinput', onToolInput);
    app.removeEventListener('hostcontextchanged', onHostContext);
    app.onteardown = undefined;
    // During a host teardown the connection must stay open until the teardown response is sent.
    if (closeNow) close();
    else setTimeout(close, 0);
  }

  app.onteardown = () => { shutdown(false); return {}; };

  return {
    app,
    async connect(transport) {
      await app.connect(transport ?? new PostMessageTransport(window.parent, window.parent));
      host = app.getHostContext() ?? null;
      if (host) applyTheme(host, theme);
      render();
    },
    destroy: () => { shutdown(true); },
  };
}
