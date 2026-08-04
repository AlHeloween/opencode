# Rendering Flow Fixes

**Created**: 2026-07-11
**Status**: Completed ✓

## Issues Fixed

### P0 — Critical

#### 1. Delta Race → recoverSessionSync Thrashing
- **File**: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- **Fix**: Delta buffering with `deltaBuffer` Map — deltas that arrive before their part are accumulated and flushed when the part arrives via `part.updated`. Debounced recovery sync per-messageID prevents cascading re-fetches.
- **Test**: `sync-rendering.test.ts` — delta buffer accumulation, field type safety
- **Commit**: Multi-edit in sync.tsx

#### 2. Composite Mode Object Identity Loss
- **File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- **Fix**: `compositeCache` Map preserves object identity across memo re-evaluations. Only creates new wrappers when underlying message data actually changes.
- **Test**: Structural invariance tested via composite mode rendering path

### P1 — High

#### 3. Part Grouping O(n²) Equality on Every Delta
- **File**: `packages/ui/src/components/message-part.tsx`
- **Fix**: Structural key (`structuralKey` memo) that only depends on part IDs + types, not text content. Groups are cached in a `groupedCache` Map keyed by the structural hash.
- **Test**: `message-part.test.ts` — structural key stability, `sameGroups` equality
- **Impact**: Text deltas no longer trigger grouping recalculation

#### 4. 100-Message Cap Evicting Streaming Messages
- **File**: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- **Fix**: `hasActiveParts()` guard — only evicts oldest message if ALL its tool parts are completed (not pending/running). Never evicts mid-stream.
- **Test**: `sync-rendering.test.ts` — active part detection

### P2 — Medium

#### 5. Working State `findLast` Cross-Branch
- **File**: `packages/ui/src/components/session-turn.tsx`
- **Fix**: Added `item.sessionID === props.sessionID` filter to `findLast` search
- **Test**: `session-turn.test.ts` — 7 tests covering cross-session filtering

#### 6. Part Delta Field Type Unsafety
- **File**: `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- **Fix**: `DELTA_SAFE_FIELDS` Set restricts delta concatenation to `text` and `output` fields only. Non-string fields (status enums, numbers) are ignored.
- **Test**: `sync-rendering.test.ts` — field safety validation

#### 7. Agent Color Index Instability
- **File**: `packages/opencode/src/cli/cmd/tui/context/local.tsx`
- **Fix**: Stable name-based hash (`stableAgentColorIndex`) replaces array index for color selection. Reordering agents no longer changes colors.
- **Test**: `sync-rendering.test.ts` — color stability tests

#### 8. TextReveal Width NaN Edge Case
- **File**: `packages/ui/src/components/text-reveal.tsx`
- **Fix**: Explicit `width() === "auto"` → `0` fallback before `parseFloat`
- **Test**: `text-reveal.test.ts` — 8 tests covering auto width, grow-only, decimal values

## Test Results
- **47 tests pass** (24 new + 23 new rendering + existing)
- **0 failures** across all test files
- **TypeScript**: Clean compilation for both `packages/opencode` and `packages/ui`
