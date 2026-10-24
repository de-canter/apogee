import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActivityLog, groupActivityByDay } from '../components/detail/ActivityLog';
import type { ActivityEntry } from '../components/detail/ActivityLog';

const entries = [
  {
    id: '1',
    type: 'note' as const,
    message: 'Called the buyer',
    user: 'Alice',
    timestamp: new Date(Date.now() - 3600000).toISOString(), // 1h ago
  },
  {
    id: '2',
    type: 'system' as const,
    message: 'Status changed to In Exam',
    timestamp: new Date(Date.now() - 7200000).toISOString(), // 2h ago
  },
  {
    id: '3',
    type: 'communication' as const,
    message: 'Email sent to lender',
    user: 'Bob',
    timestamp: new Date(Date.now() - 86400000).toISOString(), // 1d ago
  },
];

describe('ActivityLog', () => {
  it('renders all entries', () => {
    render(<ActivityLog entries={entries} />);
    expect(screen.getByText('Called the buyer')).toBeInTheDocument();
    expect(screen.getByText('Status changed to In Exam')).toBeInTheDocument();
    expect(screen.getByText('Email sent to lender')).toBeInTheDocument();
  });

  it('renders filter tabs', () => {
    render(<ActivityLog entries={entries} />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Comms')).toBeInTheDocument();
  });

  it('filters by tab', () => {
    render(<ActivityLog entries={entries} />);
    fireEvent.click(screen.getByText('Notes'));
    expect(screen.getByText('Called the buyer')).toBeInTheDocument();
    expect(screen.queryByText('Status changed to In Exam')).not.toBeInTheDocument();
  });

  it('shows note input when onAddNote provided', () => {
    render(<ActivityLog entries={entries} onAddNote={vi.fn()} />);
    expect(screen.getByPlaceholderText('Add a note...')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('calls onAddNote on submit', () => {
    const onAddNote = vi.fn();
    render(<ActivityLog entries={entries} onAddNote={onAddNote} />);

    const input = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(input, { target: { value: 'New note' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onAddNote).toHaveBeenCalledWith('New note');
  });

  it('calls onAddNote on Enter key', () => {
    const onAddNote = vi.fn();
    render(<ActivityLog entries={entries} onAddNote={onAddNote} />);

    const input = screen.getByPlaceholderText('Add a note...');
    fireEvent.change(input, { target: { value: 'New note' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAddNote).toHaveBeenCalledWith('New note');
  });

  it('renders empty state', () => {
    render(<ActivityLog entries={[]} />);
    expect(screen.getByText('No activity')).toBeInTheDocument();
  });

  it('renders user and time', () => {
    render(<ActivityLog entries={entries} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
  });
});

// Local-time fixtures so the calendar-day assertions hold in any timezone.
const NOW = new Date(2026, 9, 6, 14, 30); // Oct 6 2026, 2:30 PM local
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month, day, hour, minute);

const dayEntries: ActivityEntry[] = [
  { id: 'a', type: 'note', message: 'Note today', user: 'Alice', timestamp: at(9, 6, 9, 5) },
  { id: 'b', type: 'system', message: 'System today', timestamp: at(9, 6, 13, 0) },
  { id: 'c', type: 'communication', message: 'Comm yesterday', user: 'Bob', timestamp: at(9, 5, 16, 45) },
  { id: 'd', type: 'note', message: 'Note older', user: 'Cy', timestamp: at(9, 4, 8, 0) },
  { id: 'e', type: 'system', message: 'System older', timestamp: at(9, 4, 7, 0) },
];

describe('groupActivityByDay', () => {
  it('returns an empty array for no entries', () => {
    expect(groupActivityByDay([], NOW)).toEqual([]);
  });

  it('labels Today, Yesterday and older dates, newest day first', () => {
    const groups = groupActivityByDay(dayEntries, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Oct 4']);
  });

  it('orders entries newest first within a day', () => {
    const groups = groupActivityByDay(dayEntries, NOW);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['b', 'a']);
    expect(groups[2]!.entries.map((e) => e.id)).toEqual(['d', 'e']);
  });

  it('splits entries that straddle midnight into separate days', () => {
    const groups = groupActivityByDay(
      [
        { id: 'late', type: 'note', message: 'late', timestamp: at(9, 5, 23, 59) },
        { id: 'early', type: 'note', message: 'early', timestamp: at(9, 6, 0, 1) },
      ],
      NOW,
    );
    expect(groups.map((g) => [g.label, g.entries[0]!.id])).toEqual([
      ['Today', 'early'],
      ['Yesterday', 'late'],
    ]);
  });

  it('measures Today against the supplied now, not the system clock', () => {
    const groups = groupActivityByDay(dayEntries, at(9, 7, 10));
    expect(groups.map((g) => g.label)).toEqual(['Yesterday', 'Oct 5', 'Oct 4']);
  });

  it('accepts ISO string timestamps and does not mutate the input', () => {
    const input: ActivityEntry[] = [
      { id: '1', type: 'note', message: 'x', timestamp: at(9, 6, 8).toISOString() },
      { id: '2', type: 'note', message: 'y', timestamp: at(9, 6, 9).toISOString() },
    ];
    const groups = groupActivityByDay(input, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['2', '1']);
    expect(input.map((e) => e.id)).toEqual(['1', '2']);
  });
});

describe('ActivityLog notes-comms tabs', () => {
  it('shows only Notes + Comms and System (count) tabs', () => {
    render(<ActivityLog entries={dayEntries} tabs="notes-comms" now={NOW} />);
    expect(screen.getByText('Notes + Comms')).toBeInTheDocument();
    expect(screen.getByText('System (2)')).toBeInTheDocument();
    expect(screen.queryByText('All')).not.toBeInTheDocument();
    expect(screen.queryByText('Comms')).not.toBeInTheDocument();
  });

  it('defaults to Notes + Comms, hiding system entries', () => {
    render(<ActivityLog entries={dayEntries} tabs="notes-comms" now={NOW} />);
    expect(screen.getByText('Note today')).toBeInTheDocument();
    expect(screen.getByText('Comm yesterday')).toBeInTheDocument();
    expect(screen.queryByText('System today')).not.toBeInTheDocument();
  });

  it('switches to the System tab', () => {
    render(<ActivityLog entries={dayEntries} tabs="notes-comms" now={NOW} />);
    fireEvent.click(screen.getByText('System (2)'));
    expect(screen.getByText('System today')).toBeInTheDocument();
    expect(screen.queryByText('Note today')).not.toBeInTheDocument();
  });

  it('shows System (0) when there are no system entries', () => {
    render(<ActivityLog entries={dayEntries.filter((e) => e.type !== 'system')} tabs="notes-comms" />);
    expect(screen.getByText('System (0)')).toBeInTheDocument();
  });

  it('honours defaultTab', () => {
    render(<ActivityLog entries={dayEntries} tabs="notes-comms" defaultTab="system" now={NOW} />);
    expect(screen.getByText('System today')).toBeInTheDocument();
    expect(screen.queryByText('Note today')).not.toBeInTheDocument();
  });

  it('keeps the note composer above the tabbed entries', () => {
    const { container } = render(
      <ActivityLog entries={dayEntries} tabs="notes-comms" onAddNote={() => {}} now={NOW} />,
    );
    expect(screen.getByPlaceholderText('Add a note...')).toBeInTheDocument();
    expect(container.querySelector('.gc-activity-input')).toBeTruthy();
  });
});

describe('ActivityLog defaultTab (default tabs)', () => {
  it('opens on the named tab', () => {
    render(<ActivityLog entries={entries} defaultTab="system" />);
    expect(screen.getByText('Status changed to In Exam')).toBeInTheDocument();
    expect(screen.queryByText('Called the buyer')).not.toBeInTheDocument();
  });

  it('falls back to All for an unknown tab id', () => {
    render(<ActivityLog entries={entries} defaultTab="nope" />);
    expect(screen.getByText('Called the buyer')).toBeInTheDocument();
    expect(screen.getByText('Email sent to lender')).toBeInTheDocument();
  });
});

describe('ActivityLog groupByDay', () => {
  it('renders a divider per day, newest first', () => {
    const { container } = render(<ActivityLog entries={dayEntries} groupByDay now={NOW} />);
    const dividers = [...container.querySelectorAll('.gc-activity-day')].map((d) => d.textContent);
    expect(dividers).toEqual(['Today', 'Yesterday', 'Oct 4']);
  });

  it('shows time of day instead of relative time', () => {
    const { container } = render(<ActivityLog entries={dayEntries} groupByDay now={NOW} />);
    const times = [...container.querySelectorAll('.gc-activity-entry-time')].map((t) => t.textContent);
    expect(times).toEqual(['1:00 PM', '9:05 AM', '4:45 PM', '8:00 AM', '7:00 AM']);
    expect(container.textContent).not.toMatch(/ago/);
  });

  it('applies tab filtering within groups and drops empty days', () => {
    const { container } = render(
      <ActivityLog entries={dayEntries} groupByDay tabs="notes-comms" now={NOW} />,
    );
    fireEvent.click(screen.getByText('System (2)'));
    const dividers = [...container.querySelectorAll('.gc-activity-day')].map((d) => d.textContent);
    expect(dividers).toEqual(['Today', 'Oct 4']);
  });

  it('still shows the empty state with no entries', () => {
    render(<ActivityLog entries={[]} groupByDay now={NOW} />);
    expect(screen.getByText('No activity')).toBeInTheDocument();
  });
});

describe('ActivityLog now prop', () => {
  it('computes relative times against now', () => {
    render(
      <ActivityLog
        entries={[{ id: 'r', type: 'note', message: 'rel', timestamp: at(9, 6, 12, 30) }]}
        now={NOW}
      />,
    );
    expect(screen.getByText('2h ago')).toBeInTheDocument();
  });

  it('renders no day dividers by default', () => {
    const { container } = render(<ActivityLog entries={dayEntries} now={NOW} />);
    expect(container.querySelector('.gc-activity-day')).toBeNull();
  });
});
