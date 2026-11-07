import type { z } from 'zod';
import type { ActionIntent, Envelope, ListEnvelope } from './contract';
import { ChatKitError } from './errors';
import type { EntitlementCall, EntitlementPort } from './ports';

/** @internal */
export interface RunContext<TCtx, TPrincipal> {
  ctx: TCtx;
  principal: TPrincipal;
  entitlement: EntitlementPort<TPrincipal>;
  onError: (err: unknown, where: string) => void;
}

/** How a capability was declared; drives the MCP tool annotations. */
export type CapabilityKind = 'load' | 'list' | 'create' | 'transition' | 'query' | 'capability';

/** MCP tool annotations (readOnlyHint / destructiveHint) — what a host uses for auto-permissions. */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

/**
 * The one rule: loads and lists are read-only, as is a standalone capability
 * that declares `readOnly`; every other capability writes, and a write whose
 * intent is `destructive` (close, dismiss, remove) is flagged destructive.
 */
export function annotationsFor(kind: CapabilityKind, intent: ActionIntent | undefined, readOnly = false): ToolAnnotations {
  const readOnlyHint = kind === 'load' || kind === 'list' || (kind === 'capability' && readOnly);
  return { readOnlyHint, destructiveHint: !readOnlyHint && intent === 'destructive' };
}

export interface CapabilityInfo {
  name: string;
  title: string;
  description: string;
  resource: string;
  input: z.ZodType;
  output: z.ZodType;
  ui?: string | undefined;
  kind: CapabilityKind;
  annotations: ToolAnnotations;
}

/** @internal */
export interface CapabilitySpec<TCtx, TPrincipal> extends CapabilityInfo {
  describe(result: Envelope | ListEnvelope): string;
  /** Receives already-parsed input. Throws ChatKitError; anything else is INTERNAL. */
  run(input: unknown, c: RunContext<TCtx, TPrincipal>): Promise<Envelope | ListEnvelope>;
}

export interface GuardedResult<T> { result: T; entitlementView: unknown }

/** @internal Pipeline steps 5–7: assert, execute, settle (always, even on throw). */
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
