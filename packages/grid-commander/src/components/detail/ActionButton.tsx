export interface ActionButtonProps {
  label: string;
  icon?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'ghost';
  size?: 'small' | 'default';
  disabled?: boolean;
  onClick: () => void;
}

export function ActionButton({
  label,
  icon,
  variant = 'default',
  size = 'default',
  disabled = false,
  onClick,
}: ActionButtonProps) {
  return (
    <button
      className={`gc-action-btn gc-action-btn--${variant} gc-action-btn--${size}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {icon && <span className="gc-action-btn-icon">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}
