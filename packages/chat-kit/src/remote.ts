import type { z } from 'zod';
import type { CapabilityInfo } from './capability';
import { AnyEnvelopeSchema, AnyListEnvelopeSchema, describeEnvelope, type Envelope, type ListEnvelope } from './contract';
import { ChatKitError, CHAT_KIT_ERROR_CODES, type ChatKitErrorCode } from './errors';
import { KIT_WRAP_HEADER } from './http';
import { createAjv, jsonSchemaStandard } from './json-schema';
import type { Kit } from './kit';
import { KitManifestSchema, type KitManifest } from './manifest';
import type { AuthInfo } from './ports';

export { jsonSchemaStandard } from './json-schema';
export { KitManifestSchema } from './manifest';
export type { KitManifest, CapabilityManifestEntry } from './manifest';

export interface RemoteCallResult { status: number; body: unknown; text?: string | undefined }
export type RemoteCall = (capability: string, args: unknown, auth: AuthInfo | undefined) => Promise<RemoteCallResult>;

export interface RemoteKitOptions { manifest: KitManifest; call: RemoteCall }

function isCode(v: unknown): v is ChatKitErrorCode {
  return typeof v === 'string' && (CHAT_KIT_ERROR_CODES as readonly string[]).includes(v);
}

/** Codes for a non-2xx body that is not a ChatKitError envelope (a proxy's error page, a framework's own 4xx). */
const CODE_BY_STATUS: Partial<Record<number, { code: ChatKitErrorCode; message: string }>> = {
  400: { code: 'INVALID_INPUT', message: 'Invalid input' },
  401: { code: 'UNAUTHENTICATED', message: 'Not authenticated' },
  402: { code: 'ENTITLEMENT', message: 'Payment required' },
  403: { code: 'FORBIDDEN', message: 'Forbidden' },
  404: { code: 'NOT_FOUND', message: 'Not found' },
};

/** A string `message` from a foreign body: `{ message }` (Fastify, Express) or `{ error: { message } }`. */
function foreignMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as { message?: unknown; error?: { message?: unknown } | null };
  if (typeof b.error === 'object' && b.error !== null && typeof b.error.message === 'string') return b.error.message;
  return typeof b.message === 'string' ? b.message : undefined;
}

function toError(status: number, body: unknown): ChatKitError {
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown; allowed_next_actions?: unknown } } | null)?.error;
  if (err && isCode(err.code) && typeof err.message === 'string') {
    const opts: { details?: unknown; allowed_next_actions?: Envelope['allowed_next_actions'] | undefined } = {};
    if (err.details !== undefined) opts.details = err.details;
    if (Array.isArray(err.allowed_next_actions)) opts.allowed_next_actions = err.allowed_next_actions as Envelope['allowed_next_actions'];
    return new ChatKitError(err.code, err.message, opts);
  }
  const mapped = CODE_BY_STATUS[status];
  if (mapped) return new ChatKitError(mapped.code, foreignMessage(body) ?? mapped.message);
  // An unmapped status keeps a generic message: a foreign 5xx body may carry upstream internals.
  return new ChatKitError('INTERNAL', `Remote kit returned ${status}`);
}

