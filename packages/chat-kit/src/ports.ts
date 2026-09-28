import type { ActionDescriptor } from './contract';

/** What a transport knows about the caller. Mirrors the MCP SDK's AuthInfo without importing it. */
export interface AuthInfo {
  token?: string | undefined;
  clientId?: string | undefined;
  scopes?: string[] | undefined;
  extra?: Record<string, unknown> | undefined;
}

/** Resolves the caller. Throws ChatKitError('UNAUTHENTICATED') (or anything, mapped to it) when it cannot. */
export type PrincipalResolver<TPrincipal> = (auth: AuthInfo | undefined) => Promise<TPrincipal>;

export interface EntitlementCall<TPrincipal> {
  principal: TPrincipal;
  capability: string;
  resource: string;
  input: unknown;
}

export type EntitlementDecision =
  | { ok: true; view?: unknown }
  | { ok: false; reason: string; details?: unknown; allowed_next_actions?: ActionDescriptor[] | undefined };

export interface EntitlementPort<TPrincipal> {
  assert(call: EntitlementCall<TPrincipal>): Promise<EntitlementDecision>;
  settle?(call: EntitlementCall<TPrincipal>, outcome: { success: boolean }): Promise<void>;
}

export const allowAll: EntitlementPort<unknown> = {
  assert: () => Promise.resolve({ ok: true }),
};
