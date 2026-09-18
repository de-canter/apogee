# Apogee Kernel — Domain Ontology

**Status:** Design spec (source of truth for `@apogee/kernel`)
**Created:** 2026-09-17
**Owner:** Jeff Canter
**Origin:** Shower-thought conversation 2026-09-17; lineage in §8.

## 1. Purpose

Every Verve product (the reference product, The Somm, NailNotes, MacMethod, and those
not yet named) re-derives the same dozen concepts and re-makes the same
modeling mistakes: money as a float, status as a free string, role as an
attribute on a person, one identifier column when the outside world has six.

`@apogee/kernel` fixes the vocabulary once. It is the shared set of
**value objects**, **mixins**, and **entity categories** that every product
composes into its own concrete types. Product-specific behavior lives in
Rule/Policy and Lifecycle transitions (the Behavior Engine), not in bespoke
schema shapes.

The kernel is being built to be **right and tested first**. the reference product will
be clean-room rewritten on top of it once it is, not migrated incrementally.
the reference product's domain is therefore the kernel's acceptance test suite, not its
first customer.

## 2. Layering rule (the one that prevents the inner-platform effect)

```
┌──────────────────────────────────────────────────────────┐
│  Product (the reference product, The Somm, ...)                     │
│  Concrete named types: Order, Property, Bottle, Tasting   │
│  Product rules, lifecycles, role types, identifier schemes│
├──────────────────────────────────────────────────────────┤
│  @apogee/kernel — entity categories (Phase 2)             │
│  Party, Place, Resource, Document, Event, Activity,       │
│  Commitment, Transaction, Relationship, Communication     │
├──────────────────────────────────────────────────────────┤
│  @apogee/kernel — value objects & mixins (Phase 1)        │
│  Ref, Money, Quantity, Identifier, Interval, Bitemporal,  │
│  Provenance, Assertion, Lifecycle, Role, Classification   │
└──────────────────────────────────────────────────────────┘
```

- **Abstract at the core, concrete at the edges.** A product declares
  `Order = Commitment.extend({...})` with typed fields. There is never a
  universal `objects` collection with a `kind` column and never a runtime
  interpreter for screens.
- **The kernel has no persistence opinion.** It exports Zod schemas, TS
  types, and pure functions. Mongoose/Prisma adapters are separate packages
  (`@apogee/kernel-mongoose`), built after the kernel is stable.
- **Every kernel type is JSON-safe.** No `bigint`, no class instances, no
  `Date` in stored shapes unless declared (see §4.5). What goes in a document
  store must round-trip through `JSON.parse(JSON.stringify(x))` unchanged.

## 3. The categories

### 3.1 Nouns (things that persist)

| Category | Answers | Notes |
|---|---|---|
| **Party** | Who | Person, organization, system/bot. One category, not three. Differences are attributes and classifications, never subclasses. |
| **Place** | Where | Three flavors, never conflated: *physical* (address, geo point), *logical* (bin 4A, escrow account, folder), *virtual* (URL, channel, queue). |
| **Resource** | What | **Three tiers**: *Type* (Merlot; ALTA Owner's 2021), *Offering* (2019 Duckhorn 750ml at $34; this underwriter's rate for this state on this date), *Instance* (the bottle on the rack; the issued policy). Collapsing Type/Instance causes half of all data-model pain; collapsing Offering causes most pricing pain. |
| **Document** | Evidence | Behaves differently from Resource: versions, signatures, redlines, provenance, attachments. |
| **Money** | How much (value) | Never a float. See §4.2. |

### 3.2 Verbs (things that happen)

| Category | Answers | Notes |
|---|---|---|
| **Event** | What happened, when | Past tense, immutable, append-only. A recorded deed is an Event. |
| **Activity** | What is being done | Task, job, case, workflow run. Has owner, due date, lifecycle. |
| **Commitment** | What was promised | Order, reservation, appointment, contract, quote. Reciprocal (my promise paired with yours = agreement). Linked to the Events that satisfy it by **Fulfillment**. |
| **Transaction** | Transfer of value or custody | Always two sides. Disbursement, wire, conveyance. |

