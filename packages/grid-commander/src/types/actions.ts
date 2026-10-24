/**
 * Context menu and toolbar action definitions.
 */

import type { CockpitRef } from './cockpit-ref';

/** What an action guard may inspect besides its row. */
export interface ActionContext<T = unknown> {
  selectedIds: string[];
  selectedRows: T[];
  filteredRows: T[];
}

export interface CommandAction<T = unknown> {
  id: string;
  label: string;
  icon?: string | undefined;
  shortcut?: string | undefined;
  handler?: ((row: T, cockpit: CockpitRef<T>) => void) | undefined;
  visible?: ((row: T, context: ActionContext<T>) => boolean) | undefined;
  disabled?: ((row: T, context: ActionContext<T>) => boolean) | undefined;
  children?: CommandAction<T>[] | undefined;
  type?: undefined;
}

export interface ActionDivider {
  type: 'divider';
}

export type CommandActionItem<T = unknown> = CommandAction<T> | ActionDivider;

export interface CommandInlineAction<T = unknown> {
  id: string;
  label: string;
  icon?: string | undefined;
  hideLabel?: boolean | undefined;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'ghost' | undefined;
  handler: (row: T) => void;
  visible?: ((row: T) => boolean) | undefined;
  disabled?: ((row: T) => boolean) | undefined;
}
