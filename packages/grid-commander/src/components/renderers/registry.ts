import type { CellRendererFn, CellRendererRegistry } from '../../types/column';

import { TextCell } from './TextCell';
import { LinkCell } from './LinkCell';
import { TwoLineCell } from './TwoLineCell';
import { DeadlineCell } from './DeadlineCell';
import { DateCell } from './DateCell';
import { StatusPillCell } from './StatusPillCell';
import { CountBadgeCell } from './CountBadgeCell';
import { PriorityIconCell } from './PriorityIconCell';
import { CurrencyCell } from './CurrencyCell';
import { StalenessCell } from './StalenessCell';
import { BooleanCheckCell } from './BooleanCheckCell';
import { InlineActionsCell } from './InlineActionsCell';
import { CheckboxCell } from './CheckboxCell';

export const builtInRenderers: CellRendererRegistry = {
  text: TextCell,
  link: LinkCell,
  'two-line': TwoLineCell,
  deadline: DeadlineCell,
  date: DateCell,
  'status-pill': StatusPillCell,
  'count-badge': CountBadgeCell,
  'priority-icon': PriorityIconCell,
  currency: CurrencyCell,
  staleness: StalenessCell,
  'boolean-check': BooleanCheckCell,
  'inline-actions': InlineActionsCell,
  checkbox: CheckboxCell,
};

export function createRendererRegistry(
  customRenderers?: CellRendererRegistry
): CellRendererRegistry {
  return { ...builtInRenderers, ...customRenderers };
}

export function getRenderer(
  registry: CellRendererRegistry,
  name: string | undefined
): CellRendererFn {
  if (!name) return registry.text;
  const renderer = registry[name];
  if (!renderer) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[GridCommander] Unknown cell renderer "${name}", falling back to "text".`);
    }
    return registry.text;
  }
  return renderer;
}
