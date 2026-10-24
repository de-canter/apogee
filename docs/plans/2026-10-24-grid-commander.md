# `@de_canter/apogee-grid-commander` 0.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the archived TitlePrompt Grid Commander into `packages/grid-commander` of this repo as a clean, typed, versioned Apogee package, published as `0.1.0-rc.1` from the branch and `0.1.0` after merge.

**Architecture:** Copy the archived source and tests (`../titleprompt/apogee/grid-commander`, 5.4k lines, 27 test files) into an Apogee package shaped like `packages/agent-react`; remove the product residue; type the public surface without `any`; make clock, locale and currency a React context; fix the known bugs test-first; add a `countdown` renderer; make `ThemeProvider` nest-safe; emit one `styles.css`.

**Tech Stack:** TypeScript strict (Apogee `tsconfig.base.json`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), React 18 || 19 peer, `@tanstack/react-table` ^8.21, `@tanstack/react-virtual` ^3.13, tsup esm + cjs + dts, vitest 4 + jsdom 26 + Testing Library 16 under React 19, ESLint flat config (`no-explicit-any: error`).

**Spec:** `/Users/jcanter/src/github/de-canter/covena/docs/superpowers/specs/2026-10-24-milestone-2b-c3-shell-design.md` §4.1, §4.7 (approved 2026-10-24). The archived package is condensed in `/private/tmp/claude-501/-Users-jcanter-src-github-de-canter-covena/0cba7fc1-2205-4c36-bb49-db01a83bee1b/scratchpad/grid-commander-brief.md`.

## Global Constraints

- Apogee gate before every commit, unfiltered at the root: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Turbo hides errors when piped; redirect to a file and read the tail.
- "Nothing product-specific belongs here": no title-industry words, order or file vocabulary, issue numbers, demo clocks, or app stores. Comments and test fixtures use neutral domain words (rows, items, deadlines).
- No `any` on the public surface or inside; `unknown` plus generics; narrow at the boundary.
- No Tailwind, no icon library, no UI kit; all colours through `var(--gc-*)` tokens; no hard-coded hex in components.
- Peers `react` / `react-dom` `^18.0.0 || ^19.0.0`; dependencies only the two TanStack packages.
- Package name `@de_canter/apogee-grid-commander`, Apache-2.0, `publishConfig.access: public`, `exports` for `.` (esm + cjs + types) and `./styles.css`.
- Repo rules on Selene: `rm -rf` is denied (use `git rm` or move); do not chain commit, push and PR creation in one command; `NODE_ENV=development` is exported in the shell.
- Every behaviour change in this plan has a test that failed first; the carried-over tests keep passing.

## Review Focus

1. **A host theme above a cockpit.** With a `ThemeProvider` at the app root carrying overrides and `CommandCockpit` inside it, the cockpit's cells render with the host's `--gc-accent`, not the package default. Test in Task 7 by reading the computed custom property on a cell inside a nested cockpit.
2. **Clock injection reaches every date cell.** With `now` set to a fixed date on the cockpit, `deadline`, `staleness`, `date` and `ActivityLog` all format relative to it and never to the wall clock. Test in Task 5 with a frozen `now` far from the real date.
3. **Export respects the active filter.** After a text filter leaves 2 of 5 rows, CSV export contains 2 data lines. Test in Task 6.
4. **Range filters with one bound.** A `number-range` filter with only `min`, and a `date-range` with only `to`, keep the rows on the open side and drop the others. Test in Task 6.
5. **Keyboard under virtualisation.** Pressing ↓ past the rendered window scrolls the selected row into view and the row carries `aria-selected`. Test in Task 6 with 300 rows and a small viewport (jsdom: assert `scrollToIndex` was called with the selected index through a spied virtualizer).

---

## File structure

```
packages/grid-commander/
  package.json  tsup.config.ts  tsconfig.json  vitest.config.ts  README.md  LICENSE (copied)
  src/index.ts                       public API (archived index minus removals, plus additions)
  src/environment.tsx                CockpitEnvironment context + useCockpitEnvironment
  src/components/**                  as archived, minus CommandPinnedTray and detail/DocumentTray
  src/components/renderers/CountdownCell.tsx   new
  src/themes/{variables,light,dark,components}.css, ThemeProvider.tsx (nest-safe), styles.css (imports the four)
  src/types/**                       typed without any
  src/utils/{dates,export,validation,formatting,filters}.ts   filters.ts new (default filterFns)
  src/__tests__/setup.ts and the 25 carried test files (CommandPinnedTray and DocumentTray tests dropped), plus new tests named per task
```

