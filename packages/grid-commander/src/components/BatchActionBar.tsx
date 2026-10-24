import type { BatchAction } from '../types/selection';

interface BatchActionBarProps<T = unknown> {
  selectedCount: number;
  selectedIds: string[];
  selectedRows: T[];
  actions: BatchAction<T>[];
  onClearSelection: () => void;
}

export function BatchActionBar<T>({
  selectedCount,
  selectedIds,
  selectedRows,
  actions,
  onClearSelection,
}: BatchActionBarProps<T>) {
  if (selectedCount === 0) return null;

  return (
    <div className="gc-batch-bar">
      <span className="gc-batch-bar-count">
        {selectedCount} selected
      </span>

      <div className="gc-batch-bar-actions">
        {actions.map((action) => {
          const min = action.minSelection ?? 1;
          const max = action.maxSelection ?? Infinity;
          const inRange = selectedCount >= min && selectedCount <= max;
          const dynamicDisabled = action.disabled?.(selectedIds, selectedRows) ?? false;
          const isDisabled = !inRange || dynamicDisabled;

          return (
            <button
              key={action.id}
              className={`gc-batch-bar-btn gc-batch-bar-btn--${action.variant ?? 'default'}`}
              disabled={isDisabled}
              onClick={() => action.handler(selectedIds, selectedRows)}
            >
              {action.icon && <span className="gc-batch-bar-btn-icon">{action.icon}</span>}
              {action.label}
            </button>
          );
        })}
      </div>

      <button className="gc-batch-bar-clear" onClick={onClearSelection}>
        Clear selection
      </button>
    </div>
  );
}
