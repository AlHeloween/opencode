# CPU Hotspots Fix Plan
> sv=[[interval, json, loops, polling, memoization, resize, throttle, cleanup],[0.22,0.18,0.15,0.12,0.10,0.08,0.08,0.07]]
> abstract="Fixes 8 CPU hotspots in the TUI and session layer. Primary impact: BG pulse grid recomputation (14K iterations/frame), autocomplete position polling (50ms), and JSON.stringify token estimation (~1-5ms/request)."

---

## A1. BG Pulse Grid Optimization [P2-HIGH]
**File:** `packages/opencode/src/cli/cmd/tui/component/bg-pulse.tsx:48-111`
**SV:** `[bg-pulse, createMemo, resize, rings, grid, recomputation]`

### Problem
Every 50ms, the grid recomputes `width * height * RINGS` (typically 120×40×3 = **14,400 iterations**). Each pixel computes `Math.hypot`, `Math.cos`, `**2.3`, plus mask normalization. Runs continuously even when terminal is idle.

### Mathematical Model
```
Per frame: O(w × h × R) operations
  - w = terminal width (~120 cols)
  - h = terminal height (~40 rows)
  - R = RINGS (3)
  - Each op: hypot + cos + exponentiation

At 50ms interval: 20 FPS × 14,400 = ~288,000 trig ops/second
```

### Fix Strategy
**Memoize by resize + time, throttle visual update rate.**

1. **Add resize dependency to createMemo**: The grid only changes shape on resize, not every tick. Split into:
   - `ringStates` = `createMemo(() => computeRings(now()))` — recomputed per tick (lightweight, O(R))
   - `grid` = `createMemo(() => computeGrid(size(), ringStates(), ...))` — only recomputed when `size()` or `ringStates()` change

2. **Throttle interval to 100ms** (10 FPS): The visual difference between 20 and 10 FPS is imperceptible in a terminal background animation. Halves CPU cost immediately.

3. **Gate computation on terminal focus**: Pause computation when terminal is not focused (use `document.hasFocus()` or equivalent Bun TUI signal).

### Implementation
- [ ] Add `lastGridSize` ref tracking `size().width` and `size().height`
- [ ] Split grid computation into resize-dependent + time-dependent memos
- [x] Reduce `setInterval` from `50` to `100`
- [ ] Add focus check: if `!focused`, skip grid computation
- [ ] Verify visual quality unchanged

### Test Cases
- [ ] Grid recomputes on resize but NOT every tick while size is stable
- [ ] Interval runs at 100ms, not 50ms
- [ ] No visual regression in BG pulse animation
- [ ] CPU usage drops ~40-50% (measure via `top`/`ps`)

### Oracle
- `time` command: compare CPU time before/after over 10-second idle window
- Visual inspection: gradient pulse visible, no flicker

---

## A2. Autocomplete Position Polling [P2-MEDIUM]
**File:** `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:100-113`
**SV:** `[polling, interval, autocomplete, position, resize]`

### Problem
Polls anchor position every **50ms** via `setInterval` while autocomplete is visible. Creates a tight loop that runs for the duration of any autocomplete interaction (typically 2-10 seconds).

### Mathematical Model
```
Duration: ~5 seconds (autocomplete visible)
Interval: 50ms = 20/sec
Cost per tick: 3 property reads + 3 comparisons + conditional setState
Total: ~100 ticks per autocomplete session
```

### Fix Strategy
**Replace polling with callback-driven update.**

1. **Option A (if SolidJS ResizeObserver available):** Attach a `ResizeObserver` to the anchor element. Position changes trigger the observer callback directly.

2. **Option B (fallback):** Increase interval to 100ms (halves cost) and use `requestAnimationFrame` wrapper if available in Bun TUI.

3. **Option C (simplest):** Track anchor position changes in the `createEffect` that computes the anchor, and signal position changes via a signal. Remove the polling interval entirely.

### Implementation
- [ ] Identify anchor position source (likely `props.anchor()` signal)
- [ ] If anchor is already signal-based, derive position directly without polling
- [ ] If not signal-based, add a signal for position changes
- [ ] Remove `setInterval` and `setPositionTick` polling pattern
- [ ] Verify positioning updates correctly when prompt scrolls

### Test Cases
- [ ] Autocomplete position updates correctly when prompt input changes
- [ ] No 50ms interval running while autocomplete visible
- [ ] Position tracks anchor when prompt height changes (multi-line input)
- [ ] No flicker or incorrect positioning

### Oracle
- `rg -n 'setInterval' packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx` — should return 0 matches

---

## A3. Logo Animation 16ms Tick [P3-LOW]
**File:** `packages/opencode/src/cli/cmd/tui/component/logo.tsx:601-609`
**SV:** `[setInterval, 16ms, animation, logo, cleanup]`

### Problem
`setInterval(tick, 16)` runs at **~62.5 FPS** — faster than any display refresh (even 60Hz monitors). Cleaned up in `onCleanup`, but while visible, generates unnecessary micro-tasks.

