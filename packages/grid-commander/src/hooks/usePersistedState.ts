import { useCallback, useEffect, useRef } from 'react';
import type { PersistedGridState } from '../types/persistence';

export interface UsePersistedStateOptions {
  persistenceKey?: string | undefined;
  onPersistState?: ((state: PersistedGridState) => void) | undefined;
  initialPersistedState?: Partial<PersistedGridState> | undefined;
  debounceMs?: number | undefined;
}

export function usePersistedState(options: UsePersistedStateOptions) {
  const { onPersistState, debounceMs = 500 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestStateRef = useRef<PersistedGridState | null>(null);

  const persist = useCallback(
    (state: PersistedGridState) => {
      if (!onPersistState) return;

      latestStateRef.current = state;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        if (latestStateRef.current) {
          onPersistState(latestStateRef.current);
        }
      }, debounceMs);
    },
    [onPersistState, debounceMs]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Flush pending state on unmount
        if (latestStateRef.current && onPersistState) {
          onPersistState(latestStateRef.current);
        }
      }
    };
  }, [onPersistState]);

  return { persist };
}
