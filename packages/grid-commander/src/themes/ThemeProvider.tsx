import { createContext, useContext } from 'react';
import type { ThemeProviderProps } from '../types/theme';
import './variables.css';
import './light.css';
import './dark.css';
import './components.css';

/** How many providers are above this point; 0 outside any provider. */
const ThemeDepthContext = createContext(0);

export function useThemeDepth(): number {
  return useContext(ThemeDepthContext);
}

/**
 * Declares the `--gc-*` tokens once, at the outermost provider. Custom properties resolve per element,
 * so a nested provider that re-declared them would shadow the host's values; a nested provider is
 * therefore inert (plain wrapper), and `mode="inherit"` makes even the outermost one inert for hosts
 * that own the tokens on `:root`. `CommandCockpit` wraps itself in a provider, which is what makes a
 * single host-level `ThemeProvider` with overrides govern every cockpit beneath it.
 */
export function ThemeProvider({ theme = 'light', themeOverrides, mode = 'declare', children }: ThemeProviderProps) {
  const depth = useThemeDepth();
  const declares = depth === 0 && mode === 'declare';
  const overrideStyle = declares && themeOverrides ? (themeOverrides as React.CSSProperties) : undefined;
  return (
    <ThemeDepthContext.Provider value={depth + 1}>
      <div className={declares ? `gc-theme-${theme}` : undefined} style={{ height: '100%', ...overrideStyle }}>
        {children}
      </div>
    </ThemeDepthContext.Provider>
  );
}
