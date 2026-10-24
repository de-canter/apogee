import type { CellRendererProps } from '../../types/column';
import type { CommandInlineAction } from '../../types/actions';

/**
 * Renders small action buttons inline within a row cell.
 * Actions are passed via cellConfig.actions: CommandInlineAction[].
 */
export function InlineActionsCell<T = any>({
  row,
  config,
}: CellRendererProps<T>) {
  const actions: CommandInlineAction<T>[] = config.actions ?? [];

  const visibleActions = actions.filter((a) => !a.visible || a.visible(row));

  if (visibleActions.length === 0) return null;

  return (
    <span className="gc-inline-actions">
      {visibleActions.map((action) => {
        const isDisabled = action.disabled?.(row);
        const variantClass = action.variant
          ? `gc-inline-action--${action.variant}`
          : '';

        return (
          <button
            key={action.id}
            className={`gc-inline-action ${variantClass}`}
            disabled={isDisabled}
            title={action.label}
            onClick={(e) => {
              e.stopPropagation();
              if (!isDisabled) action.handler(row);
            }}
          >
            {action.icon && <span className="gc-inline-action-icon">{action.icon}</span>}
            {!action.hideLabel && <span className="gc-inline-action-label">{action.label}</span>}
          </button>
        );
      })}
    </span>
  );
}