---

### Task 1: Scaffold and carry the source over, green under the Apogee gate (types excepted)

**Files:**
- Create: `packages/grid-commander/{package.json,tsup.config.ts,tsconfig.json,vitest.config.ts,README.md}`, `src/**` copied from `../titleprompt/apogee/grid-commander/src/**`, `src/__tests__/**` from `__tests__/**` (paths updated), `src/themes/styles.css`
- Modify: `docs/consuming.md` (add the package to the install list and the publish order, after `agent-react`), `.github/workflows/release.yml` (tag regex)

**Interfaces:**
- Produces: a building package whose `src/index.ts` exports exactly the archived names minus `CommandPinnedTray`, `CommandPinnedTrayProps`, `PinnedItem`, `DocumentTray`, `DocumentTrayProps`, `DocumentItem`, `ColumnStateChange`, `setGridClock`, `gridNow` (the last two return in Task 5 as the context). `exports['./styles.css']` → `./dist/styles.css`.

- [ ] **Step 1: Scaffold** from `packages/agent-react` (copy its `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts` with `setupFiles: ['./src/__tests__/setup.ts']`; `setup.ts` is `import '@testing-library/jest-dom/vitest';`). `package.json`: name, version `0.1.0`, description "Cockpit-grade data grid for Apogee products: CommandCockpit over TanStack Table and Virtual, renderers, editors, context menu, detail panel, status bar, keyboard model, themes.", `exports` `.` and `./styles.css`, `files` `dist` + `README.md`, `sideEffects: ["*.css"]`, peers and deps per Global Constraints, dev deps as `agent-react` plus `@tanstack/*` are runtime deps. tsup: add `src/themes/styles.css` to `entry` so `dist/styles.css` is emitted (tsup bundles CSS entries).
- [ ] **Step 2: Copy** the archived `src/` and `__tests__/` (into `src/__tests__/`, fixing relative imports from `../src/x` to `../x`). Delete `components/CommandPinnedTray.tsx`, `components/detail/DocumentTray.tsx`, their two tests, and their exports and types; delete `ColumnStateChange`; stub nothing.
- [ ] **Step 3: Release workflow**: in `release.yml` change both `sed` patterns from `([0-9.]+)` to `([0-9A-Za-z.-]+)` so `grid-commander-v0.1.0-rc.1` resolves to name `grid-commander` and version `0.1.0-rc.1`. Add a comment line naming the prerelease form.
- [ ] **Step 4: Run** `pnpm install` then `pnpm --filter @de_canter/apogee-grid-commander test > /tmp/gc-t1.log 2>&1; tail -5 /tmp/gc-t1.log`.
  Expected: the carried tests pass under React 19 and vitest 4 except where they relied on removed modules; fix the test harness, not behaviour, until green. Record the test count.
- [ ] **Step 5: Lint and typecheck** will fail on `any` (Task 2) and possibly `process.env`. Run `pnpm --filter @de_canter/apogee-grid-commander typecheck lint > /tmp/gc-t1b.log 2>&1; grep -c "no-explicit-any" /tmp/gc-t1b.log` and record the count in the commit message; do not fix them here.
- [ ] **Step 6: Commit** `feat(grid-commander): carry the archived package into the workspace (tests green; typing in the next task)`.

---

### Task 2: Public types without `any`

**Files:**
- Modify: `src/types/{column,actions,cockpit-ref,editing,status-bar,detail-panel,selection,shortcuts,grid-states,toolbar,theme,persistence}.ts`, every renderer and editor, `components/CommandCockpit.tsx`, `CommandGrid.tsx`, `CommandContextMenu.tsx`, `hooks/useGridTable.ts`, `utils/validation.ts`, the two registries
- Test: `src/__tests__/types.test-d.ts` (vitest `expectTypeOf`)

