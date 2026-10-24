import { useState, useCallback } from 'react';

export type ActivityType = 'note' | 'system' | 'communication';

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  message: string;
  user?: string;
  timestamp: string | Date;
}

export type ActivityTabsMode = 'default' | 'notes-comms';

export interface ActivityLogProps {
  entries: ActivityEntry[];
  onAddNote?: (text: string) => void;
  /** 'default' = All / Notes / System / Comms; 'notes-comms' = "Notes + Comms" and "System (n)". */
  tabs?: ActivityTabsMode;
  /** Tab id selected on first render. Default tabs: all | note | system | communication. Notes-comms tabs: notes-comms | system. */
  defaultTab?: string;
  /** Group entries under a divider per calendar day and show time of day on each row. */
  groupByDay?: boolean;
  /** Reference time for Today / Yesterday and relative times. Defaults to the current time. */
  now?: Date;
}

export interface ActivityDayGroup {
  /** Local calendar day, YYYY-MM-DD. */
  key: string;
  /** "Today", "Yesterday", or a date such as "Oct 4". */
  label: string;
  /** Entries for the day, newest first. */
  entries: ActivityEntry[];
}

interface TabDef {
  id: string;
  label: string;
  matches: (entry: ActivityEntry) => boolean;
}

const DEFAULT_TABS: TabDef[] = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'note', label: 'Notes', matches: (e) => e.type === 'note' },
  { id: 'system', label: 'System', matches: (e) => e.type === 'system' },
  { id: 'communication', label: 'Comms', matches: (e) => e.type === 'communication' },
];

function notesCommsTabs(systemCount: number): TabDef[] {
  return [
    { id: 'notes-comms', label: 'Notes + Comms', matches: (e) => e.type !== 'system' },
    { id: 'system', label: `System (${systemCount})`, matches: (e) => e.type === 'system' },
  ];
}

const byNewest = (a: ActivityEntry, b: ActivityEntry) =>
  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * Group entries by local calendar day, newest day first and newest entry first
 * within a day. "Today" and "Yesterday" are measured against `now`.
 */
export function groupActivityByDay(entries: ActivityEntry[], now: Date = new Date()): ActivityDayGroup[] {
  const todayKey = dayKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);

  const groups: ActivityDayGroup[] = [];
  const byKey = new Map<string, ActivityDayGroup>();
  for (const entry of [...entries].sort(byNewest)) {
    const date = new Date(entry.timestamp);
    const key = dayKey(date);
    let group = byKey.get(key);
    if (!group) {
      const label = key === todayKey
        ? 'Today'
        : key === yesterdayKey
          ? 'Yesterday'
          : date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
            });
      group = { key, label, entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function ActivityLog({
  entries,
  onAddNote,
  tabs = 'default',
  defaultTab,
  groupByDay = false,
  now,
}: ActivityLogProps) {
  const tabDefs = tabs === 'notes-comms'
    ? notesCommsTabs(entries.filter((e) => e.type === 'system').length)
    : DEFAULT_TABS;
  const [selectedTab, setSelectedTab] = useState<string | undefined>(defaultTab);
  const [noteText, setNoteText] = useState('');

  // Unknown or unset ids fall back to the first tab (All, or Notes + Comms).
  const activeDef = tabDefs.find((t) => t.id === selectedTab) ?? tabDefs[0];
  const activeTab = activeDef.id;

  // Reverse-chronological
  const sorted = entries.filter(activeDef.matches).sort(byNewest);
  const groups = groupByDay ? groupActivityByDay(sorted, now) : null;
  const clock = now ?? new Date();

  const renderEntry = (entry: ActivityEntry) => (
    <div key={entry.id} className={`gc-activity-entry gc-activity-entry--${entry.type}`}>
      <div className="gc-activity-entry-header">
        <span className="gc-activity-entry-type">
          {entry.type === 'note' ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle' }}>
              <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          ) : entry.type === 'system' ? '\u2699' : '\u2709'}
        </span>
        {entry.user && (
          <span className="gc-activity-entry-user">{entry.user}</span>
        )}
        {entry.type === 'system' && !entry.user && (
          <span className="gc-activity-entry-message" style={{ margin: 0, flex: 1 }}>{entry.message}</span>
        )}
        <span className="gc-activity-entry-time">
          {groupByDay ? formatTimeOfDay(entry.timestamp) : formatActivityTime(entry.timestamp, clock)}
        </span>
      </div>
      {(entry.type !== 'system' || entry.user) && (
        <div className="gc-activity-entry-message">{entry.message}</div>
      )}
    </div>
  );

  const handleAddNote = useCallback(() => {
    if (!noteText.trim()) return;
    onAddNote?.(noteText.trim());
    setNoteText('');
  }, [noteText, onAddNote]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAddNote();
      }
    },
    [handleAddNote]
  );

  return (
    <div className="gc-activity-log">
      <div className="gc-activity-tabs">
        {tabDefs.map((tab) => (
          <button
            key={tab.id}
            className={`gc-activity-tab ${activeTab === tab.id ? 'gc-activity-tab--active' : ''}`}
            onClick={() => setSelectedTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {onAddNote && (
        <div className="gc-activity-input">
          <input
            className="gc-activity-note-input"
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a note..."
          />
          <button
            className="gc-activity-note-btn"
            onClick={handleAddNote}
            disabled={!noteText.trim()}
          >
            Add
          </button>
        </div>
      )}

      <div className="gc-activity-entries">
        {sorted.length === 0 && (
          <div className="gc-activity-empty">No activity</div>
        )}
        {groups
          ? groups.map((group) => (
              <div key={group.key} className="gc-activity-day-group">
                <div className="gc-activity-day">{group.label}</div>
                {group.entries.map(renderEntry)}
              </div>
            ))
          : sorted.map(renderEntry)}
      </div>
    </div>
  );
}

function formatTimeOfDay(timestamp: string | Date): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatActivityTime(timestamp: string | Date, now: Date): string {
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
