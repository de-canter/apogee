import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandDetailPanel } from '../components/CommandDetailPanel';
import type { CockpitRef } from '../types/cockpit-ref';
import type { DetailPanelProps } from '../types/detail-panel';

const mockCockpit: CockpitRef = {
  selectedRow: null,
  selectedRowId: null,
  selectRow: vi.fn(),
  openDetailPanel: vi.fn(),
  closeDetailPanel: vi.fn(),
  isDetailPanelOpen: false,
  navigateRow: vi.fn(),
  focusGlobalFilter: vi.fn(),
  setGlobalFilter: vi.fn(),
  getData: () => [],
  getFilteredRows: () => [],
  cycleDensity: vi.fn(),
  openContextMenu: vi.fn(),
  getSelectedIds: () => [],
  getSelectedRows: () => [],
  clearSelection: vi.fn(),
  selectAll: vi.fn(),
  startEditing: vi.fn(),
  stopEditing: vi.fn(),
};

function TestContent({ row, onClose }: DetailPanelProps) {
  return (
    <div>
      <span>Detail: {(row as any).name}</span>
      <button onClick={onClose}>Close from content</button>
    </div>
  );
}

describe('CommandDetailPanel', () => {
  it('renders content when open with row', () => {
    render(
      <CommandDetailPanel
        open={true}
        row={{ id: '1', name: 'Order A' }}
        rowId="1"
        cockpit={mockCockpit}
        width={400}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        renderContent={TestContent}
      />
    );

    expect(screen.getByText('Detail: Order A')).toBeInTheDocument();
  });

  it('shows row identifier in header', () => {
    render(
      <CommandDetailPanel
        open={true}
        row={{ id: '1', name: 'Order A' }}
        rowId="1"
        rowIdentifier={(row: any) => `#${row.id} — ${row.name}`}
        cockpit={mockCockpit}
        width={400}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        renderContent={TestContent}
      />
    );

    expect(screen.getByText('#1 — Order A')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <CommandDetailPanel
        open={true}
        row={{ id: '1', name: 'Order A' }}
        rowId="1"
        cockpit={mockCockpit}
        width={400}
        onWidthChange={vi.fn()}
        onClose={onClose}
        onNavigate={vi.fn()}
        renderContent={TestContent}
      />
    );

    fireEvent.click(screen.getByTitle('Close detail panel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onNavigate with prev/next', () => {
    const onNavigate = vi.fn();
    render(
      <CommandDetailPanel
        open={true}
        row={{ id: '1', name: 'Order A' }}
        rowId="1"
        cockpit={mockCockpit}
        width={400}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onNavigate={onNavigate}
        renderContent={TestContent}
      />
    );

    fireEvent.click(screen.getByTitle('Previous row'));
    expect(onNavigate).toHaveBeenCalledWith('prev');

    fireEvent.click(screen.getByTitle('Next row'));
    expect(onNavigate).toHaveBeenCalledWith('next');
  });

  it('is hidden when not open', () => {
    const { container } = render(
      <CommandDetailPanel
        open={false}
        row={null}
        rowId={null}
        cockpit={mockCockpit}
        width={400}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(container.querySelector('.gc-detail-panel--open')).toBeNull();
  });

  it('renders draggable divider', () => {
    const { container } = render(
      <CommandDetailPanel
        open={true}
        row={{ id: '1', name: 'Order A' }}
        rowId="1"
        cockpit={mockCockpit}
        width={400}
        onWidthChange={vi.fn()}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
        renderContent={TestContent}
      />
    );

    expect(container.querySelector('.gc-detail-divider')).not.toBeNull();
  });
});
