import { z } from 'zod';

/** Typed reference to any entity. `kind` is the product's concrete type name (e.g. 'Order'). */
export const RefSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});

export type Ref = z.infer<typeof RefSchema>;

export function ref(kind: string, id: string): Ref {
  return RefSchema.parse({ kind, id });
}

export function sameRef(a: Ref, b: Ref): boolean {
  return a.kind === b.kind && a.id === b.id;
}
