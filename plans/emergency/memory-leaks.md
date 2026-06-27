# Memory Leak Fix Plan
> sv=[[event-handler, map, interval, websocket, subscription, eviction, cleanup, onCleanup],[0.22,0.18,0.15,0.12,0.10,0.09,0.08,0.06]]
> abstract="Fixes 9 memory leaks including missing event listener cleanup, unbounded Map growth, missing onCleanup handlers in SolidJS components, and orphaned subscription patterns."

---

## B1. heap.ts — Add stop() Export [P0-CRITICAL]
**File:** `packages/opencode/src/cli/heap.ts:53-56`
**SV:** `[setInterval, clearInterval, stop, timer, heap-profiling]`
**Status:** ✅ DONE (2026-06-27)

### Current Code
```ts
const timer = setInterval(run, 60000)  // 60s memory sampling
// NO export stop() function
```

### Root Cause
Module-level `setInterval` has no corresponding `clearInterval` export. If the module scope persists across test reloads or hot-reloads, the interval accumulates. Per `AGENTS.md`: "Silent catch blocks are bugs."

### Fix
```ts
// Add after line 56:
export function stop() {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
}
```

### Implementation
- [ ] Add `export function stop() { ... }` after the `setInterval` block
- [ ] Verify `stop` is callable and timer is cleared
- [ ] Add `stop` to module exports (check if `export *` pattern applies)

### Test Cases
- [ ] `heap.start()` creates interval
- [ ] `heap.stop()` clears interval — no pending timer
- [ ] Calling `stop()` twice is safe (idempotent)
- [ ] Calling `stop()` before `start()` is safe (no-op)

### Oracle
- `rg -n 'clearInterval' packages/opencode/src/cli/heap.ts` — should show the cleanup call

---

## B2. TUI Worker GlobalBus — Add cleanup in shutdown [P1-HIGH]
**File:** `packages/opencode/src/cli/cmd/tui/worker.ts:38`
**SV:** `[GlobalBus, event, subscription, worker, shutdown]`

### Current Code
```ts
GlobalBus.on("event", (msg) => {
  // handle event
})
// No corresponding GlobalBus.off
```

### Root Cause
Worker process subscribes to `GlobalBus` on startup but never unsubscribes. For a long-lived worker, this is functionally fine (same process lifetime), but if worker context is ever re-created without process restart, this leaks.

### Fix
```ts
const unsub = GlobalBus.on("event", (msg) => { ... })
// In rpc.shutdown() or cleanup:
unsub()
```

### Implementation
- [ ] Store return value of `GlobalBus.on()` in `unsub` variable
- [ ] Call `unsub()` in `rpc.shutdown()` or equivalent cleanup function
- [ ] Verify worker shutdown clears the subscription

### Test Cases
- [ ] Worker starts and receives events
- [ ] Worker shutdown clears subscription
- [ ] No error on double-shutdown

---

## B3. Session Route Subscriptions — Add onCleanup [P0-CRITICAL]
**File:** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:290, 320`
**SV:** `[event-on, subscription, onCleanup, session-route, solidjs]`

### Current Code
```ts
// Line 290:
event.on("message.part.updated", handler)
// Line 320:
event.on("session.status", handler)
// Both return unsubscribe functions — NOT stored, NOT called in onCleanup
```

### Root Cause
SolidJS component subscribes via `event.on()` which returns an unsubscribe function, but the function is never stored or called. Navigating away from session route leaves these subscriptions alive. **This is the most likely source of "it gets slower the longer I use it" complaints.**

### Mathematical Impact
```
Each navigation to session route: +2 subscriptions
After N navigations: 2N subscriptions firing on every message update
Each message update fires all subscriptions → O(N) handler calls per update
```

### Fix
```tsx
const unsub1 = event.on("message.part.updated", handler1)
const unsub2 = event.on("session.status", handler2)

onCleanup(() => {
  unsub1()
  unsub2()
})
```

### Implementation
- [ ] Store `event.on()` return values in named variables
- [ ] Add `onCleanup(() => { unsub1(); unsub2() })` at component scope
- [ ] Verify subscriptions are cleared when navigating away from session route
- [ ] Test with rapid session switching (10+ switches)

### Test Cases
- [ ] Session route loads correctly
- [ ] Subscriptions fire during session view
- [ ] After navigating away, subscriptions are cleared
- [ ] Rapid switching (20x) doesn't accumulate handlers
- [ ] Events still work after navigating back

### Oracle
- `rg -n 'event\.on\(' packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — both should have matching onCleanup

