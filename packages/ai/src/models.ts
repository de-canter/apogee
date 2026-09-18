import type { ModelId } from './catalog';

/** Packages ask for a role; the host decides which model that means. */
export type ModelRole = 'default' | 'fast' | 'vision' | (string & {});
export type ModelResolver = (role: ModelRole) => ModelId;

export const DEFAULT_ROLE_MAP: Readonly<Record<string, ModelId>> = {
  default: 'claude-opus-5',
  fast: 'claude-haiku-4-5',
  vision: 'claude-opus-5',
};

export function staticResolver(map: Readonly<Record<string, ModelId>>, fallback?: ModelId): ModelResolver {
  const fb = fallback ?? map['default'] ?? DEFAULT_ROLE_MAP['default']!;
  return (role) => map[role] ?? fb;
}
