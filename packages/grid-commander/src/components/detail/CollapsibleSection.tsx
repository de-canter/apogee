import { useState, useCallback, useRef, useEffect } from 'react';

export interface CollapsibleSectionProps {
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  summaryContent?: React.ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
}

export function CollapsibleSection({
  title,
  badge,
  actions,
  summaryContent,
  defaultOpen = true,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [children, open]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  }, [open, onToggle]);

  return (
    <div className={`gc-section ${open ? 'gc-section--open' : ''}`}>
      <div className="gc-section-header" onClick={toggle}>
        <span className={`gc-section-chevron ${open ? 'gc-section-chevron--open' : ''}`}>
          {'\u25B6'}
        </span>
        <span className="gc-section-title">{title}</span>
        {badge && <span className="gc-section-badge">{badge}</span>}
        {!open && summaryContent && (
          <span className="gc-section-summary">{summaryContent}</span>
        )}
        <span className="gc-section-spacer" />
        {actions && (
          <span className="gc-section-actions" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      <div
        className="gc-section-content"
        style={{
          maxHeight: open ? (contentHeight ?? 'none') : 0,
          overflow: 'hidden',
          transition: 'max-height 150ms ease',
        }}
      >
        <div ref={contentRef} className="gc-section-content-inner">
          {children}
        </div>
      </div>
    </div>
  );
}
