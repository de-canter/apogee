import { applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';

/** Product CSS custom property → how to compute it from the host context. */
export type ThemeMap = Record<string, (host: McpUiHostContext) => string | undefined>;

export const defaultThemeMap: ThemeMap = {
  '--ck-surface': (h) => h.styles?.variables?.['--color-background-primary'],
  '--ck-surface-secondary': (h) => h.styles?.variables?.['--color-background-secondary'],
  '--ck-text': (h) => h.styles?.variables?.['--color-text-primary'],
  '--ck-text-muted': (h) => h.styles?.variables?.['--color-text-secondary'],
  '--ck-accent': (h) => h.styles?.variables?.['--color-ring-primary'],
  '--ck-border': (h) => h.styles?.variables?.['--color-border-primary'],
};

/** Applies the host theme and variables to the document, then the product map. Safe to call on every context change. */
export function applyTheme(host: McpUiHostContext, map: ThemeMap = defaultThemeMap): void {
  if (host.theme) applyDocumentTheme(host.theme);
  if (host.styles?.variables) applyHostStyleVariables(host.styles.variables);
  const root = document.documentElement;
  for (const [prop, fn] of Object.entries(map)) {
    const value = fn(host);
    if (value !== undefined) root.style.setProperty(prop, value);
  }
}
