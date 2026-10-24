export type ThemeConfig = 'light' | 'dark';

export type ThemeOverrides = Record<string, string>;

export type ThemeMode = 'declare' | 'inherit';

export interface ThemeProviderProps {
  theme?: ThemeConfig | undefined;
  themeOverrides?: ThemeOverrides | undefined;
  /** `declare` (default) sets the tokens here when this is the outermost provider; `inherit` never sets them. */
  mode?: ThemeMode | undefined;
  children: React.ReactNode;
}
