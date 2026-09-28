import type { ActionDescriptor } from './contract';

export const CHAT_KIT_ERROR_CODES = [
  'ILLEGAL_TRANSITION', 'NOT_FOUND', 'INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'ENTITLEMENT', 'INTERNAL',
] as const;
export type ChatKitErrorCode = (typeof CHAT_KIT_ERROR_CODES)[number];

export interface IllegalTransitionDetails {
  resource: string;
  id: string;
  from: string;
  attempted: string;
  allowed: string[];
}

export interface ChatKitErrorJson {
  error: { code: ChatKitErrorCode; message: string; details?: unknown; allowed_next_actions?: ActionDescriptor[] };
}

export interface ChatKitErrorOptions {
  details?: unknown;
  allowed_next_actions?: ActionDescriptor[] | undefined;
}

export class ChatKitError extends Error {
  readonly code: ChatKitErrorCode;
  readonly details: unknown;
  readonly allowed_next_actions: ActionDescriptor[] | undefined;

  constructor(code: ChatKitErrorCode, message: string, opts: ChatKitErrorOptions = {}) {
    super(message);
    this.name = 'ChatKitError';
    this.code = code;
    this.details = opts.details;
    this.allowed_next_actions = opts.allowed_next_actions;
  }

  toJSON(): ChatKitErrorJson {
    const error: ChatKitErrorJson['error'] = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    if (this.allowed_next_actions !== undefined) error.allowed_next_actions = this.allowed_next_actions;
    return { error };
  }

  static is(e: unknown): e is ChatKitError {
    return e instanceof ChatKitError;
  }
}

export const STATUS_BY_CODE: Record<ChatKitErrorCode, number> = {
  ILLEGAL_TRANSITION: 409,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ENTITLEMENT: 402,
  INTERNAL: 500,
};
