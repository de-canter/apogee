import type { CockpitRef } from './cockpit-ref';

/**
 * Props received by consumer-provided detail panel content component.
 */
export interface DetailPanelProps<T = any> {
  row: T;
  rowId: string;
  cockpit: CockpitRef<T>;
  onClose: () => void;
}

/**
 * Position of the detail panel relative to the grid.
 */
export type DetailPanelPosition = 'right' | 'bottom';
