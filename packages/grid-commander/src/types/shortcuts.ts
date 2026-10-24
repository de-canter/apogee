/**
 * Keyboard shortcut definitions.
 */

import type { CockpitRef } from './cockpit-ref';

export interface CommandShortcut<T = unknown> {
  key: string;
  description: string;
  scope: 'grid' | 'global';
  handler: (cockpit: CockpitRef<T>) => void;
}