### 3.3 Connective tissue (where business logic actually lives)

| Category | Answers | Notes |
|---|---|---|
| **Role** | In what capacity | Triple `(party, context, roleType)` with an interval. Never an attribute on the person. |
| **Relationship** | How things relate | party↔party, thing↔thing, party↔thing. Ownership, custody, membership, hierarchy, succession. |
| **Lifecycle** | What state, what next | Status plus declared legal transitions. Free-string status means no model. |
| **Rule/Policy** | Why allowed | Eligibility, pricing, validation, SLA. Owned by the Behavior Engine; kernel defines the hook shape only. |
| **Permission** | Who may do what | Party × action × target × condition. |
| **Classification** | What kind | Taxonomy + tags. The escape valve against subclass explosion. |
| **Identifier** | Which one, externally | Always plural. One object, many identity systems, none of them the PK. |
| **Quantity** | How much (measure) | Number + unit + precision. Same discipline as Money. |
| **Time** | When | Intervals, recurrence, bitemporality (valid time vs recorded time). |
| **Communication** | What was said | Messages, threads, notifications, correspondence of record. |

### 3.4 Additions over the original list

These are not in the classic Fowler/Silverston set and are required by
AI-native products:

- **Provenance** (cross-cutting mixin, on every object): source kind
  (`human | ai | integration | system`), source ref, method, confidence,
  recorded-at, confirmed-by/at, evidence refs.
- **Assertion**: a statement from a source that may or may not be true.
  `(subject, predicate, object, provenance, status)` with
  `proposed → confirmed | rejected | superseded`. Not an Event (may be false),
  not a Document (that is the carrier). This is how AI output enters the
  system: as a proposed Assertion a human ratifies.
- **Fulfillment**: first-class link from a Commitment to the Events that
  satisfy it, with the fulfilled Quantity/Money. Answers "what did we promise
  vs what did we do" as a query.
- **Version / Amendment**: promoted from the questions table to a mixin.
  Amended commitments, revised settlement statements, corrected deeds.

## 4. Phase 1 value objects — decisions locked

### 4.1 `Ref`
`{ kind: string; id: string }`. Typed reference to any entity. `kind` is the
product's concrete type name (`'Order'`), not the kernel category.

### 4.2 `Money`
`{ minor: number; currency: string }`. Integer minor units (cents for USD),
ISO 4217 currency code, scale derived from a currency table. Safe to
`2^53` minor units (USD 90 trillion). JSON- and Mongo-safe.
Operations: `add`, `subtract`, `multiply(ratio, rounding)`, `compare`,
`allocate(parts | weights)` using largest-remainder so pennies never vanish,
`format`. Rounding modes: `HALF_UP` (default; settlement convention),
`HALF_EVEN`, `DOWN`, `UP`. Mixed-currency arithmetic throws.

### 4.3 `Quantity`
`{ value: number; unit: string; precision: number }`. `precision` is the
number of decimal places the value is meaningful to. Unit codes come from a
registry (`acre`, `sqft`, `sqm`, `each`, `percent`, `bp`). Same rounding
modes as Money. Unit conversion is out of scope for Phase 1.

### 4.4 `Identifier`
`{ scheme: string; value: string; issuer?: string; primary?: boolean; validFrom?: ISODate; validTo?: ISODate }`.
Entities carry `identifiers: Identifier[]`. Schemes are registered per
product with a normalizer (e.g. APN strips dashes, book/page zero-pads).
Helpers: `find(ids, scheme)`, `primary(ids)`, `normalize(scheme, value)`.

### 4.5 Time
- Dates in stored shapes are **ISO 8601 strings** (`ISODate` branded type),
  not `Date` objects, so every shape is JSON-safe. Helpers convert.
- `Interval`: `{ start: ISODate; end?: ISODate }`, half-open `[start, end)`,
  `end` absent means open-ended. `contains`, `overlaps`, `duration`.
