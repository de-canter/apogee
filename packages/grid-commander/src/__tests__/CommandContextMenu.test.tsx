import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandContextMenu } from '../components/CommandContextMenu';
import type { CockpitRef } from '../types/cockpit-ref';

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

const testRow = { id: '1', name: 'Test Order' };
const containerRef = { current: document.createElement('div') };

describe('CommandContextMenu', () => {
  it('renders menu items', () => {
    const items = [
      { id: 'edit', label: 'Edit', handler: vi.fn() },
      { id: 'delete', label: 'Delete', handler: vi.fn() },
    ];

    render(
      <CommandContextMenu
        items={items}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('calls handler and closes on item click', () => {
    const handler = vi.fn();
    const onClose = vi.fn();

    render(
      <CommandContextMenu
        items={[{ id: 'edit', label: 'Edit', handler }]}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={onClose}
        containerRef={containerRef}
      />
    );

    fireEvent.click(screen.getByText('Edit'));
    expect(handler).toHaveBeenCalledWith(testRow, mockCockpit);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders dividers', () => {
    const items = [
      { id: 'edit', label: 'Edit', handler: vi.fn() },
      { type: 'divider' as const },
      { id: 'delete', label: 'Delete', handler: vi.fn() },
    ];

    const { container } = render(
      <CommandContextMenu
        items={items}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(container.querySelector('.gc-context-menu-divider')).not.toBeNull();
  });

  it('renders shortcut hints', () => {
    render(
      <CommandContextMenu
        items={[{ id: 'edit', label: 'Edit', handler: vi.fn(), shortcut: 'Ctrl+E' }]}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(screen.getByText('Ctrl+E')).toBeInTheDocument();
  });

  it('renders icons', () => {
    render(
      <CommandContextMenu
        items={[{ id: 'edit', label: 'Edit', icon: '\u270E', handler: vi.fn() }]}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(screen.getByText('\u270E')).toBeInTheDocument();
  });

  it('hides items when visible returns false', () => {
    const items = [
      { id: 'edit', label: 'Edit', handler: vi.fn(), visible: () => false },
      { id: 'delete', label: 'Delete', handler: vi.fn() },
    ];

    render(
      <CommandContextMenu
        items={items}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('renders disabled items', () => {
    const handler = vi.fn();
    const items = [
      { id: 'edit', label: 'Edit', handler, disabled: () => true },
    ];

    const { container } = render(
      <CommandContextMenu
        items={items}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(container.querySelector('.gc-context-menu-item--disabled')).not.toBeNull();
    fireEvent.click(screen.getByText('Edit'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('shows submenu indicator for items with children', () => {
    const items = [
      {
        id: 'actions',
        label: 'Actions',
        handler: vi.fn(),
        children: [
          { id: 'sub1', label: 'Sub Action', handler: vi.fn() },
        ],
      },
    ];

    const { container } = render(
      <CommandContextMenu
        items={items}
        row={testRow}
        position={{ x: 100, y: 200 }}
        cockpit={mockCockpit}
        onClose={vi.fn()}
        containerRef={containerRef}
      />
    );

    expect(container.querySelector('.gc-context-menu-arrow')).not.toBeNull();
  });
});
