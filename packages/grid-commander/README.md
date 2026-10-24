# @de_canter/apogee-grid-commander

A cockpit-grade data grid for Apogee products: dense, keyboard-first worklists that people command from all day. Built on TanStack Table and Virtual; React 18 or 19; no UI kit, no Tailwind, no icon library. Everything is styled through `--gc-*` tokens.

```bash
pnpm add @de_canter/apogee-grid-commander
```

```tsx
import { CommandCockpit, ThemeProvider } from '@de_canter/apogee-grid-commander';
import '@de_canter/apogee-grid-commander/styles.css';

interface Job { id: string; title: string; dueInDays: number | null; bucket: 'OVERDUE' | 'TODAY' | 'LATER' | 'NONE'; amount: number }

const columns = [
  { id: 'title', accessorKey: 'title', header: 'Title', filterType: 'text', sticky: 'left' },
  { id: 'due', accessorKey: 'dueInDays', header: 'Due', cellRenderer: 'countdown',
    cellConfig: { daysField: 'dueInDays', variantField: 'bucket', variants: { OVERDUE: 'critical', TODAY: 'critical', LATER: 'ok', NONE: 'none' } } },
  { id: 'amount', accessorKey: 'amount', header: 'Amount', cellRenderer: 'currency', filterType: 'number-range' },
] satisfies CommandColumnDef<Job>[];

export function Board({ jobs, today }: { jobs: Job[]; today: Date }) {
  return (
    <ThemeProvider themeOverrides={{ '--gc-accent': '#1a2744' }}>
      <CommandCockpit<Job>
        data={jobs}
        columns={columns}
        getRowId={(j) => j.id}
        now={today}
        title="Work queue"
        presets={[{ id: 'open', label: 'Open', filters: [{ id: 'due', value: { min: 0 } }] }]}
        enableGlobalFilter
        detailPanelPosition="bottom"
        persistenceKey="work-queue"
      />
    </ThemeProvider>
  );
}
```

## Components

| Export | What it is |
|---|---|
| `CommandCockpit` | Toolbar + grid + context menu + detail panel + status bar + keyboard model, one component. Imperative `CockpitRef` through `ref`. |
| `CommandGrid`, `CommandToolbar`, `CommandContextMenu`, `CommandDetailPanel`, `CommandStatusBar`, `BatchActionBar`, `ExportMenu`, `GridSkeleton`, `GridEmptyState` | The parts, for hosts that compose their own cockpit. |
| `ActivityLog` (+ `groupActivityByDay`), `ContactGrid`, `CollapsibleSection`, `SummaryChip`, `StatusBadge`, `ActionButton` | Detail-panel kit. |
| `ThemeProvider` (+ `useThemeDepth`) | Declares the tokens once at the outermost provider; nested providers are inert; `mode="inherit"` for hosts that own `--gc-*` on `:root`. |
| `CockpitEnvironmentProvider`, `useCockpitEnvironment` | `now`, `locale`, `currency` for every cell; `CommandCockpit` provides them from its props. |

### `CommandCockpit` props worth knowing

`data`, `columns: CommandColumnDef<T>[]`, `getRowId` · `defaultSort`, `defaultFilters`, `presets`, `initialPresetId`, `onPresetChange` · `rowDensity` (`compact` 28 px, `comfortable` 36 px, `expanded` 48 px) · `enableVirtualization`, `enableGrouping` · `selectedRowId`, `onRowSelect`, `onRowDoubleClick` · `contextMenuActions: CommandActionItem<T>[]` · `detailPanel`, `detailPanelPosition`, `rowIdentifier` · `statusItems: CommandStatusItem<T>[]` (`compute(filteredRows, allRows)`) · `keyboardShortcuts: CommandShortcut<T>[]` · `rowColorRules`, `rowClassName` · `pinnedColumns` · `selectionMode`, `batchActions` · `enableExport`, `exportColumns` · `onCellEdit`, `customEditors`, `customRenderers` · `persistenceKey`, `initialPersistedState`, `onPersistState` (debounced 500 ms) · `theme`, `themeOverrides` · **`now`, `locale`, `currency`**.

