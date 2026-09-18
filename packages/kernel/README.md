# @apogee/kernel

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
3. The kernel declares lifecycles; `@apogee/workflow-engine` executes them.
4. An `ai` or `integration` provenance is not trusted until confirmed or above
   a caller-supplied confidence floor.

## Consuming from another repo

```jsonc
// package.json in the consuming repo
"dependencies": { "@apogee/kernel": "github:de-canter/apogee#kernel-v0.1.0&path:packages/kernel" }
```
The ref (tag, branch, or sha) comes first, then `&path:`. `pnpm install`
builds `dist/` via the `prepare` script. Verified with pnpm 9.15.9 from a
CommonJS consumer (`require('@apogee/kernel')`).
