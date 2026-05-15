# Performance & Correctness Fixes from Research Report

Based on `research/research_v2.md`.

## Scope

Fix the top 5 high-impact, low-to-medium effort issues identified in the research report. Patches for items 1-3 are already drafted in the report.

## Items

### 1. Fix `health-window.ts` off-by-one + error-decay merge

**File:** `packages/opencode/src/provider/gateway/health-window.ts`
**Severity:** Critical
**Effort:** Small

**Problems:**
- `CircularBuffer.toArray()` at line 43 reads from `(head - count + 1 + i)` instead of `(head - count + i)` — off-by-one reads stale data
- `DelayBuffer.toArray()` at line 85 has the same off-by-one
- `recordError()` at lines 192-200: computes decayed counts then immediately spreads `window.errorCounts` back on top (line 199), undoing the decay. The line `errorCounts = { ...errorCounts, ...window.errorCounts }` must be removed.

**Fix:** Apply the diff from the report (section lines 115-137):
1. Change `(head - count + 1 + i)` to `(head - count + i)` in both `CircularBuffer.toArray()` and `DelayBuffer.toArray()`
2. Remove the line `errorCounts = { ...errorCounts, ...window.errorCounts }` from `recordError()`

### 2. Remove search-path N+1 query

**File:** `packages/opencode/src/session/message-v2.ts`
**Severity:** High
**Effort:** Medium

**Problem:** The `search()` function (line 1267) runs a FTS query then issues an additional `SELECT COUNT(*) + 1` query per result row (line 1310) to compute `messageIndex`. This is a classic N+1 pattern.

**Fix:** Compute message position in a single SQL query using a CTE with a self-join approach (SQLite may not support `ROW_NUMBER()`). Replace the per-row `COUNT(*)` subqueries with a CTE that precomputes all message positions and joins into the main FTS query.

### 3. Evict stale route records from `state.data.routes`

**File:** `packages/opencode/src/provider/gateway/store.ts`
**Severity:** High
**Effort:** Small

**Problem:** `evictStaleEntries()` (line 73) clears health windows, access timestamps, circuit breakers, and retry budgets, but never evicts from `state.data.routes`. Route metadata can grow unbounded even with `MAX_ROUTES = 500`.

**Fix:** Add route record eviction to `evictStaleEntries()`. Remove stale keys from `state.data.routes` using the same staleness threshold.

### 4. Resolve real paths before permission boundary check

**File:** `packages/opencode/src/tool/external-directory.ts`
**Severity:** High security
**Effort:** Small

**Problem:** `assertExternalDirectoryEffect()` (line 27) checks `Instance.containsPath(full, ins)` on the lexical path, not a resolved real path. Symlink/junction traversal can bypass the intended boundary.

**Fix:** Use `AppFileSystem.resolve(target)` instead of the platform-specific path normalization. `AppFileSystem.resolve()` resolves symlinks on all platforms and falls back gracefully if the path doesn't exist.

### 5. Replace `structuredClone` in compaction

**File:** `packages/opencode/src/session/compaction.ts`
**Severity:** Medium
**Effort:** Medium

**Problem:** Line 403 performs `structuredClone(selected.head)` on the message list before transformation. This is a large deep-copy cost on long sessions.

**Fix:** The clone protects against mutation by `plugin.trigger("experimental.chat.messages.transform")`, which can mutate the messages array passed to it. Replace `structuredClone` with a shallow array copy (`[...selected.head]`) since `toModelMessagesEffect` only reads (doesn't mutate). If plugins need protection against deep object mutation too, keep `structuredClone`. Per the existing pattern, a shallow copy should suffice — plugins that need to mutate should do so on their own copies.

## Verification

- Run `bun typecheck` in `packages/opencode` after each fix
- For health-window: unit test `toArray()` output and decay behavior
- For N+1: verify `EXPLAIN QUERY PLAN` shows single query, no per-row follow-ups
- For route eviction: verify route count stays bounded
- For external-directory: integration test with symlink to out-of-tree target
- For structuredClone: verify compaction still works correctly via existing tests
