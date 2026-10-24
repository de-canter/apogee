import type { ThemeProviderProps } from '../types/theme';
import './variables.css';
import './light.css';
import './dark.css';
import './components.css';

export function ThemeProvider({
  theme = 'light',
  themeOverrides,
  children,
}: ThemeProviderProps) {
  const overrideStyle = themeOverrides
    ? (themeOverrides as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`gc-theme-${theme}`}
      style={{ height: '100%', ...overrideStyle }}
    >
      {children}
    </div>
  );
}
