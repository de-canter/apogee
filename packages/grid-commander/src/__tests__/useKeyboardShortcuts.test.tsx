import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { CockpitRef } from '../types/cockpit-ref';

function createMockCockpit(): CockpitRef<unknown> {
  return ({
    selectedRow: null,
    selectedRowId: '1',
    selectRow: vi.fn(),
    openDetailPanel: vi.fn(),
    closeDetailPanel: vi.fn(),
    isDetailPanelOpen: false,
    navigateRow: vi.fn(),
    focusGlobalFilter: vi.fn(),
    setGlobalFilter: vi.fn(),
    getData: () => [],
    getFilteredRows: () => [],
    cycleDensity: vi.fn(),
    openContextMenu: vi.fn(),
    getSelectedIds: () => [],
    getSelectedRows: () => [],
    clearSelection: vi.fn(),
    selectAll: vi.fn(),
    startEditing: vi.fn(),
    stopEditing: vi.fn(),
  }) as unknown as CockpitRef<unknown>;
}

describe('useKeyboardShortcuts', () => {
  it('returns built-in shortcut list', () => {
    const container = document.createElement('div');
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    const { result } = renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
      })
    );

    expect(result.current.shortcutList).toContainEqual(
      expect.objectContaining({ key: '↑/↓', description: 'Navigate rows' })
    );
    expect(result.current.shortcutList).toContainEqual(
      expect.objectContaining({ key: 'Enter', description: 'Open detail' })
    );
    expect(result.current.shortcutList).toContainEqual(
      expect.objectContaining({ key: 'Esc', description: 'Close detail' })
    );
    expect(result.current.shortcutList).toContainEqual(
      expect.objectContaining({ key: '/', description: 'Search' })
    );
  });

  it('includes consumer shortcuts in list', () => {
    const container = document.createElement('div');
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    const { result } = renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
        shortcuts: [
          { key: 'ctrl+s', description: 'Save', scope: 'global', handler: vi.fn() },
        ],
      })
    );

    expect(result.current.shortcutList).toContainEqual(
      expect.objectContaining({ key: 'ctrl+s', description: 'Save' })
    );
  });

  it('handles ArrowDown for row navigation', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
      })
    );

    // Focus container first
    container.focus();
    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );

    expect(cockpit.navigateRow).toHaveBeenCalledWith('next');
    document.body.removeChild(container);
  });

  it('handles Escape to close detail panel', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
      })
    );

    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );

    expect(cockpit.closeDetailPanel).toHaveBeenCalled();
    document.body.removeChild(container);
  });

  it('handles Enter to open detail panel', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
      })
    );

    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );

    expect(cockpit.openDetailPanel).toHaveBeenCalledWith('1');
    document.body.removeChild(container);
  });

  it('handles / to focus global filter', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
      })
    );

    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: '/', bubbles: true })
    );

    expect(cockpit.focusGlobalFilter).toHaveBeenCalled();
    document.body.removeChild(container);
  });

  it('suppresses shortcuts when input is focused (except Escape)', () => {
    const container = document.createElement('div');
    const input = document.createElement('input');
    container.appendChild(input);
    document.body.appendChild(container);

    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
      })
    );

    // Focus the input
    input.focus();

    // ArrowDown should be suppressed
    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(cockpit.navigateRow).not.toHaveBeenCalled();

    // Escape should still work (blurs input)
    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    // Escape on input blurs it rather than closing panel
    // So closeDetailPanel should NOT be called
    expect(cockpit.closeDetailPanel).not.toHaveBeenCalled();

    document.body.removeChild(container);
  });

  describe('grid-scoped consumer shortcuts (#862)', () => {
    it('fires when the cockpit container itself has focus (what selecting a row does)', () => {
      const container = document.createElement('div');
      container.tabIndex = 0;
      document.body.appendChild(container);
      // The cockpit never attaches gridRef to an element; the hook must not depend on it.
      const cockpit = createMockCockpit();
      const handler = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          containerRef: { current: container },
          gridRef: { current: null },
          cockpitRef: { current: cockpit },
          shortcuts: [{ key: 'w', description: 'Open workspace', scope: 'grid', handler }],
        })
      );

      container.focus();
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));

      expect(handler).toHaveBeenCalledWith(cockpit);
      document.body.removeChild(container);
    });

    it('fires when focus is inside the grid element', () => {
      const container = document.createElement('div');
      const grid = document.createElement('div');
      const cell = document.createElement('button');
      grid.appendChild(cell);
      container.appendChild(grid);
      document.body.appendChild(container);
      const cockpit = createMockCockpit();
      const handler = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          containerRef: { current: container },
          gridRef: { current: grid },
          cockpitRef: { current: cockpit },
          shortcuts: [{ key: 'w', description: 'Open workspace', scope: 'grid', handler }],
        })
      );

      cell.focus();
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));

      expect(handler).toHaveBeenCalled();
      document.body.removeChild(container);
    });

    it('stays quiet when focus is elsewhere in the cockpit (e.g. a detail-panel button)', () => {
      const container = document.createElement('div');
      const grid = document.createElement('div');
      const panelButton = document.createElement('button');
      container.appendChild(grid);
      container.appendChild(panelButton);
      document.body.appendChild(container);
      const cockpit = createMockCockpit();
      const handler = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          containerRef: { current: container },
          gridRef: { current: grid },
          cockpitRef: { current: cockpit },
          shortcuts: [{ key: 'w', description: 'Open workspace', scope: 'grid', handler }],
        })
      );

      panelButton.focus();
      container.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));

      expect(handler).not.toHaveBeenCalled();
      document.body.removeChild(container);
    });

    it('does not swallow Ctrl+W (a different combo)', () => {
      const container = document.createElement('div');
      container.tabIndex = 0;
      document.body.appendChild(container);
      const cockpit = createMockCockpit();
      const handler = vi.fn();

      renderHook(() =>
        useKeyboardShortcuts({
          containerRef: { current: container },
          gridRef: { current: null },
          cockpitRef: { current: cockpit },
          shortcuts: [{ key: 'w', description: 'Open workspace', scope: 'grid', handler }],
        })
      );

      container.focus();
      const ctrlW = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
      container.dispatchEvent(ctrlW);

      expect(handler).not.toHaveBeenCalled();
      expect(ctrlW.defaultPrevented).toBe(false);
      document.body.removeChild(container);
    });
  });

  it('does nothing when disabled', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const grid = document.createElement('div');
    const cockpit = createMockCockpit();

    renderHook(() =>
      useKeyboardShortcuts({
        containerRef: { current: container },
        gridRef: { current: grid },
        cockpitRef: { current: cockpit },
        enabled: false,
      })
    );

    container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );

    expect(cockpit.navigateRow).not.toHaveBeenCalled();
    document.body.removeChild(container);
  });
});
