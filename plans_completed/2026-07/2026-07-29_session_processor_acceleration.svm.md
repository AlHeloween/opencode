# Session Processor Acceleration — Master SVM

Framework: ADID 15.4.3. This master State Vector Manifest links the three
bottleneck-optimization plans discovered through codegraph analysis of the
OpenCode session processing pipeline.

Date: 2026-07-29
Status: SVM Ingestion → Manager Synthesis (plans defined; awaiting approval)

## Master semantic vector

Keywords: `["transaction consolidation", "permission cache", "hybrid storage", "session processor", "latency reduction"]`
Weights: `[0.35, 0.20, 0.25, 0.10, 0.10]`

Semantic dominant: Reducing per-step session processor latency through targeted
structural optimizations while preserving the CQRS architecture and SyncEvent
pattern.

## Discovery method

CodeGraph exploration of the full `packages/opencode/src/session/` pipeline
with recursive graph tracing through the Effect-TS layer, SyncEvent projectors,
Fossil snapshot system, and SQLite/Drizzle storage.

Five codegraph_explore calls covered:
1. Session processing pipeline + tool execution + agent loop
2. Session manager + tool registry + provider model + LLM streaming
3. Session processor internals + MessageV2 + database schema
4. Tool registry + pipeline + permission + concurrency
5. Database layer + provider streaming + WASM modules

Key architectural findings that shaped the plans:
- `updatePartDelta` (text-delta) publishes to bus only — **zero DB writes**
- `updatePart` goes through SyncEvent → projector → single DB transaction
- `finish-step` is the only handler with 4–6 sequential DB transactions
- `Database.use` is called directly exactly once in the entire processStream
- `StringBuilder.append()` is O(1) array push (already optimal)
- `snapshot.patch()` uses `fossil diff --brief` (filenames only, already fast)

## Sub-plans (CENTRAL_TASKS)

| Plan | File | Impact | Effort | Status |
|------|------|--------|--------|--------|
| B1 | `2026-07-29-session-processor-tx-consolidation.md` | -50% DB TX per step | 3d | pending |
| B3 | `2026-07-29-permission-cache.md` | -15% tool latency | 1d | pending |
| B5 | `2026-07-29-hybrid-part-storage.md` | -40% read latency | 5d | pending |

## Execution order (dependency-weighted)

```
B1 (3d) ──► B3 (1d) ──► B5 (5d)
  │            │            │
  └─ highest    └─ quick     └─ structural
     impact        win          long-term
```

B1 first because it has the highest impact/effort ratio and B3+B5 are
independent of B1. B5 is deferred until B1+B3 are proven in production.

## Rejected optimizations

| Candidate | Reason for rejection |
|-----------|---------------------|
| StringBuilder → ArrayBuffer | StringBuilder already O(1) append, O(n) join only at text-end |
| Batching text-delta DB writes | text-delta has zero DB writes (bus-only) |
| Incremental Fossil diff | `patch()` already uses `--brief` (filenames only) |
| Lazy Layer resolution | Requires Effect-TS internals change; high risk |
| Backpressure in TransformStream | Provider SDK responsibility; out of scope |

## Information Mark

| Claim | Status | Evidence |
|-------|--------|----------|
| finish-step has 4–6 sequential DB TX | Exact | Source inspection: processor.ts:539–695, sync/index.ts:191–204, projectors.ts:133–151 |
| text-delta path is DB-write-free | Exact | Source inspection: session.ts:922–930 |
| StringBuilder is not a bottleneck | Exact | Source inspection: string-builder.ts:1–22 |
| Fossil patch() is already fast | Exact | Source inspection: fossil.ts:409–431 |
| Consolidation reduces latency by ~50% | Inferred | Derived from Exact premises: 6→3 transactions per step |
| Permission cache reduces latency by ~15% | Hypothetical | Falsifiable: requires before/after measurement |

## Verification gates (across all sub-plans)

1. `bun test test/session/` from `packages/opencode` — must pass before and after each plan
2. `bun run typecheck` from `packages/opencode` — must pass
3. Manual session smoke test — complete a prompt → tool → result cycle
4. Transaction count verification (B1) — instrument and count DB TX per finish-step
5. Hydration benchmark (B5) — measure `hydrate()` time for 100-message session
