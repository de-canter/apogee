import { useState, useEffect, useCallback, useRef } from 'react';
import type { CommandAction, CommandActionItem, ActionContext } from '../types/actions';
import type { CockpitRef } from '../types/cockpit-ref';

export interface ContextMenuState {
  x: number;
  y: number;
  rowId: string;
}

export interface CommandContextMenuProps<T = unknown> {
  items: CommandActionItem<T>[];
  row: T;
  position: { x: number; y: number };
  cockpit: CockpitRef<T>;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

interface SubmenuState {
  itemId: string;
  x: number;
  y: number;
}

export function CommandContextMenu<T>({
  items,
  row,
  position,
  cockpit,
  onClose,
  containerRef,
}: CommandContextMenuProps<T>) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [submenu, setSubmenu] = useState<SubmenuState | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // What guards may inspect besides the row.
  const actionContext: ActionContext<T> = {
    selectedIds: cockpit.getSelectedIds(),
    selectedRows: cockpit.getSelectedRows(),
    filteredRows: cockpit.getFilteredRows(),
  };

  // Filter visible items
  const visibleItems = items.filter((item) => {
    if (item.type === 'divider') return true;
    return !item.visible || item.visible(row, actionContext);
  });

  // Clamp position to viewport
  const clampedPosition = useClampedPosition(position, menuRef);

  // Close on outside click, scroll, or Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (submenu) {
          setSubmenu(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [onClose, submenu]);

  // Focus management
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const getActionItems = useCallback(
    () => visibleItems.filter((item): item is CommandAction<T> => item.type !== 'divider'),
    [visibleItems]
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const actionItems = getActionItems();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIndex((prev) => Math.min(prev + 1, actionItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = actionItems[focusIndex];
        if (item && !item.children?.length) {
          const isDisabled = item.disabled?.(row, actionContext);
          if (!isDisabled) {
            item.handler?.(row, cockpit);
            onClose();
          }
        } else if (item?.children?.length) {
          // Open submenu
          const el = menuRef.current?.querySelector(`[data-item-id="${item.id}"]`);
          if (el) {
            const rect = el.getBoundingClientRect();
            setSubmenu({ itemId: item.id, x: rect.right, y: rect.top });
          }
        }
      } else if (e.key === 'ArrowRight') {
        const item = actionItems[focusIndex];
        if (item?.children?.length) {
          const el = menuRef.current?.querySelector(`[data-item-id="${item.id}"]`);
          if (el) {
            const rect = el.getBoundingClientRect();
            setSubmenu({ itemId: item.id, x: rect.right, y: rect.top });
          }
        }
      } else if (e.key === 'ArrowLeft') {
        if (submenu) {
          setSubmenu(null);
        }
      }
    },
    [focusIndex, getActionItems, row, cockpit, onClose, submenu]
  );

  const handleItemHover = useCallback(
    (item: CommandAction<T>, el: HTMLElement) => {
      clearTimeout(hoverTimerRef.current);
      if (item.children?.length) {
        hoverTimerRef.current = setTimeout(() => {
          const rect = el.getBoundingClientRect();
          setSubmenu({ itemId: item.id, x: rect.right, y: rect.top });
        }, 200);
      } else {
        hoverTimerRef.current = setTimeout(() => {
          setSubmenu(null);
        }, 200);
      }
    },
    []
  );

  const handleItemClick = useCallback(
    (item: CommandAction<T>) => {
      if (item.children?.length) return;
      const isDisabled = item.disabled?.(row, actionContext);
      if (isDisabled) return;
      item.handler?.(row, cockpit);
      onClose();
    },
    [row, cockpit, onClose]
  );

  // Render into container via portal-like positioning
  let actionIndex = -1;

  return (
    <div
      ref={menuRef}
      className="gc-context-menu"
      style={{
        position: 'fixed',
        left: clampedPosition.x,
        top: clampedPosition.y,
      }}
      onKeyDown={handleMenuKeyDown}
      tabIndex={-1}
      role="menu"
    >
      {visibleItems.map((item, i) => {
        if (item.type === 'divider') {
          return <div key={`divider-${i}`} className="gc-context-menu-divider" role="separator" />;
        }

        actionIndex++;
        const currentActionIndex = actionIndex;
        const isDisabled = item.disabled?.(row, actionContext);
        const isFocused = currentActionIndex === focusIndex;
        const hasSubmenu = !!(item.children?.length);

        return (
          <div
            key={item.id}
            data-item-id={item.id}
            className={[
              'gc-context-menu-item',
              isFocused && 'gc-context-menu-item--focused',
              isDisabled && 'gc-context-menu-item--disabled',
            ]
              .filter(Boolean)
              .join(' ')}
            role="menuitem"
            aria-disabled={isDisabled}
            onClick={() => handleItemClick(item)}
            onMouseEnter={(e) => {
              setFocusIndex(currentActionIndex);
              handleItemHover(item, e.currentTarget);
            }}
          >
            {item.icon && <span className="gc-context-menu-icon">{item.icon}</span>}
            <span className="gc-context-menu-label">{item.label}</span>
            {item.shortcut && (
              <span className="gc-context-menu-shortcut">{item.shortcut}</span>
            )}
            {hasSubmenu && <span className="gc-context-menu-arrow">{'\u25B6'}</span>}

            {/* Submenu */}
            {hasSubmenu && submenu?.itemId === item.id && (
              <CommandContextMenu
                items={item.children!}
                row={row}
                position={{ x: submenu.x, y: submenu.y }}
                cockpit={cockpit}
                onClose={onClose}
                containerRef={containerRef}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function useClampedPosition(
  position: { x: number; y: number },
  menuRef: React.RefObject<HTMLDivElement | null>
) {
  const [clamped, setClamped] = useState(position);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) {
      setClamped(position);
      return;
    }

    requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let x = position.x;
      let y = position.y;

      if (x + rect.width > vw) x = vw - rect.width - 4;
      if (y + rect.height > vh) y = vh - rect.height - 4;
      if (x < 0) x = 4;
      if (y < 0) y = 4;

      setClamped({ x, y });
    });
  }, [position, menuRef]);

  return clamped;
}
