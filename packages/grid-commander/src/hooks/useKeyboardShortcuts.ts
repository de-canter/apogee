import { useCallback, useEffect, useMemo } from 'react';
import type { CockpitRef } from '../types/cockpit-ref';
import type { CommandShortcut } from '../types/shortcuts';

interface ParsedCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
}

function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  return {
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: parts.filter(
      (p) => !['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd'].includes(p)
    )[0] ?? '',
  };
}

function matchesCombo(e: KeyboardEvent, combo: ParsedCombo): boolean {
  if (combo.ctrl !== e.ctrlKey) return false;
  if (combo.shift !== e.shiftKey) return false;
  if (combo.alt !== e.altKey) return false;
  if (combo.meta !== e.metaKey) return false;
  return e.key.toLowerCase() === combo.key || e.code.toLowerCase() === combo.key;
}

function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export interface ShortcutEntry {
  key: string;
  description: string;
}

export interface UseKeyboardShortcutsOptions<T = unknown> {
  containerRef: React.RefObject<HTMLElement | null>;
  gridRef: React.RefObject<HTMLElement | null>;
  cockpitRef: React.RefObject<CockpitRef<T>>;
  shortcuts?: CommandShortcut<T>[] | undefined;
  enabled?: boolean | undefined;
}

export interface UseKeyboardShortcutsReturn {
  shortcutList: ShortcutEntry[];
}

export function useKeyboardShortcuts<T = unknown>({
  containerRef,
  gridRef,
  cockpitRef,
  shortcuts = [],
  enabled = true,
}: UseKeyboardShortcutsOptions<T>): UseKeyboardShortcutsReturn {
  const parsedShortcuts = useMemo(
    () =>
      shortcuts.map((s) => ({
        ...s,
        parsed: parseCombo(s.key),
      })),
    [shortcuts]
  );

  // Built-in shortcut list for status bar display
  const shortcutList = useMemo<ShortcutEntry[]>(() => {
    const builtIn: ShortcutEntry[] = [
      { key: '↑/↓', description: 'Navigate rows' },
      { key: 'Enter', description: 'Open detail' },
      { key: 'Esc', description: 'Close detail' },
      { key: '/', description: 'Search' },
    ];
    const custom = shortcuts.map((s) => ({
      key: s.key,
      description: s.description,
    }));
    // Deduplicate by key — custom shortcuts override built-in hints
    const seen = new Set<string>();
    const merged: ShortcutEntry[] = [];
    for (const entry of [...custom, ...builtIn]) {
      if (!seen.has(entry.key)) {
        seen.add(entry.key);
        merged.push(entry);
      }
    }
    return merged;
  }, [shortcuts]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const activeEl = document.activeElement;
      const inInput = isInputElement(activeEl);

      // Always allow Escape, even in input
      if (e.key === 'Escape') {
        if (inInput) {
          // An inline editor handles its own Escape (cancel); blurring it here would commit the edit.
          if (!(activeEl as Element).closest('.gc-cell--editing')) (activeEl as HTMLElement).blur();
          return;
        }
        cockpitRef.current?.closeDetailPanel();
        e.preventDefault();
        return;
      }

      // Suppress all other shortcuts when focused on input
      if (inInput) return;

      // Check if grid is focused (for scoped shortcuts). Selecting a row
      // focuses the cockpit container itself (not a grid descendant), so the
      // container counts as "grid focused"; focus inside the toolbar's inputs
      // was already excluded above, and focus inside the detail panel is not
      // the container and not the grid, so grid-scoped shortcuts stay quiet there.
      const gridEl = gridRef.current;
      const gridFocused =
        activeEl === containerRef.current ||
        (gridEl ? gridEl === activeEl || gridEl.contains(activeEl) : false);

      // Built-in: ArrowUp/ArrowDown — row navigation
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        cockpitRef.current?.navigateRow(e.key === 'ArrowDown' ? 'next' : 'prev');
        return;
      }

      // Built-in: Enter — open detail panel
      if (e.key === 'Enter') {
        const rowId = cockpitRef.current?.selectedRowId;
        if (rowId) {
          e.preventDefault();
          cockpitRef.current?.openDetailPanel(rowId);
        }
        return;
      }

      // Built-in: / — focus global filter
      if (e.key === '/') {
        e.preventDefault();
        cockpitRef.current?.focusGlobalFilter();
        return;
      }

      // Built-in: Ctrl+A / Cmd+A — select all
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        cockpitRef.current?.selectAll();
        return;
      }

      // Consumer shortcuts (consumer wins on collision with built-in)
      for (const shortcut of parsedShortcuts) {
        if (shortcut.scope === 'grid' && !gridFocused) continue;
        if (matchesCombo(e, shortcut.parsed)) {
          e.preventDefault();
          if (cockpitRef.current) {
            shortcut.handler(cockpitRef.current);
          }
          return;
        }
      }
    },
    [enabled, cockpitRef, containerRef, gridRef, parsedShortcuts]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, handleKeyDown, enabled]);

  return { shortcutList };
}
