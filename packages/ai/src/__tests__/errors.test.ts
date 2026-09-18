import {
  APIConnectionError, AuthenticationError as SdkAuthenticationError, BadRequestError, InternalServerError, NotFoundError, RateLimitError,
} from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  AiError, AuthenticationError, ContextTooLongError, InvalidRequestError, OverloadedError, RateLimitedError, RefusalError,
  StructuredOutputError, mapSdkError,
} from '../errors';

const body = (type: string, message: string) => ({ type: 'error', error: { type, message } });

describe('mapSdkError', () => {
  it('maps SDK typed errors to the taxonomy with retryable flags', () => {
    const rl = mapSdkError(new RateLimitError(429, body('rate_limit_error', 'slow down'), 'slow down', new Headers()));
    expect(rl).toBeInstanceOf(RateLimitedError);
    expect(rl.retryable).toBe(true);
    const ov = mapSdkError(new InternalServerError(529, body('overloaded_error', 'Overloaded'), 'Overloaded', new Headers()));
    expect(ov).toBeInstanceOf(OverloadedError);
    const srv = mapSdkError(new InternalServerError(500, body('api_error', 'oops'), 'oops', new Headers()));
    expect(srv.code).toBe('SERVER');
    expect(srv.retryable).toBe(true);
    const bad = mapSdkError(new BadRequestError(400, body('invalid_request_error', 'prompt is too long: 250000 tokens'), 'prompt is too long: 250000 tokens', new Headers()));
    expect(bad).toBeInstanceOf(ContextTooLongError);
    const inv = mapSdkError(new BadRequestError(400, body('invalid_request_error', 'nope'), 'nope', new Headers()));
    expect(inv).toBeInstanceOf(InvalidRequestError);
    expect(inv.retryable).toBe(false);
    const auth = mapSdkError(new SdkAuthenticationError(401, body('authentication_error', 'bad key'), 'bad key', new Headers()));
    expect(auth).toBeInstanceOf(AuthenticationError);
    const nf = mapSdkError(new NotFoundError(404, body('not_found_error', 'no'), 'no', new Headers()));
    expect(nf.code).toBe('API');
    const conn = mapSdkError(new APIConnectionError({ message: 'down' }));
    expect(conn.code).toBe('CONNECTION');
    expect(conn.retryable).toBe(true);
  });
  it('wraps unknown errors and passes AiErrors through', () => {
    const e = mapSdkError(new Error('boom'));
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe('UNKNOWN');
    expect(mapSdkError('str').message).toBe('str');
    const r = new RefusalError('cyber', 'x');
    expect(mapSdkError(r)).toBe(r);
    expect(r.message).toContain('cyber');
    expect(new StructuredOutputError('{}', []).rawText).toBe('{}');
  });
});
