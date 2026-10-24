import { createContext, useContext, useMemo } from 'react';

/**
 * What every cell may ask the cockpit for: "now", the locale and the currency. A host whose business
 * day differs from the wall clock passes `now`; nothing in the package reads a module-level clock.
 */
export interface CockpitEnvironment {
  now: () => Date;
  locale: string;
  currency: string;
}

const DEFAULT_ENVIRONMENT: CockpitEnvironment = { now: () => new Date(), locale: 'en-US', currency: 'USD' };

const CockpitEnvironmentContext = createContext<CockpitEnvironment>(DEFAULT_ENVIRONMENT);

export function useCockpitEnvironment(): CockpitEnvironment {
  return useContext(CockpitEnvironmentContext);
}

export interface CockpitEnvironmentProviderProps {
  now?: Date | (() => Date) | undefined;
  locale?: string | undefined;
  currency?: string | undefined;
  children: React.ReactNode;
}

export function CockpitEnvironmentProvider({ now, locale, currency, children }: CockpitEnvironmentProviderProps) {
  const value = useMemo<CockpitEnvironment>(
    () => ({
      now: typeof now === 'function' ? now : now ? () => now : DEFAULT_ENVIRONMENT.now,
      locale: locale ?? DEFAULT_ENVIRONMENT.locale,
      currency: currency ?? DEFAULT_ENVIRONMENT.currency,
    }),
    [now, locale, currency]
  );
  return <CockpitEnvironmentContext.Provider value={value}>{children}</CockpitEnvironmentContext.Provider>;
}
