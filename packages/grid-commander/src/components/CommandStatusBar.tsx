import { useMemo } from 'react';
import type { CommandStatusItem } from '../types/status-bar';
import type { CockpitRef } from '../types/cockpit-ref';
import type { ShortcutEntry } from '../hooks/useKeyboardShortcuts';

export interface CommandStatusBarProps<T = any> {
  items?: CommandStatusItem<T>[];
  /** Filtered/visible rows (used by compute). */
  data: T[];
  /** Full unfiltered dataset (passed as second arg to compute). */
  allData?: T[];
  cockpit: CockpitRef<T>;
  shortcutHints?: ShortcutEntry[];
}

export function CommandStatusBar<T>({
  items = [],
  data,
  allData,
  cockpit,
  shortcutHints = [],
}: CommandStatusBarProps<T>) {
  const computedItems = useMemo(
    () =>
      items.map((item) => {
        const value = item.compute(data, allData ?? data);
        const color = item.color?.(value);
        return { ...item, value, color };
      }),
    [items, data, allData]
  );

  return (
    <div className="gc-status-bar" role="status">
      <div className="gc-status-bar-left">
        {computedItems.map((item) => (
          <span
            key={item.id}
            className={`gc-status-bar-item ${item.onClick ? 'gc-status-bar-item--clickable' : ''}`}
            style={item.color ? { color: item.color } : undefined}
            onClick={item.onClick ? () => item.onClick!(cockpit) : undefined}
          >
            <span className="gc-status-bar-label">{item.label}:</span>
            <span className="gc-status-bar-value">{item.value}</span>
          </span>
        ))}
      </div>
      <div className="gc-status-bar-right">
        {shortcutHints.slice(0, 6).map((hint) => (
          <span key={hint.key} className="gc-status-bar-hint">
            <kbd className="gc-status-bar-kbd">{hint.key}</kbd>
            <span className="gc-status-bar-hint-label">{hint.description}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
