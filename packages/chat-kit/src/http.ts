import { describeEnvelope } from './contract';
import { ChatKitError, STATUS_BY_CODE } from './errors';
import type { Kit } from './kit';
import type { AuthInfo } from './ports';

export { STATUS_BY_CODE };

export interface HttpCall { capability: string; args: unknown; auth: AuthInfo | undefined }
export interface HttpResult { status: number; body: unknown; text?: string | undefined }

/** Transport-agnostic: the host builds HttpCall from its framework's request and writes HttpResult back. */
export function createHttpHandler(kit: Kit): (call: HttpCall) => Promise<HttpResult> {
  return async (call) => {
    try {
      const body = await kit.call(call.capability, call.args, call.auth);
      let text: string | undefined;
      try {
        text = kit.describe(call.capability, body);
      } catch {
        text = describeEnvelope(body);
      }
      return { status: 200, body, text };
    } catch (err) {
      const e = ChatKitError.is(err) ? err : new ChatKitError('INTERNAL', 'Capability failed');
      return { status: STATUS_BY_CODE[e.code], body: e.toJSON() };
    }
  };
}
