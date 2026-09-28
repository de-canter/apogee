import type { McpServer, ServerContext } from '@modelcontextprotocol/server';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { describeEnvelope, type Envelope, type ListEnvelope } from './contract';
import { ChatKitError } from './errors';
import type { Kit } from './kit';
import type { AuthInfo } from './ports';

export interface FragmentDef {
  uri: string;
  name: string;
  html: string | (() => Promise<string>);
  csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] } | undefined;
  permissions?: { camera?: Record<never, never>; microphone?: Record<never, never>; geolocation?: Record<never, never>; clipboardWrite?: Record<never, never> } | undefined;
  domain?: string | undefined;
  prefersBorder?: boolean | undefined;
}

export interface RegisterKitOptions {
  fragments?: FragmentDef[] | undefined;
  auth?: ((ctx: ServerContext) => AuthInfo | undefined) | undefined;
}

/** Reads the transport's AuthInfo off the SDK 2 handler context. */
export function defaultAuth(ctx: ServerContext): AuthInfo | undefined {
  const a = ctx.http?.authInfo;
  if (!a) return undefined;
  const extra = (a as { extra?: Record<string, unknown> }).extra;
  return { token: a.token, clientId: a.clientId, scopes: a.scopes, extra };
}

export function fragmentMeta(f: FragmentDef): Record<string, unknown> {
  const ui: Record<string, unknown> = {};
  if (f.csp) ui['csp'] = f.csp;
  if (f.permissions) ui['permissions'] = f.permissions;
  if (f.domain !== undefined) ui['domain'] = f.domain;
  ui['prefersBorder'] = f.prefersBorder ?? false;
  return ui;
}

/** Model-facing error text. structuredContent is UI-only under MCP Apps, so the allowed next actions ride in the text. */
function errorText(e: ChatKitError): string {
  const names = (e.allowed_next_actions ?? []).map((a) => a.capability);
  return names.length > 0 ? `${e.code}: ${e.message} Allowed next: ${names.join(', ')}` : `${e.code}: ${e.message}`;
}

/** kit.describe, falling back to the default describe when the host's describe throws. */
function safeDescribe(kit: Kit, name: string, result: Envelope | ListEnvelope): string {
  try {
    return kit.describe(name, result);
  } catch {
    return describeEnvelope(result);
  }
}

/** Registers every kit capability as an MCP tool (with UI metadata when the capability has a fragment) and every fragment as a ui:// resource. */
export function registerKit(server: McpServer, kit: Kit, opts: RegisterKitOptions = {}): void {
  const auth = opts.auth ?? defaultAuth;
  for (const cap of kit.list()) {
    registerAppTool(
      server,
      cap.name,
      {
        title: cap.title,
        description: cap.description,
        inputSchema: cap.input,
        outputSchema: cap.output,
        _meta: cap.ui !== undefined ? { ui: { resourceUri: cap.ui } } : {},
      },
      async (args: unknown, ctx: ServerContext) => {
        let result: Envelope | ListEnvelope;
        try {
          result = await kit.call(cap.name, args, auth(ctx));
        } catch (err) {
          const e = ChatKitError.is(err) ? err : new ChatKitError('INTERNAL', 'Capability failed');
          return { isError: true, content: [{ type: 'text' as const, text: errorText(e) }], structuredContent: e.toJSON() as unknown as Record<string, unknown> };
        }
        // The write has committed by now: a throwing host describe must not turn it into an error.
        return { content: [{ type: 'text' as const, text: safeDescribe(kit, cap.name, result) }], structuredContent: result as unknown as Record<string, unknown> };
      },
    );
  }
  for (const f of opts.fragments ?? []) {
    registerAppResource(server, f.name, f.uri, { mimeType: RESOURCE_MIME_TYPE }, async () => {
      const html = typeof f.html === 'string' ? f.html : await f.html();
      return { contents: [{ uri: f.uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: fragmentMeta(f) } }] };
    });
  }
}
