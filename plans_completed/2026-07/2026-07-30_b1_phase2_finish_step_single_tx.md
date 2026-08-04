# B1 phase-2: finish-step single projectTransaction

**Status:** completed (2026-07-30)

Framework: ADID 15.4.3. Residual of C2 `055c6da` B1: API consolidation shipped,
but **SQLite transaction count was ~3** because each `SyncEvent.run` opened
its own `Database.projectTransaction`. Phase-2: `SyncEvent.runBatch` + cost `after(tx)`.

**Full process graph:** [`docs/finish-step-tx-graph.md`](../docs/finish-step-tx-graph.md)

## SVM: Vector summary

Semantic vector: `["atomic finish-step", "multi-event SyncEvent batch", "CQRS preservation"]`
with weights `[0.45, 0.35, 0.20]`.

Information Mark: **Exact** for current multi-TX reality (source inspection of
`session.finishStep` + `sync/index.ts` `run`); **Inferred** for −latency claim
until wall-clock oracle.

## 1. Goal and scope

**Goal**: Make `Session.finishStep` apply **step-finish PartUpdated + Message.Updated
+ session cost/token accumulation** inside **one** `Database.projectTransaction`
(or equivalent single TX), preserving projector order, event sequence numbering,
and bus publish semantics.

**Scope**:
- `packages/opencode/src/sync/index.ts` — multi-event batch API
- `packages/opencode/src/session/session.ts` — `finishStep` consumer
- tests: `test/session/finish-step.test.ts` (extend with TX-count / atomicity oracle)

**Non-goals**:
- Do NOT change text-delta bus-only path
- Do NOT fold optional patch / summary updates into the same TX (still optional after)
- Do NOT rewrite projectors
- Do NOT break event `seq` monotonicity per aggregate

## 2. Current state (Exact)

```typescript
// session.finishStep today
yield* Effect.sync(() => {
  SyncEvent.run(MessageV2.Event.PartUpdated, { ... }) // TX #1
  SyncEvent.run(MessageV2.Event.Updated, { ... })     // TX #2
})
yield* Effect.sync(() =>
  Database.use((db) => db.update(SessionTable)...)    // TX #3
)
```

Each `SyncEvent.run` → `Database.projectTransaction` → `applyProjectEvent`.

## 3. Exact materialized transition

### T1: Add `SyncEvent.runBatch`

```typescript
export function runBatch(
  items: Array<{ def: Definition; data: Event["data"] }>,
  options?: { publish?: boolean },
): void
```

Semantics:
1. Resolve project from first event's aggregate (all items same session).
2. One `projectTransaction`.
3. For each item: allocate EventID, next seq, `applyProjectEvent`.
4. Reject mixed aggregates.

### T2: Route cost update through projector or same TX

Preferred: extend batch body to also run the SessionTable cost/token `UPDATE`
on the **same** `tx` after the two events (still not a SyncEvent if cost stays
direct SQL — but **same TX** removes torn state).

Alternative (stricter CQRS): new SyncEvent `session.usage_delta` with projector —
only if existing Session events cannot carry deltas cleanly.

### T3: Oracles

| # | Oracle | Pass |
|---|--------|------|
| O1 | Unit: two events + cost visible atomically | fail mid-projector leaves none (or full rollback) |
| O2 | `finish-step.test.ts` existing cases still pass | Exact |
| O3 | Instrument TX opens on finish-step path → count === 1 for core batch | Exact log/counter |
| O4 | `bun typecheck` | pass |

## 4. Smoke Tests (PRE_FLIGHT)

### Baseline [Exact] (2026-07-30 pre-impl)

| # | Command | Actual |
|---|---------|--------|
| 1 | `bun test test/session/finish-step.test.ts` from `packages/opencode` | **4 pass, 0 fail** |
| 2 | `bun typecheck` from `packages/opencode` | **pass** |

### Post-impl [Exact]

| # | Command | Actual |
|---|---------|--------|
| 1 | `bun test test/session/finish-step.test.ts` | **5 pass, 0 fail** (atomic batch case added) |
| 2 | `bun typecheck` | **pass** |

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation after baseline (`SyncEvent.runBatch` + finishStep `after` cost)
- [x] Post-impl smoke passed

## 5. Claim ledger

| Claim | Mark | Evidence |
|-------|------|----------|
| finishStep uses 3 TX today | Exact | session.ts finishStep + sync run |
| API consolidation alone is not TX consolidation | Exact | C2 analysis |
| runBatch preserves seq order | Hypothetical | until implemented |
| Single TX reduces step latency | Inferred | fewer fsync/lock rounds |

## 6. Dependency

Follows completed B1 phase-1 (`plans_completed/2026-07-29-session-processor-tx-consolidation.md`).
Independent of B3/B5/B6.
