# Apogee Kernel — Phase 1 (Primitives) Implementation Plan

> **Outcome (2026-09-18):** Completed as planned. Merged via de-canter/apogee#5, tagged `kernel-v0.1.0`. 57 tests, 96% line coverage, CI green. One deviation: git-dependency syntax is `#<ref>&path:packages/kernel` (ref first). Zod 4's `z.iso.datetime` used for the ISODate brand.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-09-17
**Origin:** Design conversation 2026-09-17 (Jeff + Claude); spec at `docs/design/kernel-ontology.md`.

**Goal:** Ship `@de_canter/apogee-kernel` v0.1.0 from this repo: the shared value objects and mixins (Ref, Money, Quantity, Identifier, Interval, Bitemporal, Provenance, Assertion, Lifecycle, Role, Relationship, Classification) as Zod schemas, TS types, and pure functions, proven against reference-domain acceptance tests.

**Architecture:** This repo becomes a pnpm + Turborepo workspace with `packages/kernel` as its first package. The kernel has zero persistence or HTTP dependencies; it exports schemas, types, and pure functions only, built dual ESM/CJS with tsup. Every stored shape is JSON-safe (ISO date strings, integer minor units, no bigint). Products compose kernel types into concrete named types; the kernel never becomes a universal object table.

**Tech Stack:** TypeScript 5.x strict, pnpm 9, Turborepo, tsup (ESM + CJS + d.ts), Vitest 4, ESLint 9 flat config + typescript-eslint, Zod 4.

**Spec:** `docs/design/kernel-ontology.md` (read §2 layering rule and §4 decisions before any task).

## Global Constraints

- TypeScript `strict: true`; no `any`; `unknown` + narrowing only.
- No lint-rule disables in source (shared CLAUDE.md §8).
- Every stored shape must satisfy `deepEqual(JSON.parse(JSON.stringify(x)), x)`.
- Dates in stored shapes are ISO 8601 strings, never `Date`.
- Money is integer minor units + ISO 4217 code. Mixed-currency arithmetic throws.
- Package name `@de_canter/apogee-kernel`, path `packages/kernel`, `private: false` (it will be consumed by other repos).
- Node `>=20`. `packageManager: pnpm@9.15.9` (the version installed on Selene).
- Commit after every task (shared CLAUDE.md §7); branch `feature/kernel-primitives`, PR to `main`.
- No incremental migration of the reference product in this plan. The reference product's domain appears only as acceptance tests (Task 9).

## File Structure

```
apogee/
├── package.json                  # workspace root: turbo, scripts
├── pnpm-workspace.yaml           # packages/*
├── turbo.json
├── tsconfig.base.json            # strict, ES2022, NodeNext-compatible
├── eslint.config.js              # flat config, typescript-eslint
├── .gitignore
├── .github/workflows/ci.yml      # typecheck + lint + test on PR
└── packages/kernel/
    ├── package.json
    ├── tsconfig.json
    ├── tsup.config.ts
    ├── vitest.config.ts
    ├── README.md
    └── src/
        ├── index.ts              # barrel
        ├── ref.ts                # Ref
        ├── time.ts               # ISODate, Interval, Bitemporal, asOf
        ├── money.ts              # Money + arithmetic + allocate
        ├── quantity.ts           # Quantity + rounding
        ├── rounding.ts           # shared RoundingMode + roundTo
        ├── identifier.ts         # Identifier + scheme registry
        ├── provenance.ts         # Provenance + Assertion
        ├── lifecycle.ts          # defineLifecycle
        ├── role.ts               # Role, Relationship
        ├── classification.ts     # Classification, tags
        └── __tests__/
            ├── ref.test.ts
            ├── time.test.ts
            ├── money.test.ts
            ├── quantity.test.ts
            ├── identifier.test.ts
            ├── provenance.test.ts
            ├── lifecycle.test.ts
            ├── role.test.ts
            ├── classification.test.ts
            └── acceptance/
                ├── proration.test.ts
                ├── gap-coverage.test.ts
                └── identifiers.test.ts
```

Each source file owns one concept and its schema, type, and functions together. Files that change together live together.

---

### Task 1: Workspace bootstrap + kernel skeleton with `Ref`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.gitignore`, `.github/workflows/ci.yml`
- Create: `packages/kernel/package.json`, `packages/kernel/tsconfig.json`, `packages/kernel/tsup.config.ts`, `packages/kernel/vitest.config.ts`
- Create: `packages/kernel/src/index.ts`, `packages/kernel/src/ref.ts`
- Test: `packages/kernel/src/__tests__/ref.test.ts`

**Interfaces:**
- Produces: `Ref` type `{ kind: string; id: string }`, `RefSchema` (Zod), `ref(kind, id): Ref`, `sameRef(a, b): boolean`.

- [ ] **Step 1: Create the branch**

```bash
git -C <apogee repo> checkout -b feature/kernel-primitives
```

- [ ] **Step 2: Root workspace files**

`package.json`:
```json
{
  "name": "apogee",
  "private": true,
  "packageManager": "pnpm@9.15.9",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "turbo": "^2.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["build"], "outputs": ["coverage/**"] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "lint": { "outputs": [] },
    "clean": { "cache": false }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist"]
}
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
);
```

`.gitignore`:
```gitignore
node_modules/
dist/
coverage/
*.tsbuildinfo
.turbo/
.claude/status.json
.claude/WATCHDOG_TIMEOUT
.claude/settings.local.json
BLOCKED.md
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  pull_request:
    branches: [main]
  workflow_dispatch:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

- [ ] **Step 3: Kernel package files**

`packages/kernel/package.json`:
```json
{
  "name": "@de_canter/apogee-kernel",
  "version": "0.1.0",
  "description": "Apogee domain kernel: shared value objects, mixins, and entity categories",
  "license": "UNLICENSED",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist", "README.md"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^4.0.0"
  }
}
```

`packages/kernel/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "noEmit": true },
  "include": ["src/**/*"]
}
```

`packages/kernel/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
```

`packages/kernel/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/index.ts'] },
  },
});
```

- [ ] **Step 4: Install**

```bash
pnpm install
```
Expected: lockfile created, no peer warnings from zod/tsup/vitest.

- [ ] **Step 5: Write the failing test**

`packages/kernel/src/__tests__/ref.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { RefSchema, ref, sameRef } from '../ref';