---

## B4. Editor WebSocket Listeners — Add removeEventListener [P0-CRITICAL]
**File:** `packages/opencode/src/cli/cmd/tui/context/editor.ts:163, 178, 211`
**SV:** `[addEventListener, removeEventListener, websocket, onCleanup, editor]`

### Current Code
```ts
ws.addEventListener("open", ...)
ws.addEventListener("message", ...)
ws.addEventListener("close", ...)
onCleanup(() => {
  ws.close()
  clearTimeout(...)
})
// Missing: removeEventListener for all three
```

### Root Cause
`onCleanup` closes the socket and clears timeout but does NOT remove event listeners. While closing the socket typically allows GC, the listeners still hold references to the socket and closure scope — preventing garbage collection of the WebSocket object and its associated buffers.

### Fix
```tsx
const onOpen = () => { ... }
const onMessage = (e) => { ... }
const onClose = () => { ... }

ws.addEventListener("open", onOpen)
ws.addEventListener("message", onMessage)
ws.addEventListener("close", onClose)

onCleanup(() => {
  ws.removeEventListener("open", onOpen)
  ws.removeEventListener("message", onMessage)
  ws.removeEventListener("close", onClose)
  ws.close()
  clearTimeout(...)
})
```

### Implementation
- [ ] Extract listener functions to named variables
- [ ] Add `removeEventListener` for all three in `onCleanup`
- [ ] Ensure remove happens BEFORE `ws.close()` (order matters)

### Test Cases
- [ ] WebSocket connects and receives messages
- [ ] Editor selection polling works
- [ ] On cleanup: all three listeners removed, socket closed
- [ ] No lingering references after cleanup

---

## B5. GitHub CLI Bus Subscribe — Add unsubscribe [P1-MEDIUM]
**File:** `packages/opencode/src/cli/cmd/github.ts:902`
**SV:** `[Bus, subscribe, unsubscribe, github, cli]`

### Current Code
```ts
const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, handler)
// unsub() never called
```

### Root Cause
In a CLI context, process exits after command completes. Risk is low, but the handler fires uncontrolled during command execution.

### Fix
```ts
try {
  // ... command logic ...
} finally {
  unsub()
}
```

### Implementation
- [ ] Add `unsub()` call in `finally` block after command logic
- [ ] Verify command still functions correctly

### Test Cases
- [ ] GitHub command executes correctly
- [ ] No subscription leak after command completes

---

## B6. Jobs Map — Add Eviction [P1-MEDIUM]
**File:** `packages/opencode/src/jobs/index.ts:173-176`
**SV:** `[jobs, map, eviction, ttl, readOffsets, counters]`

### Current Code
```ts
const jobs = new Map()       // No eviction — grows forever
const completed = new Map()  // Capped at 500
const readOffsets = new Map() // Cleaned in drainCompletedNote only
const counters = new Map()   // Never cleaned
```

### Root Cause
`jobs` Map accumulates entries for every job ever created. `readOffsets` cleaned only via `drainCompletedNote()` which may not be called for all sessions. Over long sessions, these maps grow unbounded.

### Mathematical Model
```
Job creation rate: ~1-5 per minute (tool calls, file operations)
Hours of use: 8
Max jobs: 8 * 60 * 5 = 2,400 entries
Memory per entry: ~500 bytes (Job object + metadata)
Max memory: ~1.2MB
```

### Fix
```ts
const MAX_JOBS = 1000
const JOB_TTL = 5 * 60 * 1000  // 5 minutes

function evictStaleJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL) {
      jobs.delete(id)
    }
  }
  // Enforce max size
  if (jobs.size > MAX_JOBS) {
    const entries = [...jobs.entries()]
    const toDelete = entries.slice(0, entries.length - MAX_JOBS)
    for (const [id] of toDelete) {
      jobs.delete(id)
    }
  }
}

// Call in drainCompletedNote and on session close
```

### Implementation
- [ ] Add `evictStaleJobs()` function with 5-minute TTL
- [ ] Add `MAX_JOBS = 1000` constant
- [ ] Call `evictStaleJobs()` in `drainCompletedNote()`
- [ ] Call `evictStaleJobs()` on session close
- [ ] Add similar eviction for `readOffsets` and `counters`