**Interfaces (Produces):**
```ts
interface CellRendererProps<TRow, TValue = unknown> { value: TValue; row: TRow; config: Record<string, unknown>; columnId: string }
type CellRendererFn<TRow> = (props: CellRendererProps<TRow>) => React.ReactNode
interface CellEditorProps<TRow, TValue = unknown> { value: TValue; row: TRow; config: Record<string, unknown>; columnId: string; onCommit(v: TValue): void; onCancel(): void }
interface CommandColumnDef<TRow> extends Omit<ColumnDef<TRow, unknown>, 'id'> { id: string; cellRenderer?: string; cellConfig?: Record<string, unknown>; … }
interface ActionContext<TRow> { selectedIds: string[]; selectedRows: TRow[]; filteredRows: TRow[] }
interface CommandAction<TRow> { …; handler?(row: TRow, cockpit: CockpitRef<TRow>): void; visible?(row: TRow, ctx: ActionContext<TRow>): boolean; disabled?(row: TRow, ctx: ActionContext<TRow>): boolean }
interface CockpitRef<TRow> { … }  // no default type parameter
```
Renderers read `config` through small typed getters in `src/utils/config.ts`: `str(config, key, fallback)`, `num(config, key, fallback)`, `fn<T>(config, key)`, `rec(config, key)`.

- [ ] **Step 1: Failing type test** `types.test-d.ts`: `expectTypeOf<CellRendererProps<{ a: 1 }>['value']>().toEqualTypeOf<unknown>()`; `expectTypeOf<CockpitRef<{ a: 1 }>['selectedRow']>().toEqualTypeOf<{ a: 1 } | null>()`; a `CommandAction<{ a: 1 }>['visible']` whose second parameter is `ActionContext<{ a: 1 }>`. Run `pnpm --filter @de_canter/apogee-grid-commander exec vitest run --typecheck src/__tests__/types.test-d.ts`. Expected: FAIL (`any` collapses the assertions).
- [ ] **Step 2: Rewrite the types** per Interfaces; add `utils/config.ts`; update every renderer, editor and the cockpit to narrow at the boundary. Populate `ActionContext` in `CommandContextMenu` from the cockpit's selection and filtered rows (it was `any` and never set).
- [ ] **Step 3: Run** the type test, then `pnpm --filter @de_canter/apogee-grid-commander typecheck lint test > /tmp/gc-t2.log 2>&1; tail -8 /tmp/gc-t2.log`. Expected: zero `no-explicit-any`, zero type errors, tests green (fixtures adjusted only where they passed `any`-typed configs).
- [ ] **Step 4: Commit** `refactor(grid-commander): public types without any; ActionContext populated`.

---

### Task 3: Remove the residue and the hard-coded locale

**Files:**
- Modify: `src/themes/light.css`, `dark.css` (delete the seven `--gc-stage-*`; add `--gc-text-primary`? no: replace its one use in `components.css:1131` with `--gc-text`), `components/renderers/PriorityIconCell.tsx` (text glyph `●` coloured by `--gc-red/orange/yellow/text-muted`, labels from config), `utils/formatting.ts` (`formatCurrency(value, { locale, currency })`), `utils/dates.ts` (`formatDate(d, { locale })`, `now` parameter required, no module clock), `components/detail/ActivityLog.tsx` (labels from a `labels` prop with en-US defaults), all comments and fixtures with issue numbers or title words
- Test: `src/__tests__/residue.test.ts`

- [ ] **Step 1: Failing test** `residue.test.ts` reads the built CSS sources and `src/**` with `fs` and asserts: no `--gc-stage-`; no `--gc-text-primary`; no `/#(909|920|862|1286)\b/`; no `/\b(GF|title company|TitlePrompt|titleprompt|order number)\b/i` in `src/**` excluding this test; `formatCurrency(1234.5, { locale: 'de-DE', currency: 'EUR' })` contains `€`; `formatDate('2026-10-28', { locale: 'en-GB' })` is `28/10/2026`.
- [ ] **Step 2: Run**, expect FAIL on each assertion.
- [ ] **Step 3: Implement.** `formatCurrency(value: number, opts?: { locale?: string; currency?: string; minimumFractionDigits?: number })` with `Intl.NumberFormat`; `formatDate(d: string | Date, opts?: { locale?: string })` with `Intl.DateTimeFormat` 2-digit day/month, numeric year.
- [ ] **Step 4: Run**, expect PASS, suite green.
- [ ] **Step 5: Commit** `chore(grid-commander): strip product residue; locale-aware formatting`.

---

### Task 4: `ThemeProvider` nest-safe with `inherit` mode; one `styles.css`

**Files:**
- Modify: `src/themes/ThemeProvider.tsx`, `src/components/CommandCockpit.tsx` (inner provider stays but becomes inert when nested), `src/themes/styles.css`
- Test: `src/__tests__/ThemeProvider.test.tsx` (extend)