### `CockpitRef<T>`

`selectRow`, `navigateRow('prev' | 'next')`, `openDetailPanel`, `closeDetailPanel`, `focusGlobalFilter`, `setGlobalFilter`, `getData`, `getFilteredRows`, `cycleDensity`, `applyPreset`, `openContextMenu`, `getSelectedIds`, `getSelectedRows`, `clearSelection`, `selectAll`, `startEditing`, `stopEditing(save = true)`, `toggleRowExpanded`, `isRowExpanded`; plus `selectedRow`, `selectedRowId`, `isDetailPanelOpen`, `activePresetId`.

## Columns

`CommandColumnDef<T>` is TanStack's `ColumnDef` plus: `id` (required), `cellRenderer`, `cellConfig: Record<string, unknown>`, `cellStyle`, `filterType: 'text' | 'select' | 'date-range' | 'number-range' | 'boolean'`, `filterOptions`, `filterOptionLabels`, `sticky: 'left' | 'right'`, `align`, `editable`, `cellEditor`, `cellEditorConfig`.

A `filterType` gives the column a header filter and a default `filterFn` (a column's own `filterFn` wins): text contains, select equals or set membership, boolean, `date-range` `{ from?, to? }`, `number-range` `{ min?, max? }`. Range popovers render two inputs; an empty bound is open.

## Renderers (`cellRenderer`) and their `cellConfig`

| Name | Config |
|---|---|
| `text` | `formatValue(raw: string)` |
| `link` | `onClick(value, row)` |
| `two-line` | `primaryField` / `primaryAccessor`, `secondaryField` / `secondaryAccessor` (field name or `(row) => node`), `secondaryStyle` |
| `deadline` | date-driven: `criticalDays` (3), `warningDays` (7), `showCountdown`, `doneField`, `doneLabel` |
| `countdown` | number-driven: `daysField`, `variantField`, `variants: Record<string, 'critical' \| 'warning' \| 'ok' \| 'done' \| 'none'>`, `doneLabel`, `labels: { today, overdue, until }` |
| `date` | none; formats with the environment's locale |
| `status-pill` | `getVariant(value) → { label, bg, text }` or `colorMap` (string or `{ bg, text }`, `default` key), `formatLabel(value, row)` |
| `count-badge` | `thresholds: { max, color, display? }[]`, `hoverContent` (field), `formatValue(value, row)` |
| `priority-icon` | `icons: Record<string, string>`; defaults are coloured text circles for `urgent`, `high`, `medium`, `low` |
| `currency` | `formatValue(value, row)` may return a word instead of a figure; otherwise the environment's locale and currency |
| `staleness` | `criticalDays` (7), `warningDays` (3), `emptyLabel` |
| `boolean-check` | none |
| `inline-actions` | `actions: CommandInlineAction<T>[]` |
| `checkbox` | selection plumbing (used by `selectionMode`) |

Custom renderers: `customRenderers={{ name: (props: CellRendererProps<T>) => node }}`; a custom name overrides a built-in; an unknown name falls back to `text`. Editors: `text-input`, `select` (`config.options: { value, label }[]`), `date`; editors commit on Enter or blur and cancel on Escape.

## Keyboard

Inside the cockpit: ↑/↓ rows, Enter opens the detail panel, Esc closes it (or blurs an input), `/` focuses the global filter, Ctrl/⌘+A selects all. Add `keyboardShortcuts` with `scope: 'grid' | 'global'`; shortcuts are suppressed while a text input has focus, except Escape.

## Theme

Tokens live on `.gc-theme-light` / `.gc-theme-dark`. Override per deployment with `themeOverrides` on the outermost `ThemeProvider`, or own them on `:root` and use `mode="inherit"`. Status colours (`--gc-green/yellow/orange/red`) are the same in every product on purpose.

## Persistence

`onPersistState` receives `PersistedGridState` (column order, widths, visibility, sort, grouping, density, global filter, panel width), debounced; filters and the active preset are never persisted. `persistenceKey` namespaces the one key the package writes itself (the pinned detail panel).

## License

Apache-2.0.
