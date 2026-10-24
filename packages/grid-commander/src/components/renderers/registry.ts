import { isDev } from '../../utils/env';
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
import { CountdownCell } from './CountdownCell';

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
  countdown: CountdownCell,
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
  const text = registry.text ?? builtInRenderers.text!;
  if (!name) return text;
  const renderer = registry[name];
  if (!renderer) {
    if (isDev()) {
      console.warn(`[GridCommander] Unknown cell renderer "${name}", falling back to "text".`);
    }
    return text;
  }
  return renderer;
}
