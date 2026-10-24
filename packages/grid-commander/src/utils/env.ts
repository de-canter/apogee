/** True outside production builds; safe in browsers that define no `process`. */
export function isDev(): boolean {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.NODE_ENV !== 'production';
}
