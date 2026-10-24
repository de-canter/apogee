import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { usePersistedState } from '../hooks/usePersistedState';
import type { PersistedGridState } from '../types/persistence';

describe('usePersistedState', () => {
  it('debounces persistence calls', () => {
    vi.useFakeTimers();
    const onPersistState = vi.fn();

    const { result } = renderHook(() =>
      usePersistedState({
        persistenceKey: 'test',
        onPersistState,
        debounceMs: 500,
      })
    );

    const state: PersistedGridState = {
      columnOrder: ['a', 'b'],
      columnWidths: {},
      columnVisibility: {},
      sorting: [],
      grouping: [],
      rowDensity: 'compact',
    };

    // Call persist multiple times rapidly
    act(() => {
      result.current.persist(state);
      result.current.persist({ ...state, columnOrder: ['b', 'a'] });
      result.current.persist({ ...state, columnOrder: ['c', 'a'] });
    });

    // Should not have been called yet
    expect(onPersistState).not.toHaveBeenCalled();

    // Advance past debounce
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // Should have been called once with the last value
    expect(onPersistState).toHaveBeenCalledTimes(1);
    expect(onPersistState).toHaveBeenCalledWith(
      expect.objectContaining({ columnOrder: ['c', 'a'] })
    );

    vi.useRealTimers();
  });

  it('does not call onPersistState when not provided', () => {
    const { result } = renderHook(() =>
      usePersistedState({ persistenceKey: 'test' })
    );

    // Should not throw
    act(() => {
      result.current.persist({
        columnOrder: [],
        columnWidths: {},
        columnVisibility: {},
        sorting: [],
        grouping: [],
        rowDensity: 'compact',
      });
    });
  });
});
