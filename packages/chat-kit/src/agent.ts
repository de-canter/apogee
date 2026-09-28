import type { AnyTool, ToolContext, ToolResult } from '@de_canter/apogee-agent';
import { describeEnvelope, type Envelope, type ListEnvelope } from './contract';
import { ChatKitError } from './errors';
import type { Kit } from './kit';
import type { AuthInfo } from './ports';

export interface AgentToolsOptions<TCtx> {
  /** How the agent session's context yields the caller. */
  auth: (ctx: TCtx) => AuthInfo | undefined;
}

/**
 * Every kit capability as an apogee-agent tool. The envelope rides in `data` and as an artifact
 * typed by resource name. Requires a local kit: `CapabilityInfo.input` is typed as zod, but a
 * remote kit (`createRemoteKit`) actually carries a `StandardJsonSchema` there, which
 * `createToolRegistry` would otherwise pass straight into `z.toJSONSchema` and crash on with an
 * opaque zod error. Checked at runtime since the type alone can't tell local and remote apart
 * (the cast in `createRemoteKit` is what causes that in the first place).
 */
export function toAgentTools<TCtx>(kit: Kit, opts: AgentToolsOptions<TCtx>): AnyTool<TCtx>[] {
  return kit.list().map((cap) => {
    if (typeof (cap.input as { safeParse?: unknown }).safeParse !== 'function') {
      throw new Error(`toAgentTools requires a local kit (zod input schemas); got a remote kit capability: ${cap.name}`);
    }
    return {
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
    };
  });
}
