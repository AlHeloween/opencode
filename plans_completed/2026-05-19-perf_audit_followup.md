# Performance Audit Follow-Up Fixes

**Created:** 2026-05-19
**Status:** Complete
**Based on:** Performance audit analysis (`ses_1c09cb6e5ffeqlN3g1aUtGlBU5`)

## Items

### [x] 1. H2 Busy-Wait Loop → Replace with Semaphore
**File:** `packages/opencode/src/provider/gateway/h2-transport.ts`
**Severity:** High
**Effort:** Medium

**Problem:** `request()` (line 166) and `requestStream()` (line 318) poll every 10ms when H2 sessions hit max concurrent streams:
```typescript
while (session.activeStreams >= session.remoteMaxConcurrentStreams) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
}
```

**Fix:** Add `waitQueue: Array<() => void>` to `H2Session`. Replace polling with a promise that resolves when a stream slot frees up. On stream completion (cleanup/decrement), resolve the next waiter.

### [x] 2. DB Effects Not Awaited → VERIFIED SAFE (Type System)
**File:** `packages/opencode/src/storage/db.ts`
**Severity:** ~~High~~ → N/A

**Analysis:** `effect(fn: () => void)` (line 378) enforces sync-only at the type level. The `effects` array is typed `(() => void)[]`. TypeScript rejects `() => Promise<void>` in this position. All callers (`emitEvent` in `sync/index.ts`) return `void`, not `Promise<void>`. **No fix needed.**

### [x] 3. structuredClone on Part Update
**File:** `packages/opencode/src/session/session.ts` line 551
**Severity:** Medium
**Effort:** Low

**Problem:** Every part update deep-clones the entire part object:
```typescript
part: structuredClone(part),
```
Creates GC pressure in sessions with many parts.

**Fix:** Remove `structuredClone()`. Pass `part` directly. `SyncEvent.run()` serializes, not mutates.

### [x] 4. SSE Event Queue Without Backpressure
**File:** `packages/opencode/src/server/routes/instance/event.ts` lines 69-74
**Severity:** Medium
**Effort:** Low

**Problem:** Every event triggers `JSON.stringify` + push to unbounded `AsyncQueue`. Under high event volume + slow clients, memory grows without bound.

**Fix:** Add `MAX_QUEUE_SIZE = 1000`. When queue exceeds limit, skip new events (log a warning once).

### [x] 5. PTY Buffer String Reallocation
**File:** `packages/opencode/src/pty/index.ts` lines 256-260
**Severity:** Medium
**Effort:** Medium

**Problem:** When the 2MB ring buffer wraps, `slice()` allocates a new 2MB string:
```typescript
session.buffer += chunk
session.buffer = session.buffer.slice(excess)
```

**Fix:** Replace single string buffer with `chunks: string[]` + `totalLength: number`. On overflow, shift oldest chunks until total falls under limit.

## Verification Results

- `bun typecheck` in `packages/opencode`: **PASS** (0 errors)
- PTY tests (8/8): **PASS**
- Session tests (4/4): **PASS**
- Session schema + entry-stepper (28/28): **PASS**
- SSE event HTTP API (1/1): **PASS**
- TUI HTTP API (2/2): **PASS**
- H2 semaphore: no 10ms timers remain in `h2-transport.ts` **[Verified]**
- SSE queue: `AsyncQueue` constructor accepts `maxLength`; event+sse routes capped at 1000 **[Verified]**
- PTY buffer: `bufferChunks: string[]` replaces single `buffer: string`; trim via `shift()` **[Verified]**
- For H2 semaphore: verify no 10ms timers in `h2-transport.ts`
- For SSE queue: verify queue bounded to 1000 entries
- For PTY: verify chunk buffer doesn't allocate new strings on wrap