### Mathematical Model
```
Rate: 62.5 ticks/sec
Duration: ~3 seconds (logo animation)
Cost per tick: color computation + ANSI escape output
Total: ~187 ticks for 3 seconds
```

### Fix Strategy
**Reduce to 33ms (30 FPS) — visually identical, halves CPU.**

### Implementation
- [ ] Change `setInterval(tick, 16)` to `setInterval(tick, 33)`
- [ ] Verify animation looks smooth at 30 FPS

### Test Cases
- [ ] Logo animation renders without visible stutter
- [ ] No 16ms interval running

---

## A4-A5. JSON.stringify Token Estimation & Message Map [P2-MEDIUM]
**File A4:** `packages/opencode/src/session/llm.ts:258-263`
**File A5:** `packages/opencode/src/session/prompt.ts:1143-1150`
**SV:** `[json-stringify, messages, token-estimation, map, filter, shallow-copy]`

### Problem A4
```ts
const contentTokens = Math.ceil((JSON.stringify(messages).length + JSON.stringify(system).length) / 4)
```
Serializes entire message array (~10-200KB) + system prompt (~30-80KB) for token estimation. Called once per request. Latency: ~1-5ms depending on message count.

### Problem A5
```ts
msgs = msgs.map((msg) => ({
  ...msg,
  parts: msg.parts.filter((p) => !isOrphanedInterruptedTool(p)),
}))
```
Creates full shallow copy of message array + filtered parts arrays on every turn. O(n × p) where p = parts per message.

### Fix Strategy

**A4:** Cache token estimate with key = `messages.length + systemHash`. Since messages are immutable within a turn, the estimate is stable.

**A5:** Replace `.map().filter()` with in-place `.forEach()` that mutates `parts` arrays, or use a single `.map()` that skips the orphan check for most messages (orphaned tools are rare).

### Implementation
- [ ] A4: Add `cachedTokenEstimate` with key `messages.length + lastMessageId`
- [ ] A4: Only recompute when message count changes
- [ ] A5: Consider mutating filter for messages without orphans (fast path)
- [ ] A5: Profile before/after with 500-message conversation

### Test Cases
- [ ] A4: Token estimate correct after message addition
- [ ] A4: No recompute for same message count
- [ ] A5: Output identical to current implementation
- [ ] A5: No error on empty message array

### Oracle
- `bun -e 'console.time("token"); /* run estimate */ console.timeEnd("token")'` — should be <1ms for cached path

---

## A6. Directory Traversal findUp/globUp Cache [P3-LOW]
**File:** `packages/opencode/src/util/filesystem.ts:186-243`
**SV:** `[findUp, globUp, cache, filesystem, directory-traversal]`

### Problem
`findUp` and `globUp` traverse unbounded `while(true)` from start directory up to filesystem root. Deep directories (e.g., inside `node_modules`) do 15+ stat/glob calls per invocation. Called at session startup and on tool invocations.

### Mathematical Model
```
Call frequency: ~5-20 per session startup
Depth: 5-15 levels (average ~8)
Cost per call: O(depth) stat + glob operations
```

### Fix Strategy
**Add short-lived cache (TTL 5 seconds) for results keyed by `(target, start)`.**

### Implementation
- [ ] Add module-level `Map<string, {result, timestamp}>` with 5s TTL
- [ ] Check cache before traversal
- [ ] Return cached result if within TTL
- [ ] Verify cache invalidation on directory changes (not needed — TTL is sufficient)

### Test Cases
- [ ] Second call for same target/start returns cached result
- [ ] Call with different start directory computes fresh
- [ ] Stale cache entry (>5s) is recomputed

---

## A7. Gateway Status Interval [P3-NO ACTION]
**File:** `packages/opencode/src/provider/gateway/mod.ts:122`
**SV:** `[gateway, status, interval]`

**Assessment:** 5-second interval writing to `globalThis.__gatewayLiveStatus` is lightweight (a few property assignments and object spread). Runs in gateway mode only. Not a bottleneck at current scale.

**Decision:** No action needed. Document for future if gateway becomes hot path.

---

## A8. Message Page Size 500 [P3-NO ACTION]
**File:** `packages/opencode/src/session/message-v2.ts`
**SV:** `[page-size, messages, limit]`

**Assessment:** Hardcoded limit of 500 messages per page is reasonable. The concern (500 × 5 parts = 2,500 joins) is within acceptable bounds for SQLite. Any future increase should be profiled.

**Decision:** No action needed. Document as documented constraint.

---

## Verification (Post All CPU Fixes)

```bash
# Measure idle CPU before/after (should drop 30-50%)
# Run opencode TUI, leave idle for 30 seconds, measure process CPU time
time opencode  # start
# Let sit 30 seconds
# Exit

# Confirm no setInterval leaks
rg -n 'setInterval' packages/opencode/src/cli/cmd/tui/ --include='*.tsx' --include='*.ts'

# Confirm typecheck passes
bun typecheck  # from packages/opencode
```