describe('Ref', () => {
  it('builds a ref with kind and id', () => {
    expect(ref('Order', 'abc')).toEqual({ kind: 'Order', id: 'abc' });
  });

  it('validates shape and rejects empty strings', () => {
    expect(RefSchema.safeParse({ kind: 'Order', id: 'abc' }).success).toBe(true);
    expect(RefSchema.safeParse({ kind: '', id: 'abc' }).success).toBe(false);
    expect(RefSchema.safeParse({ kind: 'Order', id: '' }).success).toBe(false);
  });

  it('compares refs structurally', () => {
    expect(sameRef(ref('Order', '1'), ref('Order', '1'))).toBe(true);
    expect(sameRef(ref('Order', '1'), ref('Party', '1'))).toBe(false);
  });

  it('is JSON-safe', () => {
    const r = ref('Order', '1');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test`
Expected: FAIL, cannot resolve `../ref`.

- [ ] **Step 7: Implement**

`packages/kernel/src/ref.ts`:
```ts
import { z } from 'zod';

/** Typed reference to any entity. `kind` is the product's concrete type name (e.g. 'Order'). */
export const RefSchema = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
});

export type Ref = z.infer<typeof RefSchema>;

export function ref(kind: string, id: string): Ref {
  return RefSchema.parse({ kind, id });
}

export function sameRef(a: Ref, b: Ref): boolean {
  return a.kind === b.kind && a.id === b.id;
}
```

`packages/kernel/src/index.ts`:
```ts
export * from './ref';
```

- [ ] **Step 8: Run test, typecheck, lint, build**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 4 tests pass; typecheck/lint clean; `packages/kernel/dist/index.js`, `index.cjs`, `index.d.ts` exist.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(kernel): bootstrap workspace and @de_canter/apogee-kernel with Ref

Adds pnpm/turbo workspace, tsup dual build, vitest, eslint flat config.
New top-level deps: turbo, tsup, vitest, typescript-eslint, zod@4 (kernel).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Rounding + Money

**Files:**
- Create: `packages/kernel/src/rounding.ts`, `packages/kernel/src/money.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/money.test.ts`

**Interfaces:**
- Produces: `RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP'`; `roundTo(value: number, decimals: number, mode?: RoundingMode): number`.
- Produces: `Money = { minor: number; currency: string }`, `MoneySchema`; `money(minor, currency)`, `moneyFromDecimal(amount: string | number, currency)`, `add`, `subtract`, `multiply(m, ratio, mode?)`, `compareMoney`, `isZero`, `negate`, `allocate(m, weights: number[], mode?)`, `formatMoney(m)`, `toDecimalString(m)`, `currencyScale(code)`.
- Errors: `CurrencyMismatchError`, `UnknownCurrencyError` (both extend `KernelError` defined here in `rounding.ts`'s sibling `errors.ts`).

- [ ] **Step 1: Write the failing tests**

`packages/kernel/src/__tests__/money.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { roundTo } from '../rounding';
import {
  MoneySchema, add, allocate, compareMoney, formatMoney, money, moneyFromDecimal,
  multiply, subtract, toDecimalString, CurrencyMismatchError, UnknownCurrencyError,
} from '../money';

describe('roundTo', () => {
  it('HALF_UP is the default and rounds .5 away from zero', () => {
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(1.005, 2)).toBe(1.01);
  });
  it('HALF_EVEN rounds to even', () => {
    expect(roundTo(2.5, 0, 'HALF_EVEN')).toBe(2);
    expect(roundTo(3.5, 0, 'HALF_EVEN')).toBe(4);
  });
  it('DOWN truncates toward zero, UP away from zero', () => {
    expect(roundTo(2.9, 0, 'DOWN')).toBe(2);
    expect(roundTo(-2.9, 0, 'DOWN')).toBe(-2);
    expect(roundTo(2.1, 0, 'UP')).toBe(3);
  });
});

describe('Money', () => {
  it('constructs from decimal string without float drift', () => {
    expect(moneyFromDecimal('0.10', 'USD')).toEqual({ minor: 10, currency: 'USD' });
    expect(moneyFromDecimal('1234.567', 'USD')).toEqual({ minor: 123457, currency: 'USD' });
    expect(moneyFromDecimal(19.99, 'USD')).toEqual({ minor: 1999, currency: 'USD' });
  });
  it('rejects non-integer minor units and unknown currencies', () => {
    expect(MoneySchema.safeParse({ minor: 1.5, currency: 'USD' }).success).toBe(false);
    expect(() => money(100, 'XXX')).toThrow(UnknownCurrencyError);
  });
  it('adds and subtracts same currency, throws on mismatch', () => {
    expect(add(money(100, 'USD'), money(250, 'USD'))).toEqual(money(350, 'USD'));
    expect(subtract(money(100, 'USD'), money(250, 'USD'))).toEqual(money(-150, 'USD'));
    expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(CurrencyMismatchError);
  });
  it('multiplies by a ratio with rounding', () => {
    expect(multiply(money(1000, 'USD'), 1 / 3)).toEqual(money(333, 'USD'));
    expect(multiply(money(1000, 'USD'), 0.125)).toEqual(money(125, 'USD'));
    expect(multiply(money(1005, 'USD'), 0.5)).toEqual(money(503, 'USD'));            // HALF_UP
    expect(multiply(money(1005, 'USD'), 0.5, 'HALF_EVEN')).toEqual(money(502, 'USD'));
  });
  it('allocates by weights with largest remainder so the sum is exact', () => {
    const parts = allocate(money(100, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.minor)).toEqual([34, 33, 33]);
    expect(parts.reduce((s, p) => s + p.minor, 0)).toBe(100);
    const uneven = allocate(money(1001, 'USD'), [70, 30]);
    expect(uneven.map((p) => p.minor)).toEqual([701, 300]);
  });
  it('allocate rejects empty or all-zero weights', () => {
    expect(() => allocate(money(100, 'USD'), [])).toThrow();
    expect(() => allocate(money(100, 'USD'), [0, 0])).toThrow();
  });
  it('compares and formats', () => {
    expect(compareMoney(money(1, 'USD'), money(2, 'USD'))).toBe(-1);
    expect(toDecimalString(money(-123456, 'USD'))).toBe('-1234.56');
    expect(toDecimalString(money(5, 'JPY'))).toBe('5');
    expect(formatMoney(money(123456, 'USD'))).toBe('$1,234.56');
  });
  it('is JSON-safe', () => {
    const m = money(1, 'USD');
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test money`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement errors, rounding, money**

`packages/kernel/src/errors.ts`:
```ts
export class KernelError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}
```

`packages/kernel/src/rounding.ts`:
```ts
import { z } from 'zod';

export const RoundingModeSchema = z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP']);
export type RoundingMode = z.infer<typeof RoundingModeSchema>;

/**
 * Round `value` to `decimals` places. Works on the scaled integer to avoid the
 * classic 1.005 -> 1.00 float trap; a tiny epsilon absorbs representation error.
 */
export function roundTo(value: number, decimals: number, mode: RoundingMode = 'HALF_UP'): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const sign = scaled < 0 ? -1 : 1;
  const abs = Math.abs(scaled);
  const floor = Math.floor(abs + 1e-9);
  const frac = abs - floor;
  let result: number;
  switch (mode) {
    case 'DOWN':
      result = floor;
      break;
    case 'UP':
      result = frac > 1e-9 ? floor + 1 : floor;
      break;
    case 'HALF_EVEN':
      if (Math.abs(frac - 0.5) < 1e-9) result = floor % 2 === 0 ? floor : floor + 1;
      else result = frac > 0.5 ? floor + 1 : floor;
      break;
    case 'HALF_UP':
    default:
      result = frac >= 0.5 - 1e-9 ? floor + 1 : floor;
  }
  return (sign * result) / factor;
}
```

`packages/kernel/src/money.ts`:
```ts
import { z } from 'zod';
import { KernelError } from './errors';
import { roundTo, type RoundingMode } from './rounding';

/** ISO 4217 minor-unit scale. Extend as products need. */
const CURRENCY_SCALE: Readonly<Record<string, number>> = {
  USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2, MXN: 2, JPY: 0, KWD: 3,
};

export class UnknownCurrencyError extends KernelError {
  constructor(code: string) { super(`Unknown currency: ${code}`, 'UNKNOWN_CURRENCY'); }
}
export class CurrencyMismatchError extends KernelError {
  constructor(a: string, b: string) { super(`Currency mismatch: ${a} vs ${b}`, 'CURRENCY_MISMATCH'); }
}

export function currencyScale(code: string): number {
  const scale = CURRENCY_SCALE[code];
  if (scale === undefined) throw new UnknownCurrencyError(code);
  return scale;
}

export const MoneySchema = z.object({
  minor: z.number().int().safe(),
  currency: z.string().length(3).refine((c) => c in CURRENCY_SCALE, { message: 'Unknown currency' }),
});
export type Money = z.infer<typeof MoneySchema>;

export function money(minor: number, currency: string): Money {
  currencyScale(currency);
  return MoneySchema.parse({ minor, currency });
}

export function moneyFromDecimal(amount: string | number, currency: string, mode: RoundingMode = 'HALF_UP'): Money {
  const scale = currencyScale(currency);
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new KernelError(`Invalid amount: ${String(amount)}`, 'INVALID_AMOUNT');
  return money(Math.round(roundTo(n, scale, mode) * 10 ** scale), currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}
export function negate(m: Money): Money {
  return money(-m.minor, m.currency);
}
export function isZero(m: Money): boolean {
  return m.minor === 0;
}
export function multiply(m: Money, ratio: number, mode: RoundingMode = 'HALF_UP'): Money {
  return money(roundTo(m.minor * ratio, 0, mode), m.currency);
}
export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

/** Split `m` across `weights` using largest-remainder; parts always sum to `m.minor`. */
export function allocate(m: Money, weights: number[]): Money[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0 || total <= 0 || weights.some((w) => w < 0)) {
    throw new KernelError('allocate requires non-negative weights with a positive sum', 'INVALID_WEIGHTS');
  }
  const raw = weights.map((w) => (m.minor * w) / total);
  const floors = raw.map((r) => Math.trunc(r));
  let remainder = m.minor - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.trunc(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const step = remainder < 0 ? -1 : 1;
  for (const { i } of order) {
    if (remainder === 0) break;
    floors[i] = (floors[i] ?? 0) + step;
    remainder -= step;
  }
  return floors.map((f) => money(f, m.currency));
}

export function toDecimalString(m: Money): string {
  const scale = currencyScale(m.currency);
  const sign = m.minor < 0 ? '-' : '';
  const abs = Math.abs(m.minor).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${abs}`;
  return `${sign}${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
}

export function formatMoney(m: Money, locale = 'en-US'): string {
  const scale = currencyScale(m.currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, minimumFractionDigits: scale, maximumFractionDigits: scale })
    .format(m.minor / 10 ** scale);
}
```

Add to `packages/kernel/src/index.ts`:
```ts
export * from './errors';
export * from './rounding';
export * from './money';
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: all money/rounding tests pass. If `1.005 → 1.01` fails, the epsilon in `roundTo` is the culprit; keep `1e-9` and confirm `1.005 * 100` is `100.49999999999999`, which the epsilon absorbs.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add Money with integer minor units, rounding modes, and largest-remainder allocate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Quantity

**Files:**
- Create: `packages/kernel/src/quantity.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/quantity.test.ts`

**Interfaces:**
- Consumes: `roundTo`, `RoundingMode` from `./rounding`; `KernelError` from `./errors`.
- Produces: `Quantity = { value: number; unit: string; precision: number }`, `QuantitySchema`; `quantity(value, unit, precision?)` (default precision from unit registry), `addQuantity`, `subtractQuantity`, `scaleQuantity(q, factor, mode?)`, `compareQuantity`, `formatQuantity`, `UnitMismatchError`, `UNITS` registry `{ code, label, defaultPrecision }`.

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/__tests__/quantity.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  QuantitySchema, UnitMismatchError, addQuantity, compareQuantity, formatQuantity,
  quantity, scaleQuantity, subtractQuantity,
} from '../quantity';

describe('Quantity', () => {
  it('uses the unit default precision and rounds value to it', () => {
    expect(quantity(1.23456, 'acre')).toEqual({ value: 1.235, unit: 'acre', precision: 3 });
    expect(quantity(1500.7, 'sqft')).toEqual({ value: 1501, unit: 'sqft', precision: 0 });
  });
  it('accepts explicit precision and rejects unknown units', () => {
    expect(quantity(0.125, 'percent', 3)).toEqual({ value: 0.125, unit: 'percent', precision: 3 });
    expect(() => quantity(1, 'furlong')).toThrow();
    expect(QuantitySchema.safeParse({ value: 1, unit: 'acre', precision: -1 }).success).toBe(false);
  });
  it('adds and subtracts same unit at the coarser precision, throws on mismatch', () => {
    expect(addQuantity(quantity(1.5, 'acre', 1), quantity(0.25, 'acre', 2))).toEqual({ value: 1.8, unit: 'acre', precision: 1 });
    expect(subtractQuantity(quantity(10, 'each'), quantity(3, 'each'))).toEqual({ value: 7, unit: 'each', precision: 0 });
    expect(() => addQuantity(quantity(1, 'acre'), quantity(1, 'sqft'))).toThrow(UnitMismatchError);
  });
  it('scales with rounding', () => {
    expect(scaleQuantity(quantity(10, 'each'), 1 / 3)).toEqual({ value: 3, unit: 'each', precision: 0 });
    expect(scaleQuantity(quantity(1, 'acre'), 0.5)).toEqual({ value: 0.5, unit: 'acre', precision: 3 });
  });
  it('compares and formats', () => {
    expect(compareQuantity(quantity(1, 'acre'), quantity(2, 'acre'))).toBe(-1);
    expect(formatQuantity(quantity(1234.5, 'sqft', 1))).toBe('1,234.5 sq ft');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test quantity`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`packages/kernel/src/quantity.ts`:
```ts
import { z } from 'zod';
import { KernelError } from './errors';
import { roundTo, type RoundingMode } from './rounding';

export interface UnitDefinition { code: string; label: string; defaultPrecision: number }

export const UNITS: Readonly<Record<string, UnitDefinition>> = {
  each: { code: 'each', label: '', defaultPrecision: 0 },
  percent: { code: 'percent', label: '%', defaultPrecision: 2 },
  bp: { code: 'bp', label: 'bp', defaultPrecision: 0 },
  acre: { code: 'acre', label: 'ac', defaultPrecision: 3 },
  sqft: { code: 'sqft', label: 'sq ft', defaultPrecision: 0 },
  sqm: { code: 'sqm', label: 'm²', defaultPrecision: 2 },
  day: { code: 'day', label: 'days', defaultPrecision: 0 },
  month: { code: 'month', label: 'months', defaultPrecision: 0 },
};

export class UnitMismatchError extends KernelError {
  constructor(a: string, b: string) { super(`Unit mismatch: ${a} vs ${b}`, 'UNIT_MISMATCH'); }
}

export const QuantitySchema = z.object({
  value: z.number().finite(),
  unit: z.string().refine((u) => u in UNITS, { message: 'Unknown unit' }),
  precision: z.number().int().min(0).max(12),
});
export type Quantity = z.infer<typeof QuantitySchema>;

export function quantity(value: number, unit: string, precision?: number, mode: RoundingMode = 'HALF_UP'): Quantity {
  const def = UNITS[unit];
  if (!def) throw new KernelError(`Unknown unit: ${unit}`, 'UNKNOWN_UNIT');
  const p = precision ?? def.defaultPrecision;
  return QuantitySchema.parse({ value: roundTo(value, p, mode), unit, precision: p });
}

function assertSameUnit(a: Quantity, b: Quantity): void {
  if (a.unit !== b.unit) throw new UnitMismatchError(a.unit, b.unit);
}

export function addQuantity(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b);
  return quantity(a.value + b.value, a.unit, Math.min(a.precision, b.precision));
}
export function subtractQuantity(a: Quantity, b: Quantity): Quantity {
  assertSameUnit(a, b);
  return quantity(a.value - b.value, a.unit, Math.min(a.precision, b.precision));
}
export function scaleQuantity(q: Quantity, factor: number, mode: RoundingMode = 'HALF_UP'): Quantity {
  return quantity(q.value * factor, q.unit, q.precision, mode);
}
export function compareQuantity(a: Quantity, b: Quantity): -1 | 0 | 1 {
  assertSameUnit(a, b);
  return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
}
export function formatQuantity(q: Quantity, locale = 'en-US'): string {
  const label = UNITS[q.unit]?.label ?? q.unit;
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: q.precision, maximumFractionDigits: q.precision }).format(q.value);
  return label ? `${n} ${label}` : n;
}
```

Add `export * from './quantity';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add Quantity with unit registry and precision

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Identifier + scheme registry

**Files:**
- Create: `packages/kernel/src/identifier.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/identifier.test.ts`

**Interfaces:**
- Consumes: `ISODateSchema` is defined in Task 5; to keep Task 4 independent, `validFrom`/`validTo` here are `z.string().datetime()` and Task 5 swaps them for `ISODateSchema`.
- Produces: `Identifier = { scheme: string; value: string; issuer?: string; primary?: boolean; validFrom?: string; validTo?: string }`, `IdentifierSchema`, `IdentifiersSchema` (array, at most one `primary`), `IdentifierScheme = { code: string; label: string; normalize: (raw: string) => string; validate?: (normalized: string) => boolean }`, `registerScheme(scheme)`, `getScheme(code)`, `normalizeIdentifier(scheme, raw)`, `identifier(scheme, raw, opts?)`, `findIdentifier(ids, scheme)`, `primaryIdentifier(ids)`, `UnknownSchemeError`, `InvalidIdentifierError`.

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/__tests__/identifier.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  IdentifiersSchema, InvalidIdentifierError, UnknownSchemeError, findIdentifier, identifier,
  normalizeIdentifier, primaryIdentifier, registerScheme, resetSchemesForTest,
} from '../identifier';

describe('Identifier', () => {
  beforeEach(() => {
    resetSchemesForTest();
    registerScheme({ code: 'apn', label: 'Assessor Parcel Number', normalize: (r) => r.replace(/[-\s]/g, '').toUpperCase() });
    registerScheme({
      code: 'order-number', label: 'Order Number',
      normalize: (r) => r.trim().toUpperCase(),
      validate: (n) => /^[A-Z]{2,4}-\d{4,}$/.test(n),
    });
  });

  it('normalizes through the scheme', () => {
    expect(normalizeIdentifier('apn', ' 123-45-678 ')).toBe('12345678');
    expect(identifier('apn', '123-45-678')).toEqual({ scheme: 'apn', value: '12345678' });
  });
  it('validates when the scheme defines validate', () => {
    expect(identifier('order-number', 'tp-00042').value).toBe('TP-00042');
    expect(() => identifier('order-number', 'nope')).toThrow(InvalidIdentifierError);
  });
  it('throws on unknown scheme', () => {
    expect(() => identifier('vin', '1HGCM')).toThrow(UnknownSchemeError);
  });
  it('finds by scheme and picks the primary', () => {
    const ids = [identifier('apn', '1'), identifier('order-number', 'TP-1000', { primary: true })];
    expect(findIdentifier(ids, 'order-number')?.value).toBe('TP-1000');
    expect(findIdentifier(ids, 'vin')).toBeUndefined();
    expect(primaryIdentifier(ids)?.scheme).toBe('order-number');
  });
  it('rejects more than one primary', () => {
    const ids = [identifier('apn', '1', { primary: true }), identifier('order-number', 'TP-1000', { primary: true })];
    expect(IdentifiersSchema.safeParse(ids).success).toBe(false);
  });
  it('carries issuer and validity and stays JSON-safe', () => {
    const id = identifier('apn', '1', { issuer: 'County Appraisal District', validFrom: '2024-01-01T00:00:00.000Z' });
    expect(id.issuer).toBe('County Appraisal District');
    expect(JSON.parse(JSON.stringify(id))).toEqual(id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test identifier`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/kernel/src/identifier.ts`:
```ts
import { z } from 'zod';
import { KernelError } from './errors';

export interface IdentifierScheme {
  code: string;
  label: string;
  normalize: (raw: string) => string;
  validate?: (normalized: string) => boolean;
}

const schemes = new Map<string, IdentifierScheme>();

export class UnknownSchemeError extends KernelError {
  constructor(code: string) { super(`Unknown identifier scheme: ${code}`, 'UNKNOWN_SCHEME'); }
}
export class InvalidIdentifierError extends KernelError {
  constructor(code: string, value: string) { super(`Invalid ${code}: ${value}`, 'INVALID_IDENTIFIER'); }
}

export function registerScheme(scheme: IdentifierScheme): void {
  schemes.set(scheme.code, scheme);
}
export function getScheme(code: string): IdentifierScheme {
  const s = schemes.get(code);
  if (!s) throw new UnknownSchemeError(code);
  return s;
}
/** Test-only: clears the registry so suites are independent. */
export function resetSchemesForTest(): void {
  schemes.clear();
}

export const IdentifierSchema = z.object({
  scheme: z.string().min(1),
  value: z.string().min(1),
  issuer: z.string().min(1).optional(),
  primary: z.boolean().optional(),
  validFrom: z.string().datetime().optional(),
  validTo: z.string().datetime().optional(),
});
export type Identifier = z.infer<typeof IdentifierSchema>;

export const IdentifiersSchema = z.array(IdentifierSchema).refine(
  (ids) => ids.filter((i) => i.primary).length <= 1,
  { message: 'At most one identifier may be primary' },
);

export function normalizeIdentifier(schemeCode: string, raw: string): string {
  return getScheme(schemeCode).normalize(raw);
}

export function identifier(
  schemeCode: string,
  raw: string,
  opts: Omit<Identifier, 'scheme' | 'value'> = {},
): Identifier {
  const scheme = getScheme(schemeCode);
  const value = scheme.normalize(raw);
  if (value.length === 0 || (scheme.validate && !scheme.validate(value))) {
    throw new InvalidIdentifierError(schemeCode, raw);
  }
  return IdentifierSchema.parse({ scheme: schemeCode, value, ...opts });
}

export function findIdentifier(ids: readonly Identifier[], schemeCode: string): Identifier | undefined {
  return ids.find((i) => i.scheme === schemeCode);
}
export function primaryIdentifier(ids: readonly Identifier[]): Identifier | undefined {
  return ids.find((i) => i.primary === true);
}
```

Add `export * from './identifier';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: PASS. With `exactOptionalPropertyTypes`, spreading `opts` containing `undefined` values fails parse only if a key is present with `undefined`; callers pass keys only when set.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add Identifier with per-product scheme registry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Time — ISODate, Interval, Bitemporal, asOf

**Files:**
- Create: `packages/kernel/src/time.ts`
- Modify: `packages/kernel/src/identifier.ts` (swap `z.string().datetime()` for `ISODateSchema`), `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/time.test.ts`

**Interfaces:**
- Produces: `ISODate` (branded string), `ISODateSchema`, `isoDate(d: Date | string): ISODate`, `nowIso(): ISODate`, `toDate(iso): Date`.
- Produces: `Interval = { start: ISODate; end?: ISODate }` half-open, `IntervalSchema` (start < end), `interval(start, end?)`, `intervalContains(iv, at)`, `intervalsOverlap(a, b)`, `intervalDurationMs(iv)` (throws if open).
- Produces: `Bitemporal = { validFrom: ISODate; validTo?: ISODate; recordedAt: ISODate; supersededAt?: ISODate }`, `BitemporalSchema`, `asOf<T extends Bitemporal>(rows, opts: { valid: ISODate; recorded?: ISODate }): T | undefined` (latest-recorded row valid at `valid` and known as of `recorded`, default now), `supersede<T extends Bitemporal>(row, at): T`.

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/__tests__/time.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  ISODateSchema, IntervalSchema, asOf, interval, intervalContains, intervalDurationMs, intervalsOverlap,
  isoDate, supersede, toDate,
} from '../time';

const d = (s: string) => isoDate(s);

describe('ISODate', () => {
  it('normalizes Date and strings to UTC ISO', () => {
    expect(isoDate(new Date(Date.UTC(2026, 0, 2)))).toBe('2026-01-02T00:00:00.000Z');
    expect(isoDate('2026-01-02')).toBe('2026-01-02T00:00:00.000Z');
    expect(ISODateSchema.safeParse('not a date').success).toBe(false);
    expect(toDate(d('2026-01-02')).getTime()).toBe(Date.UTC(2026, 0, 2));
  });
});

describe('Interval', () => {
  it('is half-open and requires start < end', () => {
    const iv = interval(d('2026-01-01'), d('2026-01-31'));
    expect(intervalContains(iv, d('2026-01-01'))).toBe(true);
    expect(intervalContains(iv, d('2026-01-31'))).toBe(false);
    expect(IntervalSchema.safeParse({ start: d('2026-02-01'), end: d('2026-01-01') }).success).toBe(false);
  });
  it('open-ended intervals contain everything after start', () => {
    const iv = interval(d('2026-01-01'));
    expect(intervalContains(iv, d('2099-01-01'))).toBe(true);
    expect(() => intervalDurationMs(iv)).toThrow();
  });
  it('detects overlap', () => {
    const a = interval(d('2026-01-01'), d('2026-01-10'));
    const b = interval(d('2026-01-10'), d('2026-01-20'));
    const c = interval(d('2026-01-05'), d('2026-01-15'));
    expect(intervalsOverlap(a, b)).toBe(false);
    expect(intervalsOverlap(a, c)).toBe(true);
    expect(intervalDurationMs(a)).toBe(9 * 24 * 3600 * 1000);
  });
});

describe('Bitemporal asOf', () => {
  type Lien = { id: string; validFrom: string; validTo?: string; recordedAt: string; supersededAt?: string };
  // A lien filed (valid) on Jan 5 that we only learned about (recorded) on Jan 20.
  const rows: Lien[] = [
    { id: 'lien-1', validFrom: d('2026-01-05'), recordedAt: d('2026-01-20') },
  ];
  it('is invisible when asked as-of a recorded time before we knew', () => {
    expect(asOf(rows, { valid: d('2026-01-10'), recorded: d('2026-01-15') })).toBeUndefined();
  });
  it('is visible once recorded, for valid times at or after validFrom', () => {
    expect(asOf(rows, { valid: d('2026-01-10'), recorded: d('2026-01-21') })?.id).toBe('lien-1');
    expect(asOf(rows, { valid: d('2026-01-04'), recorded: d('2026-01-21') })).toBeUndefined();
  });
  it('picks the latest-recorded row when several are valid', () => {
    const corrected = supersede(rows[0]!, d('2026-01-25'));
    const v2: Lien = { id: 'lien-1-v2', validFrom: d('2026-01-05'), recordedAt: d('2026-01-25') };
    expect(asOf([corrected, v2], { valid: d('2026-01-10'), recorded: d('2026-01-26') })?.id).toBe('lien-1-v2');
    expect(asOf([corrected, v2], { valid: d('2026-01-10'), recorded: d('2026-01-22') })?.id).toBe('lien-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test time`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/kernel/src/time.ts`:
```ts
import { z } from 'zod';
import { KernelError } from './errors';

// Zod 4 also offers z.iso.datetime(); z.string().datetime() is kept for the brand chain.
export const ISODateSchema = z.string().datetime({ offset: true }).brand<'ISODate'>();
export type ISODate = z.infer<typeof ISODateSchema>;

export function isoDate(input: Date | string): ISODate {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) throw new KernelError(`Invalid date: ${String(input)}`, 'INVALID_DATE');
  return ISODateSchema.parse(dt.toISOString());
}
export function nowIso(): ISODate {
  return isoDate(new Date());
}
export function toDate(iso: ISODate): Date {
  return new Date(iso);
}
function ms(iso: string): number {
  return new Date(iso).getTime();
}

export const IntervalSchema = z
  .object({ start: ISODateSchema, end: ISODateSchema.optional() })
  .refine((iv) => iv.end === undefined || ms(iv.start) < ms(iv.end), { message: 'start must be before end' });
export type Interval = z.infer<typeof IntervalSchema>;

export function interval(start: ISODate, end?: ISODate): Interval {
  return IntervalSchema.parse(end === undefined ? { start } : { start, end });
}
/** Half-open: start <= at < end. Open-ended when `end` is absent. */
export function intervalContains(iv: Interval, at: ISODate): boolean {
  const t = ms(at);
  return t >= ms(iv.start) && (iv.end === undefined || t < ms(iv.end));
}
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  const aEnd = a.end === undefined ? Number.POSITIVE_INFINITY : ms(a.end);
  const bEnd = b.end === undefined ? Number.POSITIVE_INFINITY : ms(b.end);
  return ms(a.start) < bEnd && ms(b.start) < aEnd;
}
export function intervalDurationMs(iv: Interval): number {
  if (iv.end === undefined) throw new KernelError('Open-ended interval has no duration', 'OPEN_INTERVAL');
  return ms(iv.end) - ms(iv.start);
}

/** Valid time = true in the world; record time = when we learned it. */
export const BitemporalSchema = z.object({
  validFrom: ISODateSchema,
  validTo: ISODateSchema.optional(),
  recordedAt: ISODateSchema,
  supersededAt: ISODateSchema.optional(),
});
export type Bitemporal = z.infer<typeof BitemporalSchema>;

/** Structural, unbranded form so plain rows from a store can be queried. */
export interface BitemporalLike {
  validFrom: string; validTo?: string; recordedAt: string; supersededAt?: string;
}

export interface AsOfOptions { valid: ISODate; recorded?: ISODate }

/**
 * The row that was true at `valid`, as known at `recorded` (default now).
 * Among candidates, the most recently recorded wins.
 */
export function asOf<T extends BitemporalLike>(rows: readonly T[], opts: AsOfOptions): T | undefined {
  const v = ms(opts.valid);
  const r = opts.recorded === undefined ? Date.now() : ms(opts.recorded);
  let best: T | undefined;
  for (const row of rows) {
    const known = ms(row.recordedAt) <= r && (row.supersededAt === undefined || ms(row.supersededAt) > r);
    const trueThen = ms(row.validFrom) <= v && (row.validTo === undefined || ms(row.validTo) > v);
    if (known && trueThen && (best === undefined || ms(row.recordedAt) > ms(best.recordedAt))) best = row;
  }
  return best;
}

export function supersede<T extends BitemporalLike>(row: T, at: ISODate): T {
  if (row.supersededAt !== undefined) throw new KernelError('Row already superseded', 'ALREADY_SUPERSEDED');
  return { ...row, supersededAt: at };
}
```

In `identifier.ts`, replace both `z.string().datetime().optional()` with `ISODateSchema.optional()` and import `ISODateSchema` from `./time`. The identifier test's `validFrom: '2024-01-01T00:00:00.000Z'` still parses (brand is compile-time only; use `isoDate(...)` in the test if TS complains about the brand).

Add `export * from './time';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: PASS, including the identifier suite after the swap.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add ISODate, half-open Interval, and bitemporal asOf query

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Provenance + Assertion

**Files:**
- Create: `packages/kernel/src/provenance.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/provenance.test.ts`

**Interfaces:**
- Consumes: `RefSchema`, `Ref` from `./ref`; `ISODateSchema`, `ISODate`, `nowIso` from `./time`.
- Produces: `SourceKind = 'human' | 'ai' | 'integration' | 'system'`, `Provenance = { source: { kind: SourceKind; ref?: Ref; name?: string }; method?: string; confidence?: number; recordedAt: ISODate; confirmedBy?: Ref; confirmedAt?: ISODate; evidence?: Ref[] }`, `ProvenanceSchema`, `provenance(source, opts?)`, `confirm(p, by, at?)`, `isConfirmed(p)`, `isTrusted(p, policy?)`.
- Produces: `AssertionStatus = 'proposed' | 'confirmed' | 'rejected' | 'superseded'`, `Assertion = { id: string; subject: Ref; predicate: string; object: unknown (JSON); provenance: Provenance; status: AssertionStatus; supersededBy?: string; decidedBy?: Ref; decidedAt?: ISODate }`, `AssertionSchema`, `assertion(...)`, `confirmAssertion`, `rejectAssertion`, `supersedeAssertion`, `AssertionStateError`.
- Rule (spec §4.6): `isTrusted` returns true for `human`/`system` sources, and for `ai`/`integration` only when confirmed or when `policy.minConfidence` is set and met.

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/__tests__/provenance.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ref } from '../ref';
import { isoDate } from '../time';
import {
  AssertionSchema, AssertionStateError, ProvenanceSchema, assertion, confirm, confirmAssertion,
  isConfirmed, isTrusted, provenance, rejectAssertion, supersedeAssertion,
} from '../provenance';

const t0 = isoDate('2026-01-01');
const examiner = ref('Party', 'examiner-1');

describe('Provenance', () => {
  it('records source and time; confidence is optional and bounded', () => {
    const p = provenance({ kind: 'ai', name: 'exam-engine' }, { confidence: 0.82, method: 'llm-extract', recordedAt: t0 });
    expect(p.recordedAt).toBe(t0);
    expect(ProvenanceSchema.safeParse({ ...p, confidence: 1.5 }).success).toBe(false);
  });
  it('confirm sets confirmedBy/At', () => {
    const p = confirm(provenance({ kind: 'ai' }, { recordedAt: t0 }), examiner, isoDate('2026-01-02'));
    expect(isConfirmed(p)).toBe(true);
    expect(p.confirmedBy).toEqual(examiner);
  });
  it('trust: human and system are trusted; ai only when confirmed or above policy threshold', () => {
    expect(isTrusted(provenance({ kind: 'human', ref: examiner }, { recordedAt: t0 }))).toBe(true);
    const ai = provenance({ kind: 'ai' }, { confidence: 0.9, recordedAt: t0 });
    expect(isTrusted(ai)).toBe(false);
    expect(isTrusted(ai, { minConfidence: 0.85 })).toBe(true);
    expect(isTrusted(confirm(ai, examiner))).toBe(true);
    expect(isTrusted(provenance({ kind: 'ai' }, { recordedAt: t0 }), { minConfidence: 0.5 })).toBe(false); // absent ≠ 1
  });
});

describe('Assertion', () => {
  const a = assertion({
    id: 'as-1', subject: ref('Property', 'p1'), predicate: 'hasLien',
    object: { instrument: '2026-000123', amount: { minor: 1250000, currency: 'USD' } },
    provenance: provenance({ kind: 'ai', name: 'exam-engine' }, { confidence: 0.82, recordedAt: t0 }),
  });
  it('starts proposed and is JSON-safe', () => {
    expect(a.status).toBe('proposed');
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(AssertionSchema.safeParse(a).success).toBe(true);
  });
  it('confirm and reject are terminal and record who decided', () => {
    const c = confirmAssertion(a, examiner, isoDate('2026-01-03'));
    expect(c.status).toBe('confirmed');
    expect(c.decidedBy).toEqual(examiner);
    expect(isTrusted(c.provenance)).toBe(true);
    expect(() => rejectAssertion(c, examiner)).toThrow(AssertionStateError);
    expect(rejectAssertion(a, examiner).status).toBe('rejected');
  });
  it('supersede links to the replacement', () => {
    const s = supersedeAssertion(a, 'as-2');
    expect(s.status).toBe('superseded');
    expect(s.supersededBy).toBe('as-2');
    expect(() => supersedeAssertion(s, 'as-3')).toThrow(AssertionStateError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test provenance`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/kernel/src/provenance.ts`:
```ts
import { z } from 'zod';
import { KernelError } from './errors';
import { RefSchema, type Ref } from './ref';
import { ISODateSchema, nowIso, type ISODate } from './time';

export const SourceKindSchema = z.enum(['human', 'ai', 'integration', 'system']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const ProvenanceSchema = z.object({
  source: z.object({ kind: SourceKindSchema, ref: RefSchema.optional(), name: z.string().min(1).optional() }),
  method: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  recordedAt: ISODateSchema,
  confirmedBy: RefSchema.optional(),
  confirmedAt: ISODateSchema.optional(),
  evidence: z.array(RefSchema).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ProvenanceSource = Provenance['source'];

export function provenance(
  source: ProvenanceSource,
  opts: Partial<Omit<Provenance, 'source'>> = {},
): Provenance {
  const { recordedAt, ...rest } = opts;
  return ProvenanceSchema.parse({ source, recordedAt: recordedAt ?? nowIso(), ...rest });
}

export function confirm(p: Provenance, by: Ref, at: ISODate = nowIso()): Provenance {
  return ProvenanceSchema.parse({ ...p, confirmedBy: by, confirmedAt: at });
}
export function isConfirmed(p: Provenance): boolean {
  return p.confirmedBy !== undefined;
}

export interface TrustPolicy { minConfidence?: number }

/** Human and system sources are trusted; ai/integration need confirmation or a met confidence floor. */
export function isTrusted(p: Provenance, policy: TrustPolicy = {}): boolean {
  if (p.source.kind === 'human' || p.source.kind === 'system') return true;
  if (isConfirmed(p)) return true;
  if (policy.minConfidence !== undefined && p.confidence !== undefined) return p.confidence >= policy.minConfidence;
  return false;
}

export const AssertionStatusSchema = z.enum(['proposed', 'confirmed', 'rejected', 'superseded']);
export type AssertionStatus = z.infer<typeof AssertionStatusSchema>;

export const AssertionSchema = z.object({
  id: z.string().min(1),
  subject: RefSchema,
  predicate: z.string().min(1),
  object: z.unknown(),
  provenance: ProvenanceSchema,
  status: AssertionStatusSchema,
  supersededBy: z.string().min(1).optional(),
  decidedBy: RefSchema.optional(),
  decidedAt: ISODateSchema.optional(),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export class AssertionStateError extends KernelError {
  constructor(from: AssertionStatus, to: AssertionStatus) {
    super(`Cannot move assertion from ${from} to ${to}`, 'ASSERTION_STATE');
  }
}

export function assertion(input: Omit<Assertion, 'status' | 'supersededBy' | 'decidedBy' | 'decidedAt'>): Assertion {
  return AssertionSchema.parse({ ...input, status: 'proposed' });
}

function requireProposed(a: Assertion, to: AssertionStatus): void {
  if (a.status !== 'proposed') throw new AssertionStateError(a.status, to);
}

export function confirmAssertion(a: Assertion, by: Ref, at: ISODate = nowIso()): Assertion {
  requireProposed(a, 'confirmed');
  return AssertionSchema.parse({ ...a, status: 'confirmed', decidedBy: by, decidedAt: at, provenance: confirm(a.provenance, by, at) });
}
export function rejectAssertion(a: Assertion, by: Ref, at: ISODate = nowIso()): Assertion {
  requireProposed(a, 'rejected');
  return AssertionSchema.parse({ ...a, status: 'rejected', decidedBy: by, decidedAt: at });
}
export function supersedeAssertion(a: Assertion, byAssertionId: string): Assertion {
  requireProposed(a, 'superseded');
  return AssertionSchema.parse({ ...a, status: 'superseded', supersededBy: byAssertionId });
}
```

Add `export * from './provenance';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add Provenance mixin and Assertion with proposed/confirmed/rejected/superseded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Lifecycle

**Files:**
- Create: `packages/kernel/src/lifecycle.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/lifecycle.test.ts`

**Interfaces:**
- Consumes: `RefSchema`, `ISODateSchema`, `nowIso`, `KernelError`.
- Produces: `LifecycleTransition<S> = { name: string; from: S | readonly S[]; to: S }`, `LifecycleDefinition<S> = { states: readonly S[]; initial: S; terminal: readonly S[]; transitions: readonly LifecycleTransition<S>[] }`, `defineLifecycle(def)` returning `Lifecycle<S>` with `can(from, to)`, `next(from): readonly LifecycleTransition<S>[]`, `assertTransition(from, to): LifecycleTransition<S>`, `isTerminal(s)`, `stateSchema` (Zod enum), `initialState(opts?)`, `transition(state, to, opts?)`; `LifecycleState<S> = { state: S; since: ISODate; reason?: string; by?: Ref }`; `IllegalTransitionError`, `InvalidLifecycleError` (thrown by `defineLifecycle` when transitions reference unknown states or terminal states have outgoing transitions).
- Note: this is a **declaration**. Execution (guards, side effects, history) belongs to `@de_canter/apogee-workflow-engine`, which will accept a `LifecycleDefinition` in a follow-on task there.

- [ ] **Step 1: Write the failing test**

`packages/kernel/src/__tests__/lifecycle.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ref } from '../ref';
import { isoDate } from '../time';
import { IllegalTransitionError, InvalidLifecycleError, defineLifecycle } from '../lifecycle';

const order = defineLifecycle({
  states: ['draft', 'open', 'on_hold', 'closed', 'cancelled'] as const,
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
  transitions: [
    { name: 'open', from: 'draft', to: 'open' },
    { name: 'hold', from: 'open', to: 'on_hold' },
    { name: 'resume', from: 'on_hold', to: 'open' },
    { name: 'close', from: 'open', to: 'closed' },
    { name: 'cancel', from: ['draft', 'open', 'on_hold'], to: 'cancelled' },
  ],
});

describe('Lifecycle', () => {
  it('answers what can happen next', () => {
    expect(order.next('open').map((t) => t.name)).toEqual(['hold', 'close', 'cancel']);
    expect(order.next('closed')).toEqual([]);
    expect(order.can('draft', 'open')).toBe(true);
    expect(order.can('draft', 'closed')).toBe(false);
    expect(order.isTerminal('cancelled')).toBe(true);
  });
  it('produces and advances LifecycleState with provenance of the change', () => {
    const s0 = order.initialState({ at: isoDate('2026-01-01') });
    expect(s0).toEqual({ state: 'draft', since: '2026-01-01T00:00:00.000Z' });
    const s1 = order.transition(s0, 'open', { at: isoDate('2026-01-02'), by: ref('Party', 'u1'), reason: 'intake complete' });
    expect(s1.state).toBe('open');
    expect(s1.by).toEqual({ kind: 'Party', id: 'u1' });
    expect(() => order.transition(s1, 'draft')).toThrow(IllegalTransitionError);
  });
  it('exposes a zod enum for the states', () => {
    expect(order.stateSchema.safeParse('open').success).toBe(true);
    expect(order.stateSchema.safeParse('nope').success).toBe(false);
  });
  it('rejects definitions with unknown states or outgoing transitions from terminal states', () => {
    expect(() => defineLifecycle({
      states: ['a', 'b'] as const, initial: 'a', terminal: ['b'],
      transitions: [{ name: 'x', from: 'a', to: 'c' as 'b' }],
    })).toThrow(InvalidLifecycleError);
    expect(() => defineLifecycle({
      states: ['a', 'b'] as const, initial: 'a', terminal: ['b'],
      transitions: [{ name: 'x', from: 'b', to: 'a' }],
    })).toThrow(InvalidLifecycleError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de_canter/apogee-kernel test lifecycle`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/kernel/src/lifecycle.ts`:
```ts
import { z } from 'zod';
import { KernelError } from './errors';
import { RefSchema, type Ref } from './ref';
import { ISODateSchema, nowIso, type ISODate } from './time';

export interface LifecycleTransition<S extends string> { name: string; from: S | readonly S[]; to: S }
export interface LifecycleDefinition<S extends string> {
  states: readonly S[];
  initial: S;
  terminal: readonly S[];
  transitions: readonly LifecycleTransition<S>[];
}

export const LifecycleStateSchema = z.object({
  state: z.string().min(1),
  since: ISODateSchema,
  reason: z.string().min(1).optional(),
  by: RefSchema.optional(),
});
export interface LifecycleState<S extends string> { state: S; since: ISODate; reason?: string; by?: Ref }

export interface TransitionOptions { at?: ISODate; by?: Ref; reason?: string }

export class InvalidLifecycleError extends KernelError {
  constructor(msg: string) { super(msg, 'INVALID_LIFECYCLE'); }
}
export class IllegalTransitionError extends KernelError {
  constructor(from: string, to: string) { super(`Illegal transition ${from} -> ${to}`, 'ILLEGAL_TRANSITION'); }
}

export interface Lifecycle<S extends string> {
  readonly definition: LifecycleDefinition<S>;
  readonly stateSchema: z.ZodType<S>;
  can(from: S, to: S): boolean;
  next(from: S): readonly LifecycleTransition<S>[];
  assertTransition(from: S, to: S): LifecycleTransition<S>;
  isTerminal(s: S): boolean;
  initialState(opts?: TransitionOptions): LifecycleState<S>;
  transition(current: LifecycleState<S>, to: S, opts?: TransitionOptions): LifecycleState<S>;
}

function froms<S extends string>(t: LifecycleTransition<S>): readonly S[] {
  return Array.isArray(t.from) ? (t.from as readonly S[]) : [t.from as S];
}

export function defineLifecycle<const S extends string>(def: LifecycleDefinition<S>): Lifecycle<S> {
  const known = new Set<string>(def.states);
  const terminal = new Set<string>(def.terminal);
  if (!known.has(def.initial)) throw new InvalidLifecycleError(`initial state ${def.initial} not in states`);
  for (const t of def.terminal) if (!known.has(t)) throw new InvalidLifecycleError(`terminal state ${t} not in states`);
  for (const t of def.transitions) {
    for (const f of froms(t)) {
      if (!known.has(f)) throw new InvalidLifecycleError(`transition ${t.name} from unknown state ${f}`);
      if (terminal.has(f)) throw new InvalidLifecycleError(`transition ${t.name} leaves terminal state ${f}`);
    }
    if (!known.has(t.to)) throw new InvalidLifecycleError(`transition ${t.name} to unknown state ${t.to}`);
  }
  const stateSchema = z.enum(def.states as unknown as [S, ...S[]]);

  const next = (from: S): readonly LifecycleTransition<S>[] => def.transitions.filter((t) => froms(t).includes(from));
  const can = (from: S, to: S): boolean => next(from).some((t) => t.to === to);
  const assertTransition = (from: S, to: S): LifecycleTransition<S> => {
    const t = next(from).find((x) => x.to === to);
    if (!t) throw new IllegalTransitionError(from, to);
    return t;
  };
  const stamp = <T extends object>(base: T, opts: TransitionOptions): T & { since: ISODate; reason?: string; by?: Ref } => ({
    ...base,
    since: opts.at ?? nowIso(),
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts.by !== undefined ? { by: opts.by } : {}),
  });

  return Object.freeze({
    definition: def,
    stateSchema,
    can,
    next,
    assertTransition,
    isTerminal: (s: S) => terminal.has(s),
    initialState: (opts: TransitionOptions = {}) => stamp({ state: def.initial }, opts),
    transition: (current: LifecycleState<S>, to: S, opts: TransitionOptions = {}) => {
      assertTransition(current.state, to);
      return stamp({ state: to }, opts);
    },
  });
}
```

Add `export * from './lifecycle';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: PASS. If `z.enum` complains about the tuple cast, use `z.enum([...def.states] as [S, ...S[]])`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add declarative Lifecycle with legal-transition checks and LifecycleState

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Role, Relationship, Classification

**Files:**
- Create: `packages/kernel/src/role.ts`, `packages/kernel/src/classification.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/src/__tests__/role.test.ts`, `packages/kernel/src/__tests__/classification.test.ts`

**Interfaces:**
- Consumes: `RefSchema`, `IntervalSchema`, `intervalContains`, `ProvenanceSchema`.
- Produces (`role.ts`): `Role = { party: Ref; context: Ref; roleType: string; interval?: Interval; provenance?: Provenance }`, `RoleSchema`, `role(party, context, roleType, opts?)`, `activeRoles(roles, at)`, `partiesInRole(roles, context, roleType, at?)`, `rolesOf(roles, party, at?)`.
- Produces (`role.ts`): `Relationship = { from: Ref; to: Ref; relationType: string; interval?: Interval; provenance?: Provenance }`, `RelationshipSchema`, `relationship(from, to, relationType, opts?)`, `activeRelationships(rels, at)`.
- Produces (`classification.ts`): `Classification = { taxonomy: string; code: string; label?: string; path?: string[] }`, `ClassificationSchema`, `ClassificationsSchema` (unique per taxonomy), `classify(taxonomy, code, opts?)`, `classificationIn(cls, taxonomy)`, `TagsSchema` (lowercase kebab, unique), `normalizeTag(raw)`.

- [ ] **Step 1: Write the failing tests**

`packages/kernel/src/__tests__/role.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ref } from '../ref';
import { interval, isoDate } from '../time';
import { activeRelationships, activeRoles, partiesInRole, relationship, role, rolesOf } from '../role';

const order = ref('Order', 'o1');
const alice = ref('Party', 'alice');
const bob = ref('Party', 'bob');
const jan = isoDate('2026-01-15');
const mar = isoDate('2026-03-15');

describe('Role', () => {
  const roles = [
    role(alice, order, 'buyer'),
    role(bob, order, 'buyer', { interval: interval(isoDate('2026-02-01')) }),
    role(bob, order, 'lender', { interval: interval(isoDate('2026-01-01'), isoDate('2026-02-01')) }),
  ];
  it('is a (party, context, roleType) triple, never an attribute on the party', () => {
    expect(roles[0]).toEqual({ party: alice, context: order, roleType: 'buyer' });
  });
  it('filters by time: roles without interval are always active', () => {
    expect(activeRoles(roles, jan).map((r) => `${r.party.id}:${r.roleType}`)).toEqual(['alice:buyer', 'bob:lender']);
    expect(activeRoles(roles, mar).map((r) => `${r.party.id}:${r.roleType}`)).toEqual(['alice:buyer', 'bob:buyer']);
  });
  it('queries parties in a role and roles of a party', () => {
    expect(partiesInRole(roles, order, 'buyer', mar).map((p) => p.id)).toEqual(['alice', 'bob']);
    expect(rolesOf(roles, bob, jan).map((r) => r.roleType)).toEqual(['lender']);
  });
});

describe('Relationship', () => {
  it('is directional with an optional interval', () => {
    const owns = relationship(alice, ref('Property', 'p1'), 'owns', { interval: interval(isoDate('2026-01-01'), isoDate('2026-03-01')) });
    expect(activeRelationships([owns], jan)).toHaveLength(1);
    expect(activeRelationships([owns], mar)).toHaveLength(0);
  });
});
```

`packages/kernel/src/__tests__/classification.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ClassificationsSchema, TagsSchema, classificationIn, classify, normalizeTag } from '../classification';

describe('Classification', () => {
  it('builds taxonomy/code with optional path', () => {
    const c = classify('property-type', 'sfr', { label: 'Single Family', path: ['residential', 'sfr'] });
    expect(c).toEqual({ taxonomy: 'property-type', code: 'sfr', label: 'Single Family', path: ['residential', 'sfr'] });
  });
  it('allows one classification per taxonomy', () => {
    expect(ClassificationsSchema.safeParse([classify('a', 'x'), classify('a', 'y')]).success).toBe(false);
    expect(ClassificationsSchema.safeParse([classify('a', 'x'), classify('b', 'y')]).success).toBe(true);
  });
  it('finds by taxonomy', () => {
    expect(classificationIn([classify('a', 'x')], 'a')?.code).toBe('x');
    expect(classificationIn([classify('a', 'x')], 'b')).toBeUndefined();
  });
});

describe('Tags', () => {
  it('normalizes to lowercase kebab and rejects duplicates', () => {
    expect(normalizeTag('  Rush Order ')).toBe('rush-order');
    expect(TagsSchema.safeParse(['rush', 'rush']).success).toBe(false);
    expect(TagsSchema.safeParse(['Rush']).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @de_canter/apogee-kernel test role classification`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packages/kernel/src/role.ts`:
```ts
import { z } from 'zod';
import { ProvenanceSchema } from './provenance';
import { RefSchema, sameRef, type Ref } from './ref';
import { IntervalSchema, intervalContains, type ISODate } from './time';

const temporal = { interval: IntervalSchema.optional(), provenance: ProvenanceSchema.optional() };

export const RoleSchema = z.object({ party: RefSchema, context: RefSchema, roleType: z.string().min(1), ...temporal });
export type Role = z.infer<typeof RoleSchema>;

export const RelationshipSchema = z.object({ from: RefSchema, to: RefSchema, relationType: z.string().min(1), ...temporal });
export type Relationship = z.infer<typeof RelationshipSchema>;

type TemporalOpts = Partial<Pick<Role, 'interval' | 'provenance'>>;

export function role(party: Ref, context: Ref, roleType: string, opts: TemporalOpts = {}): Role {
  return RoleSchema.parse({ party, context, roleType, ...opts });
}
export function relationship(from: Ref, to: Ref, relationType: string, opts: TemporalOpts = {}): Relationship {
  return RelationshipSchema.parse({ from, to, relationType, ...opts });
}

function isActive(x: { interval?: Role['interval'] }, at: ISODate): boolean {
  return x.interval === undefined || intervalContains(x.interval, at);
}

export function activeRoles(roles: readonly Role[], at: ISODate): Role[] {
  return roles.filter((r) => isActive(r, at));
}
export function partiesInRole(roles: readonly Role[], context: Ref, roleType: string, at?: ISODate): Ref[] {
  return roles
    .filter((r) => sameRef(r.context, context) && r.roleType === roleType && (at === undefined || isActive(r, at)))
    .map((r) => r.party);
}
export function rolesOf(roles: readonly Role[], party: Ref, at?: ISODate): Role[] {
  return roles.filter((r) => sameRef(r.party, party) && (at === undefined || isActive(r, at)));
}
export function activeRelationships(rels: readonly Relationship[], at: ISODate): Relationship[] {
  return rels.filter((r) => isActive(r, at));
}
```

`packages/kernel/src/classification.ts`:
```ts
import { z } from 'zod';

export const ClassificationSchema = z.object({
  taxonomy: z.string().min(1),
  code: z.string().min(1),
  label: z.string().min(1).optional(),
  path: z.array(z.string().min(1)).optional(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ClassificationsSchema = z.array(ClassificationSchema).refine(
  (cs) => new Set(cs.map((c) => c.taxonomy)).size === cs.length,
  { message: 'One classification per taxonomy' },
);

export function classify(taxonomy: string, code: string, opts: Partial<Pick<Classification, 'label' | 'path'>> = {}): Classification {
  return ClassificationSchema.parse({ taxonomy, code, ...opts });
}
export function classificationIn(cs: readonly Classification[], taxonomy: string): Classification | undefined {
  return cs.find((c) => c.taxonomy === taxonomy);
}

const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TagSchema = z.string().regex(TAG, 'Tags are lowercase kebab-case');
export const TagsSchema = z.array(TagSchema).refine((t) => new Set(t).size === t.length, { message: 'Duplicate tag' });

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
```

Add `export * from './role';` and `export * from './classification';` to `index.ts`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @de_canter/apogee-kernel test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(kernel): add Role triple, Relationship, Classification, and Tags

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Reference-domain acceptance tests, README, consumption spike, v0.1.0

This task proves the kernel against the domain that will be rewritten on it. It adds no new kernel surface; if a test cannot be written with the existing surface, that is a finding to fix in the earlier task, not a reason to widen this one.

**Files:**
- Create: `packages/kernel/src/__tests__/acceptance/proration.test.ts`, `gap-coverage.test.ts`, `identifiers.test.ts`
- Create: `packages/kernel/README.md`
- Modify: root `package.json` (add `"version"` bump script is not needed; tag manually)

**Interfaces:**
- Consumes: everything from Tasks 1 to 8 by the names given in their Interfaces blocks.

- [ ] **Step 1: Proration acceptance test**

`packages/kernel/src/__tests__/acceptance/proration.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { add, allocate, money, moneyFromDecimal, multiply, toDecimalString } from '../../money';
import { interval, intervalDurationMs, isoDate } from '../../time';

const DAY = 24 * 3600 * 1000;

describe('Settlement proration (Texas, 365-day, seller pays through day before closing)', () => {
  const annualTax = moneyFromDecimal('7300.00', 'USD');
  const closing = isoDate('2026-03-15');
  const yearStart = isoDate('2026-01-01');

  it('splits annual tax by days with no lost pennies', () => {
    const sellerDays = intervalDurationMs(interval(yearStart, closing)) / DAY; // 73 days
    expect(sellerDays).toBe(73);
    const sellerShare = multiply(annualTax, sellerDays / 365);
    expect(toDecimalString(sellerShare)).toBe('1460.00');
    const buyerShare = allocate(annualTax, [sellerDays, 365 - sellerDays])[1]!;
    expect(add(sellerShare, buyerShare)).toEqual(annualTax);
  });

  it('allocates a $1,001.00 fee 70/30 between two underwriters exactly', () => {
    const [primary, secondary] = allocate(money(100100, 'USD'), [70, 30]);
    expect(toDecimalString(primary!)).toBe('700.70');
    expect(toDecimalString(secondary!)).toBe('300.30');
  });
});
```

- [ ] **Step 2: Gap coverage acceptance test**

`packages/kernel/src/__tests__/acceptance/gap-coverage.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { asOf, isoDate } from '../../time';

type Instrument = { id: string; kind: 'deed' | 'lien'; validFrom: string; validTo?: string; recordedAt: string; supersededAt?: string };

describe('Gap coverage: what did we know at commitment vs at policy', () => {
  // Search ran Feb 1 with an effective date of Jan 28. A judgment lien was
  // recorded at the county on Jan 30 but did not appear in the index until Feb 5.
  const index: Instrument[] = [
    { id: 'deed-2019', kind: 'deed', validFrom: isoDate('2019-06-01'), recordedAt: isoDate('2019-06-03') },
    { id: 'lien-judgment', kind: 'lien', validFrom: isoDate('2026-01-30'), recordedAt: isoDate('2026-02-05') },
  ];
  const liens = index.filter((i) => i.kind === 'lien');

  it('the commitment (searched Feb 1) correctly shows no lien', () => {
    expect(asOf(liens, { valid: isoDate('2026-01-28'), recorded: isoDate('2026-02-01') })).toBeUndefined();
  });
  it('the bring-down (searched Mar 1, effective Feb 28) surfaces the lien', () => {
    expect(asOf(liens, { valid: isoDate('2026-02-28'), recorded: isoDate('2026-03-01') })?.id).toBe('lien-judgment');
  });
  it('a valid-time query before the lien attached never shows it, regardless of record time', () => {
    expect(asOf(liens, { valid: isoDate('2026-01-29'), recorded: isoDate('2099-01-01') })).toBeUndefined();
  });
});
```

- [ ] **Step 3: Identifiers acceptance test**

`packages/kernel/src/__tests__/acceptance/identifiers.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { IdentifiersSchema, findIdentifier, identifier, primaryIdentifier, registerScheme, resetSchemesForTest } from '../../identifier';

describe('One order, six identity systems', () => {
  beforeAll(() => {
    resetSchemesForTest();
    registerScheme({ code: 'order-number', label: 'GF / Order Number', normalize: (r) => r.trim().toUpperCase() });
    registerScheme({ code: 'loan-number', label: 'Lender Loan Number', normalize: (r) => r.replace(/\s/g, '') });
    registerScheme({ code: 'apn', label: 'Assessor Parcel Number', normalize: (r) => r.replace(/[-\s]/g, '') });
    registerScheme({ code: 'underwriter-file', label: 'Underwriter File Number', normalize: (r) => r.trim() });
    registerScheme({
      code: 'book-page', label: 'Recording Book/Page',
      normalize: (r) => { const [b, p] = r.split('/'); return `${(b ?? '').padStart(5, '0')}/${(p ?? '').padStart(4, '0')}`; },
      validate: (n) => /^\d{5}\/\d{4}$/.test(n),
    });
    registerScheme({ code: 'instrument-number', label: 'Instrument Number', normalize: (r) => r.trim() });
  });

  it('carries all of them, with the order number primary and none of them the PK', () => {
    const ids = [
      identifier('order-number', 'ord-2026-000417', { primary: true }),
      identifier('loan-number', '88 210 4471', { issuer: 'First National' }),
      identifier('apn', 'R-123456-01', { issuer: 'County Appraisal District' }),
      identifier('underwriter-file', 'UW-TX-99120', { issuer: 'Acme Underwriters' }),
      identifier('book-page', '123/45'),
      identifier('instrument-number', '2026-000998877'),
    ];
    expect(IdentifiersSchema.safeParse(ids).success).toBe(true);
    expect(primaryIdentifier(ids)?.value).toBe('ORD-2026-000417');
    expect(findIdentifier(ids, 'book-page')?.value).toBe('00123/0045');
    expect(findIdentifier(ids, 'apn')?.value).toBe('R12345601');
  });
});
```

- [ ] **Step 4: Run the whole suite with coverage**

Run: `pnpm --filter @de_canter/apogee-kernel exec vitest run --coverage`
Expected: all suites pass; line coverage on `src/*.ts` at or above 90%. If any acceptance test needed a helper that does not exist, add it to the owning task's file with its own unit test and commit it under that task's scope name.

- [ ] **Step 5: README**

`packages/kernel/README.md` (full content):
```markdown
# @de_canter/apogee-kernel

Shared domain vocabulary for Apogee products: value objects and mixins that
every product composes into its own concrete types. Zero persistence, zero
HTTP. Spec: `docs/design/kernel-ontology.md`.

## Phase 1 surface

| Concept | Import | One-liner |
|---|---|---|
| Ref | `ref, RefSchema, sameRef` | `{ kind, id }` typed reference |
| Money | `money, moneyFromDecimal, add, subtract, multiply, allocate, formatMoney` | integer minor units + ISO 4217; never a float |
| Quantity | `quantity, addQuantity, scaleQuantity, formatQuantity` | value + unit + precision |
| Identifier | `registerScheme, identifier, findIdentifier, primaryIdentifier` | many external IDs per object |
| Time | `isoDate, interval, intervalContains, asOf, supersede` | ISO strings, half-open intervals, bitemporal query |
| Provenance | `provenance, confirm, isTrusted` | who said so, how sure, who confirmed |
| Assertion | `assertion, confirmAssertion, rejectAssertion, supersedeAssertion` | AI/integration output enters as a proposal |
| Lifecycle | `defineLifecycle` | declared states and legal transitions |
| Role / Relationship | `role, partiesInRole, rolesOf, relationship` | (party, context, roleType) triple |
| Classification / Tags | `classify, classificationIn, normalizeTag` | taxonomy codes and tags |

## Rules

1. Abstract at the core, concrete at the edges: products declare named types
   that compose these; no universal object table.
2. Every stored shape is JSON-safe: ISO date strings, integer minor units.
3. The kernel declares lifecycles; `@de_canter/apogee-workflow-engine` executes them.
4. An `ai` or `integration` provenance is not trusted until confirmed or above
   a caller-supplied confidence floor.

## Consuming from another repo

```jsonc
// package.json in the consuming repo
"dependencies": { "@de_canter/apogee-kernel": "github:de-canter/apogee#kernel-v0.1.0&path:packages/kernel" }
```
`pnpm install` builds it via `prepare`. See Step 6 in the Phase 1 plan for the
fallback if `#path:` is unavailable in the consumer's pnpm.
```

- [ ] **Step 6: Consumption spike**

Add to `packages/kernel/package.json` scripts: `"prepare": "tsup"` so a git consumer builds `dist/` on install. Then, in the scratchpad (not in either repo):

```bash
mkdir -p "$SCRATCH/kernel-consumer" && cd "$SCRATCH/kernel-consumer"
printf '%s' '{"name":"kernel-consumer","private":true,"type":"commonjs","dependencies":{"@de_canter/apogee-kernel":"github:de-canter/apogee#feature/kernel-primitives&path:packages/kernel"}}' > package.json
pnpm install
node -e "const k=require('@de_canter/apogee-kernel'); console.log(k.formatMoney(k.money(123456,'USD')))"
```
Expected: prints `$1,234.56` from the CJS build. (Verified 2026-09-17 with pnpm 9.15.9: the ref must come before `&path:`; `#path:...&branch=...` is rejected.) If pnpm rejects `#path:`, the fallback is a `pnpm pack` tarball attached to the GitHub release (`kernel-v0.1.0`) and a `https://github.com/de-canter/apogee/releases/download/kernel-v0.1.0/apogee-kernel-0.1.0.tgz` dependency; record which mechanism worked in the README's "Consuming" section before Step 8.

- [ ] **Step 7: Commit acceptance tests and README**

```bash
git add -A
git commit -m "test(kernel): reference-domain acceptance tests (proration, gap coverage, identifiers) + README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: Push the topic branch, open the PR, tag after merge**

```bash
git push -u origin feature/kernel-primitives
gh pr create --repo de-canter/apogee --base main --title "feat(kernel): @de_canter/apogee-kernel Phase 1 primitives" --body-file docs/plans/2026-09-17-apogee-kernel-primitives.md
```
After merge (human): `git tag kernel-v0.1.0 && git push origin kernel-v0.1.0`. Then move this plan to `docs/plans/completed/` with a one-paragraph outcome note at the top.

---

## Self-review against the spec

- **Spec coverage:** §4.1 Ref → Task 1. §4.2 Money → Task 2. §4.3 Quantity → Task 3. §4.4 Identifier → Task 4. §4.5 Time → Task 5. §4.6 Provenance/Assertion → Task 6. §4.7 Lifecycle → Task 7. §4.8 Role/Relationship/Classification → Task 8. §7 questions "when did we find out / as of when is it true / how much / which one" → Task 9 acceptance tests. §5 and §6 are explicitly separate plans.
- **Out of Phase 1 by design:** Version/Amendment mixin, Fulfillment, Permission, Rule/Policy hook shape, Communication. These need the entity categories first and are in the Phase 2 plan.
- **Type consistency:** `ISODate` brand is introduced in Task 5 and back-applied to Task 4; `KernelError` lives in `errors.ts` created in Task 2 and consumed by Tasks 3 to 7; `Ref`/`RefSchema` from Task 1 are consumed by Tasks 6 to 8 with those exact names.

## Follow-on plans (to be written when this ships)

1. `docs/plans/<date>-apogee-kernel-entities.md` — Phase 2 entity categories, `extendEntity`, Versioned mixin, Fulfillment, Permission, Rule hook shape.
2. `docs/plans/<date>-apogee-kernel-mongoose.md` — `@de_canter/apogee-kernel-mongoose` sub-schemas and discriminator bases.
3. `docs/plans/<date>-workflow-engine-lifecycle.md` — `StateMachine` accepts a kernel `LifecycleDefinition`.
4. In the reference product's repo: the clean-room rewrite plan, gated on 1 to 3 being merged and tagged.
