/** Typed readers for `cellConfig` / `cellEditorConfig`, which arrive as `Record<string, unknown>`. */
export type Config = Record<string, unknown>;

export function str(config: Config, key: string, fallback: string): string;
export function str(config: Config, key: string): string | undefined;
export function str(config: Config, key: string, fallback?: string): string | undefined {
  const v = config[key];
  return typeof v === 'string' ? v : fallback;
}

export function num(config: Config, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function bool(config: Config, key: string, fallback = false): boolean {
  const v = config[key];
  return typeof v === 'boolean' ? v : fallback;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- callers name the signature they expect
export function fn<F extends Function>(config: Config, key: string): F | undefined {
  const v = config[key];
  return typeof v === 'function' ? (v as F) : undefined;
}

export function rec(config: Config, key: string): Config | undefined {
  const v = config[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Config) : undefined;
}

export function arr<T = unknown>(config: Config, key: string): T[] | undefined {
  const v = config[key];
  return Array.isArray(v) ? (v as T[]) : undefined;
}