**Interfaces (Produces):**
```ts
interface ThemeProviderProps { theme?: 'light' | 'dark'; themeOverrides?: Record<string, string>; mode?: 'declare' | 'inherit'; children }
useThemeDepth(): number   // 0 outside any provider
```

- [ ] **Step 1: Failing tests**: (a) nested providers render exactly one element with class `gc-theme-light` and the inner one has no `--gc-*` inline style; (b) `mode="inherit"` renders no theme class and no inline tokens; (c) a `CommandCockpit` inside an outer provider with `themeOverrides={{ '--gc-accent': 'rgb(1, 2, 3)' }}` has `getComputedStyle(cell).getPropertyValue('--gc-accent').trim() === 'rgb(1, 2, 3)'` on a rendered header cell (jsdom resolves inline custom properties through inheritance); (d) `dist/styles.css` exists after build and contains `.gc-theme-light` and `.gc-cockpit`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement**: a `ThemeDepthContext`; the provider declares class and overrides only at depth 0 and `mode === 'declare'`; otherwise it renders `<div style={{height:'100%'}}>`. `styles.css` is `@import` of variables, light, dark, components in that order.
- [ ] **Step 4: Run**, expect PASS; `pnpm --filter @de_canter/apogee-grid-commander build` emits `dist/styles.css`.
- [ ] **Step 5: Commit** `feat(grid-commander): nest-safe ThemeProvider with inherit mode; single styles.css`.

---

### Task 5: `CockpitEnvironment` (now, locale, currency) and the `countdown` renderer

**Files:**
- Create: `src/environment.tsx`, `src/components/renderers/CountdownCell.tsx`
- Modify: `CommandCockpit.tsx` (props `now?: Date | (() => Date)`, `locale?: string`, `currency?: string`; provides the context), `DeadlineCell`, `StalenessCell`, `DateCell`, `CurrencyCell`, `ActivityLog`, `renderers/registry.ts` (register `countdown`), `src/index.ts`
- Test: `src/__tests__/environment.test.tsx`, `src/__tests__/CountdownCell.test.tsx`

**Interfaces (Produces):**
```ts
interface CockpitEnvironment { now(): Date; locale: string; currency: string }
useCockpitEnvironment(): CockpitEnvironment   // defaults: () => new Date(), 'en-US', 'USD'
// countdown cellConfig
{ daysField: string; variantField?: string; variants?: Record<string, 'critical'|'warning'|'ok'|'done'|'none'>; doneLabel?: string; labels?: { today?: string; overdue?: string; until?: string } }
```
Rendering: `days === null` → "—"; variant `done` → `doneLabel` ("Done"); `days < 0` → `${-days}d overdue`; `0` → "Today"; else `${days}d`; class `gc-countdown--<variant>` from `variantField` via `variants`, else from days (≤0 critical, ≤3 warning, else ok).

- [ ] **Step 1: Failing tests**: a cockpit with `now={() => new Date('2030-01-01T12:00:00Z')}` and a `deadline` column on `'2030-01-04'` renders "3d" (Review Focus 2) and a `staleness` column on `'2029-12-25'` renders "7d"; `currency="EUR" locale="de-DE"` renders `€` in a `currency` cell; `countdown` with `{ daysField: 'closingInDays', variantField: 'bucket', variants: { OVERDUE: 'critical', TODAY: 'critical', THIS_WEEK: 'warning', LATER: 'ok', NONE: 'none' } }` renders "2d overdue" with class `gc-countdown--critical` for `{ closingInDays: -2, bucket: 'OVERDUE' }`, "Today" for 0, "12d" with `--ok` for `{ 12, LATER }`, and "—" for `null`.
- [ ] **Step 2: Run**, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, expect PASS; suite green.
- [ ] **Step 5: Commit** `feat(grid-commander): cockpit environment (now, locale, currency); countdown renderer`.

---

### Task 6: Bug fixes, each test-first

**Files:**
- Modify: `CommandCockpit.tsx` / `CommandToolbar.tsx` (export gets filtered rows), `editors/DateEditor.tsx`, `types/cockpit-ref.ts` + `CommandGrid.tsx` (`stopEditing(save)`), `hooks/usePersistedState.ts` + `CommandDetailPanel.tsx` (`persistenceKey` namespaces every localStorage key), `hooks/useGridTable.ts` + `CommandGrid.tsx` header popover (default filterFns and range inputs), `utils/filters.ts` (new), registries + `validation.ts` (`NODE_ENV` guard), `hooks/useVirtualRows.ts` + `CommandGrid.tsx` (scrollToIndex; row heights from density)
- Test: `src/__tests__/fixes.test.tsx`

