import type { z } from 'zod';
import type { Envelope, ListEnvelope } from './contract';
import { ChatKitError } from './errors';
import type { EntitlementCall, EntitlementPort } from './ports';

export interface RunContext<TCtx, TPrincipal> {
  ctx: TCtx;
  principal: TPrincipal;
  entitlement: EntitlementPort<TPrincipal>;
  onError: (err: unknown, where: string) => void;
}

export interface CapabilityInfo {
  name: string;
  title: string;
  description: string;
  resource: string;
  input: z.ZodType;
  output: z.ZodType;
  ui?: string | undefined;
}

export interface CapabilitySpec<TCtx, TPrincipal> extends CapabilityInfo {
  describe(result: Envelope | ListEnvelope): string;
  /** Receives already-parsed input. Throws ChatKitError; anything else is INTERNAL. */
  run(input: unknown, c: RunContext<TCtx, TPrincipal>): Promise<Envelope | ListEnvelope>;
}

export interface GuardedResult<T> { result: T; entitlementView: unknown }

/** Pipeline steps 5–7: assert, execute, settle (always, even on throw). */
export async function guarded<TPrincipal, T>(
  port: EntitlementPort<TPrincipal>,
  call: EntitlementCall<TPrincipal>,
  fn: () => Promise<T>,
  onError: (err: unknown, where: string) => void,
): Promise<GuardedResult<T>> {
  const decision = await port.assert(call);
  if (!decision.ok) {
    throw new ChatKitError('ENTITLEMENT', decision.reason, { details: decision.details, allowed_next_actions: decision.allowed_next_actions });
  }
  let success = false;
  try {
    const result = await fn();
    success = true;
    return { result, entitlementView: decision.view };
  } finally {
    if (port.settle) {
      try {
        await port.settle(call, { success });
      } catch (err) {
        onError(err, `${call.capability}:settle`);
      }
    }
  }
}
