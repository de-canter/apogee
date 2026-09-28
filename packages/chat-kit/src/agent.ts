import type { AnyTool, ToolContext, ToolResult } from '@de_canter/apogee-agent';
import { ChatKitError } from './errors';
import type { Kit } from './kit';
import type { AuthInfo } from './ports';

export interface AgentToolsOptions<TCtx> {
  /** How the agent session's context yields the caller. */
  auth: (ctx: TCtx) => AuthInfo | undefined;
}

/** Every kit capability as an apogee-agent tool. The envelope rides in `data` and as an artifact typed by resource name. */
export function toAgentTools<TCtx>(kit: Kit, opts: AgentToolsOptions<TCtx>): AnyTool<TCtx>[] {
  return kit.list().map((cap) => ({
    name: cap.name,
    description: cap.description,
    input: cap.input,
    async execute(input: unknown, context: ToolContext<TCtx>): Promise<ToolResult> {
      try {
        const env = await kit.call(cap.name, input, opts.auth(context.ctx));
        return {
          success: true,
          message: kit.describe(cap.name, env),
          data: env,
          artifact: { type: cap.resource, id: context.toolUseId, data: env },
        };
      } catch (err) {
        const e = ChatKitError.is(err) ? err : new ChatKitError('INTERNAL', 'Capability failed');
        return { success: false, error: e.code, message: e.message, data: e.toJSON() };
      }
    },
  }));
}
