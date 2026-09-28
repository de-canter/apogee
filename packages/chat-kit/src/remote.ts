import type { z } from 'zod';
import type { CapabilityInfo } from './capability';
import { AnyEnvelopeSchema, AnyListEnvelopeSchema, describeEnvelope, type Envelope, type ListEnvelope } from './contract';
import { ChatKitError, CHAT_KIT_ERROR_CODES, type ChatKitErrorCode } from './errors';
import { jsonSchemaStandard } from './json-schema';
import type { Kit } from './kit';
import type { KitManifest } from './manifest';
import type { AuthInfo } from './ports';

export { jsonSchemaStandard } from './json-schema';
export type { KitManifest, CapabilityManifestEntry } from './manifest';

export const KIT_TEXT_HEADER = 'x-kit-text';

export interface RemoteCallResult { status: number; body: unknown; text?: string | undefined }
export type RemoteCall = (capability: string, args: unknown, auth: AuthInfo | undefined) => Promise<RemoteCallResult>;

export interface RemoteKitOptions { manifest: KitManifest; call: RemoteCall }

function isCode(v: unknown): v is ChatKitErrorCode {
  return typeof v === 'string' && (CHAT_KIT_ERROR_CODES as readonly string[]).includes(v);
}

function toError(status: number, body: unknown): ChatKitError {
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown; allowed_next_actions?: unknown } } | null)?.error;
  if (err && isCode(err.code) && typeof err.message === 'string') {
    const opts: { details?: unknown; allowed_next_actions?: Envelope['allowed_next_actions'] | undefined } = {};
    if (err.details !== undefined) opts.details = err.details;
    if (Array.isArray(err.allowed_next_actions)) opts.allowed_next_actions = err.allowed_next_actions as Envelope['allowed_next_actions'];
    return new ChatKitError(err.code, err.message, opts);
  }
  if (status === 401) return new ChatKitError('UNAUTHENTICATED', 'Not authenticated');
  if (status === 404) return new ChatKitError('NOT_FOUND', 'Not found');
  return new ChatKitError('INTERNAL', `Remote kit returned ${status}`);
}

/** A Kit whose capabilities live behind HTTP: schemas from the manifest, calls forwarded, errors rethrown with their codes. */
export function createRemoteKit(opts: RemoteKitOptions): Kit {
  const texts = new WeakMap<object, string>();
  const infos = new Map<string, CapabilityInfo>();
  for (const c of opts.manifest.capabilities) {
    // CapabilityInfo.input/output are typed as zod (local kits are always zod); a remote kit's
    // capabilities carry a Standard JSON Schema instead. See the Task 3 report for why the type
    // was not widened to a union: it would ripple into pre-existing tests that call
    // `.input.safeParse` directly on a local CapabilitySpec/CapabilityInfo (resource.test.ts,
    // standalone.test.ts), which is more than the contained set of files this task allows.
    const info: CapabilityInfo = {
      name: c.name, title: c.title, description: c.description, resource: c.resource,
      input: jsonSchemaStandard(c.input_schema) as unknown as z.ZodType,
      output: jsonSchemaStandard(c.output_schema) as unknown as z.ZodType,
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
      const r = await opts.call(name, args, auth);
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
}

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** `Buffer.from(_, 'base64url')` never throws (invalid chars are just skipped), so the regex is the only guard. */
function decodeText(header: string | null): string | undefined {
  if (!header || !BASE64URL_RE.test(header)) return undefined;
  return Buffer.from(header, 'base64url').toString('utf8');
}

/** The default RemoteCall: JSON POST with the caller's bearer token and any static headers (an edge secret, say). */
export function httpKitCall(opts: HttpKitCallOptions): RemoteCall {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  return async (capability, args, auth) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', ...(opts.headers ?? {}) };
    if (auth?.token) headers['authorization'] = `Bearer ${auth.token}`;
    const res = await f(`${base}/${encodeURIComponent(capability)}`, { method: 'POST', headers, body: JSON.stringify(args ?? {}) });
    const raw = await res.text();
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* keep the raw text */ }
    const text = decodeText(res.headers.get(KIT_TEXT_HEADER));
    const out: RemoteCallResult = { status: res.status, body };
    if (text !== undefined) out.text = text;
    return out;
  };
}
