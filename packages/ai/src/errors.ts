import {
  APIConnectionError, APIError, AuthenticationError as SdkAuthenticationError, BadRequestError, RateLimitError,
} from '@anthropic-ai/sdk';

export class AiError extends Error {
  constructor(message: string, readonly code: string, readonly retryable = false, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}
export class RateLimitedError extends AiError {
  constructor(m: string, cause?: unknown) { super(m, 'RATE_LIMITED', true, { cause }); }
}
export class OverloadedError extends AiError {
  constructor(m: string, cause?: unknown) { super(m, 'OVERLOADED', true, { cause }); }
}
export class ContextTooLongError extends AiError {
  constructor(m: string, cause?: unknown) { super(m, 'CONTEXT_TOO_LONG', false, { cause }); }
}
export class InvalidRequestError extends AiError {
  constructor(m: string, cause?: unknown) { super(m, 'INVALID_REQUEST', false, { cause }); }
}
export class AuthenticationError extends AiError {
  constructor(m: string, cause?: unknown) { super(m, 'AUTHENTICATION', false, { cause }); }
}
export class RefusalError extends AiError {
  constructor(readonly category?: string, readonly explanation?: string) {
    super(`Model refused${category ? ` (${category})` : ''}`, 'REFUSAL', false);
  }
}
export class StructuredOutputError extends AiError {
  constructor(readonly rawText: string, readonly issues: unknown) {
    super('Structured output did not match schema', 'STRUCTURED_OUTPUT', false);
  }
}

export function mapSdkError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof RateLimitError) return new RateLimitedError(e.message, e);
  if (e instanceof SdkAuthenticationError) return new AuthenticationError(e.message, e);
  if (e instanceof BadRequestError) {
    return /too long|context window|exceeds/i.test(e.message)
      ? new ContextTooLongError(e.message, e)
      : new InvalidRequestError(e.message, e);
  }
  if (e instanceof APIConnectionError) return new AiError(e.message, 'CONNECTION', true, { cause: e });
  if (e instanceof APIError) {
    if (e.status === 529 || /overloaded/i.test(e.message)) return new OverloadedError(e.message, e);
    if (e.status !== undefined && e.status >= 500) return new AiError(e.message, 'SERVER', true, { cause: e });
    return new AiError(e.message, 'API', false, { cause: e });
  }
  return new AiError(e instanceof Error ? e.message : String(e), 'UNKNOWN', false, { cause: e });
}
