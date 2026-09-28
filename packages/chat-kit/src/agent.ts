import type { AnyTool, ToolContext, ToolResult } from '@de_canter/apogee-agent';
import { describeEnvelope, type Envelope, type ListEnvelope } from './contract';
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
      let env: Envelope | ListEnvelope;
      try {
        env = await kit.call(cap.name, input, opts.auth(context.ctx));
      } catch (err) {
        const e = ChatKitError.is(err) ? err : new ChatKitError('INTERNAL', 'Capability failed');
        return { success: false, error: e.code, message: e.message, data: e.toJSON() };
      }
      // The write has committed by now: a throwing host describe falls back to the default.
      let message: string;
      try {
        message = kit.describe(cap.name, env);
      } catch {
        message = describeEnvelope(env);
      }
      return { success: true, message, data: env, artifact: { type: cap.resource, id: context.toolUseId, data: env } };
    },
  }));
}
