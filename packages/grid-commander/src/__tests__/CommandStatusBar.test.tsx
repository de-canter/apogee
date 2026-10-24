import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandStatusBar } from '../components/CommandStatusBar';
import type { CockpitRef } from '../types/cockpit-ref';

const mockCockpit = {
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
} as unknown as CockpitRef<unknown>;

const testData = [
  { id: '1', status: 'Open' },
  { id: '2', status: 'Open' },
  { id: '3', status: 'Closed' },
];

describe('CommandStatusBar', () => {
  it('renders computed status items', () => {
    const items = [
      {
        id: 'total',
        label: 'Total',
        compute: (data: unknown[]) => data.length,
      },
      {
        id: 'open',
        label: 'Open',
        compute: (data: unknown[]) => data.filter((d) => (d as { status: string }).status === 'Open').length,
      },
    ];

    render(
      <CommandStatusBar items={items} data={testData} cockpit={mockCockpit} />
    );

    expect(screen.getByText('Total:')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Open:')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('applies color to status items', () => {
    const items = [
      {
        id: 'total',
        label: 'Total',
        compute: (data: unknown[]) => data.length,
        color: () => '#ff0000',
      },
    ];

    const { container } = render(
      <CommandStatusBar items={items} data={testData} cockpit={mockCockpit} />
    );

    const item = container.querySelector('.gc-status-bar-item');
    expect(item).toHaveStyle({ color: '#ff0000' });
  });

  it('renders clickable items', () => {
    const onClick = vi.fn();
    const items = [
      {
        id: 'total',
        label: 'Total',
        compute: (data: unknown[]) => data.length,
        onClick,
      },
    ];

    const { container } = render(
      <CommandStatusBar items={items} data={testData} cockpit={mockCockpit} />
    );

    const item = container.querySelector('.gc-status-bar-item--clickable');
    expect(item).not.toBeNull();
    fireEvent.click(item!);
    expect(onClick).toHaveBeenCalledWith(mockCockpit);
  });

  it('renders keyboard shortcut hints', () => {
    render(
      <CommandStatusBar
        data={[]}
        cockpit={mockCockpit}
        shortcutHints={[
          { key: '/', description: 'Search' },
          { key: 'Esc', description: 'Close' },
        ]}
      />
    );

    expect(screen.getByText('/')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Esc')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });
});
