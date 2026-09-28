import { App, PostMessageTransport, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { describeEnvelope, type ActionDescriptor, type Envelope } from '@de_canter/apogee-chat-kit';
import type { z } from 'zod';
import { parseToolResult, type FragmentError, type ParsedToolResult, type ToolResultLike } from './parse';
import { applyTheme, defaultThemeMap, type ThemeMap } from './theme';

export type FragmentStatus = 'idle' | 'acting' | 'error';

export interface FragmentContext<TView> {
  envelope: Envelope<TView> | null;
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
  let envelope: Envelope<TView> | null = null;
  let host: McpUiHostContext | null = null;
  let status: FragmentStatus = 'idle';
  let error: FragmentError | null = null;
  let pending = false;
  let destroyed = false;

  const render = (): void => opts.render({ envelope, host, status, error, act, ask, openLink });

  const receive = (r: Parameters<typeof parseToolResult>[0]): ParsedToolResult<TView> => {
    const parsed = parseToolResult<TView>(r, opts.view);
    if ('envelope' in parsed) { envelope = parsed.envelope; error = null; status = 'idle'; }
    else { error = parsed.error; status = 'error'; }
    return parsed;
  };

  async function act(action: ActionDescriptor, extraArgs: Record<string, unknown> = {}): Promise<void> {
    if (pending) return;
    pending = true;
    status = 'acting';
    error = null;
    render();
    try {
      const result = await app.callServerTool({ name: action.capability, arguments: { ...action.args, ...extraArgs } });
      const parsed = receive(result as ToolResultLike);
      render();
      if ('envelope' in parsed) {
        await app.updateModelContext({ content: [{ type: 'text', text: describeEnvelope(parsed.envelope) }], structuredContent: parsed.envelope as unknown as Record<string, unknown> }).catch(() => undefined);
      }
    } catch (err) {
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

  app.ontoolresult = (params) => { receive(params as ToolResultLike); render(); };
  app.ontoolinput = () => undefined;
  app.onhostcontextchanged = (params) => {
    host = { ...(host ?? {}), ...params };
    applyTheme(host, theme);
    render();
  };
  app.onteardown = () => ({});

  return {
    app,
    async connect(transport) {
      await app.connect(transport ?? new PostMessageTransport(window.parent, window.parent));
      host = app.getHostContext() ?? null;
      if (host) applyTheme(host, theme);
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      app.ontoolresult = undefined;
      app.ontoolinput = undefined;
      app.onhostcontextchanged = undefined;
      app.onteardown = undefined;
      void app.close().catch(() => undefined);
    },
  };
}