### Test Cases
- [ ] After 1000 jobs, oldest entries are evicted
- [ ] Jobs accessed within 5 minutes are not evicted
- [ ] No error on eviction of already-deleted entries
- [ ] Memory stabilizes after eviction (doesn't grow forever)

### Oracle
- Memory profiling: jobs Map size stays <1000 after extended use

---

## B7. PTY Subscribers — Add WebSocket Close Cleanup [P1-MEDIUM]
**File:** `packages/opencode/src/pty/index.ts:249`
**SV:** `[pty, subscribers, websocket, close, cleanup, session]`

### Current Code
```ts
const subscribers: Map<SessionID, SubscriberState> = new Map()
// Entries removed on session exit, but WebSocket connections within a session
// can accumulate if connections drop without clean close frame
```

### Root Cause
Subscribers are added per WebSocket connection but only removed on explicit session exit. Dropped connections without close frames leave stale entries.

### Fix
```ts
ws.on("close", () => {
  const state = subscribers.get(sessionID)
  if (state) {
    state.connections.delete(ws)
    if (state.connections.size === 0) {
      subscribers.delete(sessionID)
    }
  }
})

ws.on("error", () => {
  ws.close()  // Triggers close handler above
})
```

### Implementation
- [ ] Add `ws.on("close", ...)` handler to remove from subscribers map
- [ ] Add `ws.on("error", ...)` handler to force close
- [ ] Verify session exit still cleans up properly

### Test Cases
- [ ] PTY session starts, subscriber added
- [ ] WebSocket disconnects → subscriber removed
- [ ] Multiple connections to same session tracked correctly
- [ ] Session exit cleans up all connections

---

## B8. Gateway Limiter — Add TTL [P3-LOW]
**File:** `packages/opencode/src/provider/gateway/limiter.ts:31, 41`
**SV:** `[limiter, routes, slots, ttl, eviction]`

### Current Code
```ts
const routes: Map<string, { counter, max }> = new Map()  // No TTL
const slots: Map<string, number> = new Map()              // No cleanup
```

### Root Cause
Provider routes and concurrency slots are never evicted. Over days of running, entries accumulate from every unique provider+model combination.

### Fix
```ts
const ROUTE_TTL = 60 * 60 * 1000  // 1 hour

function evictStaleRoutes() {
  const now = Date.now()
  for (const [key, route] of routes) {
    if (now - route.lastAccess > ROUTE_TTL) {
      routes.delete(key)
      slots.delete(key)
    }
  }
}

// Call every 5 minutes
setInterval(evictStaleRoutes, 5 * 60 * 1000)
```

### Implementation
- [ ] Add `lastAccess` timestamp to route entries
- [ ] Add `evictStaleRoutes()` function with 1-hour TTL
- [ ] Update `lastAccess` on route access
- [ ] Add sweep interval (5 minutes)

### Test Cases
- [ ] Routes not accessed for >1 hour are evicted
- [ ] Recently accessed routes persist
- [ ] No error on eviction of already-deleted entries

---

## B9. ScopedCache — Add Capacity Limit [P3-LOW]
**File:** `packages/opencode/src/effect/instance-state.ts:43`
**SV:** `[ScopedCache, capacity, lru, eviction]`

### Current Code
```ts
capacity: Number.POSITIVE_INFINITY
```

### Root Cause
No size limit. Relies on directory-based disposal, but if directories are never invalidated, entries persist forever.

### Fix
```ts
capacity: 10000  // Safe upper bound for per-directory caching
```

### Implementation
- [ ] Change `Number.POSITIVE_INFINITY` to `10000`
- [ ] Verify existing eviction behavior (LRU at capacity)
- [ ] Test with many concurrent directories

### Test Cases
- [ ] Cache entries beyond 10000 are evicted (LRU)
- [ ] Recently accessed entries persist
- [ ] No error at capacity boundary

---

## Verification (Post All Memory Leak Fixes)

```bash
# Measure memory before/after over 30-minute session
# Start opencode, use normally for 30 minutes, track RSS

# Verify no uncleaned subscriptions
rg -n 'event\.on\(' packages/opencode/src/cli/cmd/tui/routes/ --include='*.tsx'
# Should show onCleanup for each event.on

# Verify no uncleaned addEventListener
rg -n 'addEventListener' packages/opencode/src/cli/cmd/tui/context/ --include='*.ts'
# Should show matching removeEventListener

# Verify heap.ts has stop()
rg -n 'export.*stop' packages/opencode/src/cli/heap.ts
# Should return the stop function

# Typecheck
bun typecheck  # packages/opencode
```
