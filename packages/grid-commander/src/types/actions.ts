/**
 * Context menu and toolbar action definitions.
 */

import type { CockpitRef } from './cockpit-ref';

export interface CommandAction<T = any> {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  handler?: (row: T, cockpit: CockpitRef<T>) => void;
  visible?: (row: T, context: any) => boolean;
  disabled?: (row: T, context: any) => boolean;
  children?: CommandAction<T>[];
  type?: never;
}

export interface ActionDivider {
  type: 'divider';
}

export type CommandActionItem<T = any> = CommandAction<T> | ActionDivider;

export interface CommandInlineAction<T = any> {
  id: string;
  label: string;
  icon?: string;
  hideLabel?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'ghost';
  handler: (row: T) => void;
  visible?: (row: T) => boolean;
  disabled?: (row: T) => boolean;
}
