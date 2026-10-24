export type ThemeConfig = 'light' | 'dark';

export type ThemeOverrides = Record<string, string>;

export interface ThemeProviderProps {
  theme?: ThemeConfig | undefined;
  themeOverrides?: ThemeOverrides | undefined;
  children: React.ReactNode;
}
