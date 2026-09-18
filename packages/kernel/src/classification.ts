import { z } from 'zod';

/** Taxonomy membership: the escape valve that prevents subclass explosion. */
export const ClassificationSchema = z.object({
  taxonomy: z.string().min(1),
  code: z.string().min(1),
  label: z.string().min(1).optional(),
  path: z.array(z.string().min(1)).optional(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ClassificationsSchema = z.array(ClassificationSchema).refine(
  (cs) => new Set(cs.map((c) => c.taxonomy)).size === cs.length,
  { message: 'One classification per taxonomy' },
);

export function classify(taxonomy: string, code: string, opts: Partial<Pick<Classification, 'label' | 'path'>> = {}): Classification {
  return ClassificationSchema.parse({ taxonomy, code, ...opts });
}
export function classificationIn(cs: readonly Classification[], taxonomy: string): Classification | undefined {
  return cs.find((c) => c.taxonomy === taxonomy);
}

const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TagSchema = z.string().regex(TAG, 'Tags are lowercase kebab-case');
export const TagsSchema = z.array(TagSchema).refine((t) => new Set(t).size === t.length, { message: 'Duplicate tag' });

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