**Interfaces (Produces):** `utils/filters.ts` exports `filterFns: { text, select, boolean, dateRange, numberRange }` typed as TanStack `FilterFn<unknown>`; `DateRangeValue = { from?: string; to?: string }`, `NumberRangeValue = { min?: number; max?: number }`.

- [ ] **Step 1: Failing tests** in `fixes.test.tsx`: export CSV after a text filter has 2 data lines of 5 (Review Focus 3); `number-range` `{ min: 10 }` keeps 10 and 11 and drops 9, `date-range` `{ to: '2030-01-05' }` keeps the 4th and drops the 6th (Review Focus 4); `select` with an array value keeps rows whose value is in the set; `stopEditing(false)` leaves the cell value unchanged; `DateEditor` commits `2030-03-01` on Enter for a typed `2030-03-01` in a `-08:00` zone (set `process.env.TZ` in the test) and cancels on Escape; two cockpits with different `persistenceKey`s keep separate pinned-panel flags in localStorage; `validateColumnDefs` does not throw when `process.env` is undefined (delete it in the test and restore); with 300 rows and `enableVirtualization`, pressing ↓ from row 40 calls the virtualizer's `scrollToIndex` with 41 (spy via `vi.mock('@tanstack/react-virtual')`) (Review Focus 5).
- [ ] **Step 2: Run**, expect FAIL on each.
- [ ] **Step 3: Implement** each fix; the header popover renders two inputs for ranges (`min`/`max` numbers, `from`/`to` dates).
- [ ] **Step 4: Run**, expect PASS; suite green; `pnpm typecheck lint build test` at the root green.
- [ ] **Step 5: Commit** `fix(grid-commander): export respects filters; range filters; date editor; persistence key; env guard; virtual scroll-into-view`.

---

### Task 7: README, consuming doc, prerelease publish

**Files:**
- Create: `packages/grid-commander/README.md` (API table from `src/index.ts`: components, hooks, renderers with their `cellConfig` keys, editors, types; the environment props; theming with `mode`; a 30-line usage example with neutral data)
- Modify: `docs/consuming.md` (done in Task 1; verify), `docs/TODO.md` (queue entry: approve the PR, then tag `grid-commander-v0.1.0`)
- Test: Review Focus 1 end-to-end: `src/__tests__/host-theme.test.tsx` renders `ThemeProvider` → page → `CommandCockpit` and asserts the computed `--gc-accent` on a header cell equals the host override (if Task 4(c) already covers it, this task adds the `mode="inherit"` variant with a `:root` style tag).

- [ ] **Step 1: Write the host-theme test**, run, expect PASS if Task 4 is complete (if it fails, Task 4 is incomplete; fix there).
- [ ] **Step 2: Docs.** Commit `docs(grid-commander): README, consuming, TODO`.
- [ ] **Step 3: Push the branch** `feature/grid-commander`; open the PR to `main` with the plan path and the test count; **do not merge** (Jeff approves Apogee PRs).
- [ ] **Step 4: Prerelease**: set `"version": "0.1.0-rc.1"` in `package.json`, commit `chore(grid-commander): 0.1.0-rc.1`, tag `grid-commander-v0.1.0-rc.1` on that commit, push the tag; watch the `release` workflow; confirm `npm view @de_canter/apogee-grid-commander@0.1.0-rc.1 version`. If the workflow refuses, fall back to `pnpm -C packages/grid-commander pack` and the tarball path in `docs/consuming.md`, and say so.
- [ ] **Step 5: Ledger** the published version for the Covena plan.

---

## Self-review notes

- Spec §4.1 "carry over" → T1; "remove" → T1, T3; "make injectable" → T5; "fix" → T6 (plus `--gc-text-primary` and glyphs in T3); theme → T4; types → T2; package facts and release → T1, T7; §4.7 → T4, T5, T6.
- Names used across tasks: `useCockpitEnvironment`, `filterFns`, `ThemeProviderProps.mode`, `CountdownCell` config keys, `ActionContext` are defined once each above.
- The plan is shorter than the spec section it implements plus the archived code it moves; code blocks are signatures and config shapes only.
