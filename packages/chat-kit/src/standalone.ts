import { z } from 'zod';
import { nowIso } from '@de_canter/apogee-kernel';
import { guarded, type CapabilitySpec } from './capability';
import { ActionDescriptorSchema, describeEnvelope, envelopeSchema, isListEnvelope, STATELESS, type ActionDescriptor, type Envelope } from './contract';
import { ChatKitError } from './errors';
import { assertSnakeCase, type CallContext, type InputSchema } from './resource';

export interface CapabilityDef<TCtx, TPrincipal, TView> {
  name: string;
  title: string;
  description?: string | undefined;
  input: InputSchema;
  view: z.ZodType<TView>;
  ui?: string | undefined;
  describe?: ((view: TView) => string) | undefined;
  execute(input: Record<string, unknown>, c: CallContext<TCtx, TPrincipal>): Promise<{ data: TView; allowed_next_actions?: ActionDescriptor[] | undefined; id?: string | undefined }>;
}

/** A tool that is not a lifecycle object (an aggregate like a home screen). */
export function defineCapability<TCtx, TPrincipal, TView>(def: CapabilityDef<TCtx, TPrincipal, TView>): CapabilitySpec<TCtx, TPrincipal> {
  assertSnakeCase('capability', def.name);
  const output = envelopeSchema(def.view);
  return {
    name: def.name,
    title: def.title,
    description: def.description ?? def.title,
    resource: def.name,
    input: def.input,
    output,
    ui: def.ui,
    describe: (e) => (def.describe && !isListEnvelope(e) ? def.describe((e as Envelope<TView>).data) : describeEnvelope(e)),
    async run(input, c) {
      const call = { principal: c.principal, capability: def.name, resource: def.name, input };
      const { result, entitlementView } = await guarded(c.entitlement, call, () => def.execute(input as Record<string, unknown>, { ctx: c.ctx, principal: c.principal }), c.onError);
      const parsed = def.view.safeParse(result.data);
      if (!parsed.success) throw new ChatKitError('INTERNAL', `${def.name} returned an invalid view`, { details: parsed.error.issues });
      const actions = z.array(ActionDescriptorSchema).safeParse(result.allowed_next_actions ?? []);
      if (!actions.success) throw new ChatKitError('INTERNAL', `${def.name} returned invalid allowed_next_actions`, { details: actions.error.issues });
      if (result.id !== undefined && (typeof result.id !== 'string' || result.id.length === 0)) {
        throw new ChatKitError('INTERNAL', `${def.name} returned an invalid id`);
      }
      const e: Envelope<TView> = {
        resource: def.name, id: result.id ?? null, state: STATELESS, data: result.data,
        allowed_next_actions: actions.data, at: nowIso(),
      };
      if (def.ui !== undefined) e.ui = { resource_uri: def.ui };
      if (entitlementView !== undefined) e.entitlement = entitlementView;
      return e;
    },
  };
}
