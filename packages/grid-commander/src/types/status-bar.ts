/**
 * Status bar item definitions.
 */

import type { CockpitRef } from './cockpit-ref';

export interface CommandStatusItem<T = unknown> {
  id: string;
  label: string;
  /** Compute the display value. `data` is filtered rows; `allData` is the full unfiltered dataset. */
  compute: (data: T[], allData?: T[]) => string | number;
  color?: ((value: string | number) => string) | undefined;
  onClick?: ((cockpit: CockpitRef<T>) => void) | undefined;
}
