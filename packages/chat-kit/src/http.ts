import { describeEnvelope } from './contract';
import { ChatKitError, STATUS_BY_CODE } from './errors';
import type { Kit } from './kit';
import type { AuthInfo } from './ports';

export { STATUS_BY_CODE };

/** Request header a remote kit (`httpKitCall`) sends to ask for the `{ envelope, text }` body. */
export const KIT_WRAP_HEADER = 'x-kit-wrap';

export interface HttpCall {
  capability: string;
  args: unknown;
  auth: AuthInfo | undefined;
  /** When true, a success body is `{ envelope, text }` instead of the bare envelope. Derive it with `wantsWrap(request.headers)`. */
  wrap?: boolean | undefined;
}
export interface HttpResult { status: number; body: unknown; text?: string | undefined }

type HeadersLike = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

/** True when the request carries `x-kit-wrap: 1`. Accepts a fetch `Headers` or a Node/Fastify header record. */
export function wantsWrap(headers: HeadersLike): boolean {
  if (typeof headers.get === 'function') return (headers as { get(name: string): string | null }).get(KIT_WRAP_HEADER) === '1';
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === KIT_WRAP_HEADER);
  const value = key === undefined ? undefined : record[key];
  return (Array.isArray(value) ? value[0] : value) === '1';
}

/** Transport-agnostic: the host builds HttpCall from its framework's request and writes HttpResult back. */
export function createHttpHandler(kit: Kit): (call: HttpCall) => Promise<HttpResult> {
  return async (call) => {
    try {
      const envelope = await kit.call(call.capability, call.args, call.auth);
      let text: string;
      try {
        text = kit.describe(call.capability, envelope);
      } catch {
        text = describeEnvelope(envelope);
      }
      return { status: 200, body: call.wrap === true ? { envelope, text } : envelope, text };
    } catch (err) {
      const e = ChatKitError.is(err) ? err : new ChatKitError('INTERNAL', 'Capability failed');
      return { status: STATUS_BY_CODE[e.code], body: e.toJSON() };
    }
  };
}