- `Bitemporal`: `{ validFrom: ISODate; validTo?: ISODate; recordedAt: ISODate; supersededAt?: ISODate }`.
  Valid time = when it was true in the world. Record time = when we learned.
- `asOf(rows, { valid, recorded })` selects the row that was true at `valid`
  as known at `recorded`. This is the gap-coverage query.

### 4.6 `Provenance` and `Assertion`
See §3.4. `confidence` is `0..1` or absent (absent ≠ 1). An `Assertion`
whose provenance is `ai` with no `confirmedBy` is never treated as fact by
default; products opt in per predicate.

### 4.7 `Lifecycle`
`defineLifecycle({ states, initial, terminal, transitions })` returns a
frozen definition with `can(from, to)`, `next(from)`, `assertTransition(from, to)`,
and the `LifecycleState<S>` shape `{ state: S; since: ISODate; reason?: string; by?: Ref }`.
The kernel **declares**; `@apogee/workflow-engine` **executes**. The
workflow-engine `StateMachine` will accept a kernel `LifecycleDefinition`
in a later task; the kernel does not depend on workflow-engine.

### 4.8 `Role`, `Relationship`, `Classification`
- `Role`: `{ party: Ref; context: Ref; roleType: string; interval?: Interval; provenance?: Provenance }`.
- `Relationship`: `{ from: Ref; to: Ref; relationType: string; interval?: Interval; provenance?: Provenance }`.
- `Classification`: `{ taxonomy: string; code: string; label?: string; path?: string[] }`; entities also carry `tags: string[]`.

## 5. Phase 2 entity categories (separate plan)

Base Zod shapes for Party, Place, Resource (Type/Offering/Instance),
Document, Event, Activity, Commitment + Fulfillment, Transaction,
Relationship, Communication, plus `extendEntity()` composition and the
`Versioned` mixin. Planned in `docs/plans/<date>-apogee-kernel-entities.md`
once Phase 1 ships at v0.1.0.

## 6. Phase 3 persistence and adoption (separate plans)

- `@apogee/kernel-mongoose`: Mongoose sub-schemas for every value object and
  discriminator-per-category base schemas.
- the reference product clean-room rewrite plan (lives in the the reference product repo).

## 7. The questions table (acceptance criteria for "is the model complete")

| Question | Kernel object that must answer it |
|---|---|
| Who? | Party |
| In what capacity? | Role |
| Says who? On whose authority? | Provenance, Permission |
| What? | Resource (Type / Offering / Instance) |
| Which one, specifically? | Identifier |
| Where? | Place (physical / logical / virtual) |
| When did it happen? | Event |
| When did we find out? | Bitemporal `recordedAt` |
| As of when is it true? | Bitemporal `validFrom/validTo`, `asOf` |
| How much? | Money, Quantity |
| Why is it allowed? | Rule/Policy |
| What state is it in? | Lifecycle |
| What can happen next? | `Lifecycle.next()` |
| What did we promise? | Commitment |
| What did we deliver against it? | Fulfillment |
| How do we know? | Assertion, Document |
| Who changed it, and why? | Provenance + Event (audit) |
| What if it changes later? | Version / Amendment |

## 8. Lineage

Fowler, *Analysis Patterns* (Party, Accountability, Quantity, Money,
Observation). Silverston, *The Data Model Resource Book* Vol. 1 (Party Role,
Party Relationship, Product vs Inventory Item). McCarthy, REA ontology
(Resource, Event, Agent, Commitment, Fulfillment). Snodgrass, *Developing
Time-Oriented Database Applications* (bitemporal). What is new here is
Provenance/Assertion as first-class, and the layering rule in §2 as a hard
constraint rather than advice.

## 9. Non-goals

- No ORM, no persistence, no HTTP in the kernel.
- No unit conversion, no FX conversion in Phase 1.
- No universal object table, no EAV, no runtime-interpreted screens.
- No incremental the reference product migration; adoption is a clean-room rewrite.
