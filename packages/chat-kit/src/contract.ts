import { z } from 'zod';
import { ISODateSchema, type ISODate } from '@de_canter/apogee-kernel';

export const ActionIntentSchema = z.enum(['primary', 'secondary', 'destructive', 'poll']);
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

export const ActionDescriptorSchema = z.object({
  capability: z.string().min(1),
  title: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  intent: ActionIntentSchema.optional(),
});

/** One thing the caller may do next: a capability name plus prefilled arguments. */
export interface ActionDescriptor {
  capability: string;
  title: string;
  args: Record<string, unknown>;
  intent?: ActionIntent | undefined;
}

export const UiRefSchema = z.object({ resource_uri: z.string().min(1) });
export interface UiRef { resource_uri: string }

/** The state name used by capabilities that are not lifecycle objects. */
export const STATELESS = '-' as const;

export interface Envelope<TView = unknown> {
  resource: string;
  id: string | null;
  state: string;
  data: TView;
  allowed_next_actions: ActionDescriptor[];
  ui?: UiRef | undefined;
  entitlement?: unknown;
  at: ISODate;
}

export interface ListEnvelope<TView = unknown> {
  resource: string;
  items: Envelope<TView>[];
  next_cursor: string | null;
  allowed_next_actions: ActionDescriptor[];
  ui?: UiRef | undefined;
  at: ISODate;
}

export function envelopeSchema<V extends z.ZodType>(view: V) {
  return z.object({
    resource: z.string().min(1),
    id: z.string().nullable(),
    state: z.string().min(1),
    data: view,
    allowed_next_actions: z.array(ActionDescriptorSchema),
    ui: UiRefSchema.optional(),
    entitlement: z.unknown().optional(),
    at: ISODateSchema,
  });
}

export function listEnvelopeSchema<V extends z.ZodType>(view: V) {
  return z.object({
    resource: z.string().min(1),
    items: z.array(envelopeSchema(view)),
    next_cursor: z.string().nullable(),
    allowed_next_actions: z.array(ActionDescriptorSchema),
    ui: UiRefSchema.optional(),
    at: ISODateSchema,
  });
}

export const AnyEnvelopeSchema = envelopeSchema(z.unknown());
export const AnyListEnvelopeSchema = listEnvelopeSchema(z.unknown());

export function isListEnvelope(e: Envelope | ListEnvelope): e is ListEnvelope {
  return 'items' in e;
}

/** Model-facing text: compact JSON with capability names only. The default `describe`. */
export function describeEnvelope(e: Envelope | ListEnvelope): string {
  const next = e.allowed_next_actions.map((a) => a.capability);
  if (isListEnvelope(e)) {
    return JSON.stringify({
      resource: e.resource,
      items: e.items.map((i) => ({ id: i.id, state: i.state, data: i.data })),
      next_cursor: e.next_cursor,
      next,
    });
  }
  return JSON.stringify({ resource: e.resource, id: e.id, state: e.state, data: e.data, next });
}
