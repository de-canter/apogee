export interface ActionButtonProps {
  label: string;
  icon?: string | undefined;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'ghost' | undefined;
  size?: 'small' | 'default' | undefined;
  disabled?: boolean | undefined;
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
