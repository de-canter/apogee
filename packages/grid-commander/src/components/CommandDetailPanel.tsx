import { useState, useCallback, useRef, useEffect } from 'react';
import type { DetailPanelPosition, DetailPanelProps } from '../types/detail-panel';
import type { CockpitRef } from '../types/cockpit-ref';

export interface CommandDetailPanelProps<T = any> {
  open: boolean;
  row: T | null;
  rowId: string | null;
  rowIdentifier?: (row: T) => string;
  cockpit: CockpitRef<T>;
  position?: DetailPanelPosition;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  renderContent?: React.ComponentType<DetailPanelProps<T>>;
  pinned?: boolean;
  onTogglePin?: () => void;
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 800;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 600;

export function CommandDetailPanel<T>({
  open,
  row,
  rowId,
  rowIdentifier,
  cockpit,
  position = 'right',
  width,
  onWidthChange,
  onClose,
  onNavigate,
  renderContent: ContentComponent,
  pinned,
  onTogglePin,
}: CommandDetailPanelProps<T>) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ pos: number; size: number }>({ pos: 0, size: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = {
        pos: position === 'right' ? e.clientX : e.clientY,
        size: width,
      };
    },
    [position, width]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { pos, size } = dragStartRef.current;
      let delta: number;
      let min: number;
      let max: number;

      if (position === 'right') {
        delta = pos - e.clientX;
        min = MIN_WIDTH;
        max = MAX_WIDTH;
      } else {
        delta = pos - e.clientY;
        min = MIN_HEIGHT;
        max = MAX_HEIGHT;
      }

      const newSize = Math.max(min, Math.min(max, size + delta));
      onWidthChange(newSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position, onWidthChange]);

  const identifier = row && rowIdentifier ? rowIdentifier(row) : rowId ?? '';

  const isRight = position === 'right';

  return (
    <div
      className={`gc-detail-panel gc-detail-panel--${position} ${open ? 'gc-detail-panel--open' : ''}`}
      style={
        isRight
          ? { width: open ? width : 0 }
          : { height: open ? width : 0 }
      }
    >
      {/* Draggable divider */}
      <div
        className={`gc-detail-divider gc-detail-divider--${position} ${isDragging ? 'gc-detail-divider--active' : ''}`}
        onMouseDown={handleMouseDown}
      />

      <div className="gc-detail-inner">
        {/* Header */}
        <div className="gc-detail-header">
          <div className="gc-detail-header-nav">
            <button
              className="gc-detail-nav-btn"
              onClick={() => onNavigate('prev')}
              title="Previous row"
            >
              {isRight ? '\u25B2' : '\u25C0'}
            </button>
            <button
              className="gc-detail-nav-btn"
              onClick={() => onNavigate('next')}
              title="Next row"
            >
              {isRight ? '\u25BC' : '\u25B6'}
            </button>
          </div>
          <span className="gc-detail-header-id">{identifier}</span>
          <span className="gc-detail-header-spacer" />
          {onTogglePin && (
            <button
              className="gc-detail-close-btn"
              onClick={onTogglePin}
              title={pinned ? 'Unpin panel' : 'Pin panel open'}
              style={{ color: pinned ? 'var(--gc-accent, #3b82f6)' : undefined, width: 26, height: 26, fontSize: 16 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v8M8 6h8M7 10l1 6h8l1-6M12 16v6" />
              </svg>
            </button>
          )}
          {!pinned && (
            <button
              className="gc-detail-close-btn"
              onClick={onClose}
              title="Close detail panel"
              style={{ width: 26, height: 26, fontSize: 16 }}
            >
              {'\u2715'}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="gc-detail-content">
          {row && rowId && ContentComponent && (
            <ContentComponent
              row={row}
              rowId={rowId}
              cockpit={cockpit}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