/** A Kit whose capabilities live behind HTTP: schemas from the manifest, calls forwarded, errors rethrown with their codes. */
export function createRemoteKit(opts: RemoteKitOptions): Kit {
  const parsedManifest = KitManifestSchema.safeParse(opts.manifest);
  if (!parsedManifest.success) {
    const issue = parsedManifest.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new Error(`createRemoteKit: invalid manifest: ${where}${issue?.message ?? 'unknown issue'}`);
  }
  const manifest: KitManifest = parsedManifest.data;
  // One Ajv per kit: its compiled-schema cache lives and dies with the kit rather than growing a module global.
  const ajv = createAjv();
  const texts = new WeakMap<object, string>();
  const infos = new Map<string, CapabilityInfo>();
  for (const c of manifest.capabilities) {
    // CapabilityInfo.input/output are typed as zod (local kits are always zod); a remote kit's
    // capabilities carry a Standard JSON Schema instead. The type was not widened to a union: it
    // would ripple into every consumer that calls `.input.safeParse` on a local CapabilityInfo.
    const info: CapabilityInfo = {
      name: c.name, title: c.title, description: c.description, resource: c.resource,
      input: jsonSchemaStandard(c.input_schema, { ajv }) as unknown as z.ZodType,
      output: jsonSchemaStandard(c.output_schema, { ajv }) as unknown as z.ZodType,
      ui: c.ui,
    };
    infos.set(c.name, info);
  }
  return {
    list: () => [...infos.values()],
    get: (name) => infos.get(name),
    describe: (_name, result) => texts.get(result) ?? describeEnvelope(result),
    async call(name, args, auth) {
      if (!infos.has(name)) throw new ChatKitError('NOT_FOUND', `Unknown capability ${name}`);
      let r: RemoteCallResult;
      try {
        r = await opts.call(name, args, auth);
      } catch (err) {
        // A transport that already speaks ChatKitError (httpKitCall's timeout, say) keeps its code.
        if (ChatKitError.is(err)) throw err;
        throw new ChatKitError('INTERNAL', 'Remote kit call failed');
      }
      if (r.status < 200 || r.status >= 300) throw toError(r.status, r.body);
      const single = AnyEnvelopeSchema.safeParse(r.body);
      const parsed: Envelope | ListEnvelope | undefined = single.success ? single.data : AnyListEnvelopeSchema.safeParse(r.body).data;
      if (!parsed) throw new ChatKitError('INTERNAL', 'Remote kit returned a non-envelope body');
      if (r.text !== undefined) texts.set(parsed, r.text);
      return parsed;
    },
  };
}

export interface HttpKitCallOptions {
  /** e.g. https://api.example.com/api/v1/kit — the capability name is appended as a path segment */
  baseUrl: string;
  headers?: Record<string, string> | undefined;
  fetch?: typeof fetch | undefined;
  /** Whole-call deadline (request and body read), in ms. Default 30000. */
  timeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** A `{ envelope, text }` body from a host that honoured `x-kit-wrap: 1`. */
function unwrap(body: unknown): { envelope: unknown; text: string } | undefined {
  if (typeof body !== 'object' || body === null || !('envelope' in body)) return undefined;
  const { envelope, text } = body as { envelope: unknown; text?: unknown };
  return typeof text === 'string' ? { envelope, text } : undefined;
}

/**
 * The default RemoteCall: JSON POST with the caller's bearer token and any static headers (an edge secret, say).
 * Asks for the wrapped `{ envelope, text }` body (`x-kit-wrap: 1`) and accepts a bare envelope from a plain host.
 * A call that exceeds `timeoutMs` rejects with `ChatKitError('INTERNAL', 'Remote kit call timed out after <n>ms')`.
 */
export function httpKitCall(opts: HttpKitCallOptions): RemoteCall {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (capability, args, auth) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', ...(opts.headers ?? {}), [KIT_WRAP_HEADER]: '1' };
    if (auth?.token) headers['authorization'] = `Bearer ${auth.token}`;
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = (): ChatKitError => new ChatKitError('INTERNAL', `Remote kit call timed out after ${timeoutMs}ms`);
    const request = async (): Promise<RemoteCallResult> => {
      const res = await f(`${base}/${encodeURIComponent(capability)}`, { method: 'POST', headers, body: JSON.stringify(args ?? {}), signal });
      const raw = await res.text();
      let body: unknown = raw;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* keep the raw text */ }
      const wrapped = res.status >= 200 && res.status < 300 ? unwrap(body) : undefined;
      return wrapped ? { status: res.status, body: wrapped.envelope, text: wrapped.text } : { status: res.status, body };
    };
    // Race the signal too: a fetch that ignores its signal must still not hang the caller.
    let onAbort: (() => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      onAbort = () => { reject(timedOut()); };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([request(), deadline]);
    } catch (err) {
      if (signal.aborted) throw timedOut();
      throw err;
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
}
