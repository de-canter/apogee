export type ThemeConfig = 'light' | 'dark';

export type ThemeOverrides = Record<string, string>;

export interface ThemeProviderProps {
  theme?: ThemeConfig;
  themeOverrides?: ThemeOverrides;
  children: React.ReactNode;
}
