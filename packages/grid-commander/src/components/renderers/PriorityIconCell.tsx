import type { CellRendererProps } from '../../types/column';

const DEFAULT_ICONS: Record<string, string> = {
  urgent: '\uD83D\uDD34',  // red circle
  high: '\uD83D\uDFE0',    // orange circle
  medium: '\uD83D\uDFE1',  // yellow circle
  normal: '',
  low: '',
};

export function PriorityIconCell({ value, config }: CellRendererProps) {
  const icons = config.icons || DEFAULT_ICONS;
  return <span style={{ fontSize: 10 }}>{icons[value] || ''}</span>;
}
