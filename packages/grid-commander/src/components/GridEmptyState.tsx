import type { GridEmptyStateProps } from '../types/grid-states';

export function GridEmptyState({
  icon,
  title = 'No data',
  description = 'No rows match the current filters.',
  action,
}: GridEmptyStateProps) {
  return (
    <div className="gc-empty-state">
      <div className="gc-empty-state-icon">{icon ?? '\u{1F4CB}'}</div>
      <div className="gc-empty-state-title">{title}</div>
      <div className="gc-empty-state-description">{description}</div>
      {action && <div className="gc-empty-state-action">{action}</div>}
    </div>
  );
}
