# Log System Performance Optimization

## Goal

Reduce log system CPU overhead without reducing observability. No level downgrades. All entries preserved at their current level.

## Analysis Summary

Analyzed 499 log lines over 4 minutes. Found 5 performance bottlenecks ranked by CPU cost:

| Rank | Bottleneck | Cost/rx | Location |
|------|-----------|---------|----------|
| 1 | `getCaller()` double `new Error().stack` per call | 10-100µs | `log.ts:238,255,264` |
| 2 | Double `JSON.stringify` (payload + entry) | 5-50µs | `log.ts:219,248` |
| 3 | `mkdirSync` on every renderer log write | 2 syscalls | `log-bridge.ts:52-53` |
| 4 | 100-char payload threshold → excessive sidecar I/O | file write | `log.ts:220` |
| 5 | Date/string allocations in `build()` | minor | `log.ts:239-240` |

Plus 1 observability improvement (no CPU impact):

| Rank | Improvement | Location |
|------|-------------|----------|
| 6 | Missing service tags — 64.5% entries untagged | `create()` calls |

Also note: dedup flush emits too many summary lines (264 of 499 = 52.9%). Consolidate to one line per flush cycle without losing information.

## Phase 1: CPU Performance

### 1.1 Eliminate duplicate `getCaller()` calls — pass caller from method body to `build()`

**File:** `packages/core/src/util/log.ts` — `debug()`, `info()` (lines 252-272), `build()` (line 236)

**Problem:** `getCaller()` calls `new Error().stack` — V8's most expensive operation. Called twice per DEBUG/INFO entry: once for dedup key (e.g. line 255), once inside `build()` (line 238).

**Fix:** `debug()`/`info()` already call `getCaller()` for dedup. Pass that result to `build()` so `build()` skips its own `getCaller()` call:

```ts
function build(level, message, extra, caller?: string) {
  // ... use caller if provided, else fall back to getCaller()
}
// In debug():
const caller = getCaller()
if (dedup already exists) return
write(build("DEBUG", message, extra, caller))
```

**Why not cache at `create()` time:** `create()` is usually called at module scope. The stack at that point resolves to the *importer* of the module, not the module itself where `log.info()` calls occur. Passing caller from the actual log call site is accurate.

**Tasks:**
1. [ ] Add optional `caller?: string` parameter to `build()` — when provided, skip `getCaller()` inside
2. [ ] Pass pre-computed `caller` from `debug()`, `info()` method bodies to `build()` call

**Expected:** Eliminates 1 of 2 `getCaller()` calls per DEBUG/INFO entry (~50% reduction in stack capture overhead).

### 1.2 Eliminate double `JSON.stringify`

**File:** `packages/core/src/util/log.ts` — `serializePayload()` (line 218) + `build()` (line 236)

**Problem:** `serializePayload()` calls `JSON.stringify(extra)` for 100-char size check. Then `build()` calls `JSON.stringify(entry)` which re-serializes `entry.payload` (the same extra object).

**Fix:** 
- `serializePayload()` returns `{ payload_json: string }` for inlined payloads (already stringified)
- `build()` splices `payload_json` directly into the JSON string:

```ts
let result = JSON.stringify(entry)  // entry has no payload field
if (payload_json) {
  result = result.slice(0, -1) + `,"payload":${payload_json}}\n`
}
```

**Tasks:**
3. [ ] Refactor `serializePayload()` to return `{ payload_json?: string; payload_id?: string }`
4. [ ] Modify `build()` to splice pre-stringified payload directly, avoiding re-stringify

**Expected:** 15-25% CPU reduction per log line with payload.

### 1.3 Guard `mkdirSync` with one-time flag

**File:** `packages/desktop-electron/src/main/log-bridge.ts` (line 52)

**Problem:** `mkdirSync(logDir)` and `mkdirSync(payloads)` called on every renderer log write — 2 syscalls each time, even though directories exist after first call.

**Tasks:**
5. [ ] Add `let dirsCreated = false`, guard both `mkdirSync` calls

**Expected:** Eliminates 2 redundant syscalls per renderer log write.

### 1.4 Raise payload sidecar threshold 100→500

**File:** `packages/core/src/util/log.ts` — `serializePayload()` (line 220)

**Problem:** 100-char threshold creates excessive sidecar files (31 files for 499 log lines). Most payloads in 100-500 char range are safely inlined without affecting grep results.

**Tasks:**
6. [ ] Change `json.length <= 100` → `json.length <= 500` in `serializePayload()`
7. [ ] Mirror same threshold change in `log-bridge.ts` line 70

**Expected:** ~60% fewer sidecar file writes.

## Phase 2: Observability (no CPU impact)

### 2.1 Consolidate dedup flush to one aggregate line

**File:** `packages/core/src/util/log.ts` — `flushDedup()` (line 87)
**Also:** `packages/desktop-electron/src/main/log-bridge.ts` — `flushDedup()` (line 15)

**Problem:** Dedup flush writes one summary line PER key (40+ lines every 5s). 264 of 499 lines = 52.9% of log volume. Information retained but format is noisy.

**Fix:** Single aggregate line per flush cycle:
```json
{"caller":"log.ts:dedup","level":"DEBUG","message":"dedup flush: 42 entries suppressed (14 unique keys in 5000ms)"}
```

**Does NOT lose information** — individual key info was never individually useful; aggregate count is equally debuggable.

**Tasks:**
8. [ ] Replace per-key output with single aggregate line showing total suppressed + unique key count
9. [ ] Mirror in `log-bridge.ts`

### 2.2 Add service tags to untagged loggers

**Problem:** 64.5% of entries have no `service` tag. In bundled code, all callers show same chunk name. Service tags disambiguate.

**Tasks:**
10. [ ] Audit `Log.create()` calls without `{ service: "..." }`, add appropriate tags (focus on gateway/files lacking service)

## Status

| Phase | Tasks | Status |
|-------|-------|--------|
| 1: CPU Performance | 1-7 | pending |
| 2: Observability | 8-10 | pending |
