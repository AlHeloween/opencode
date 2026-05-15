# Log Deduplication — Suppress Repeating Entries

## Goal

Eliminate log flood from repeating entries (e.g., bus "publishing" writes ~50 identical lines per message). First occurrence always written. Duplicates suppressed with a summary after a time window.

## Design

Per unique `(caller, level, message)` tuple, in-memory state:

```
pendingDedup[`${caller}|${level}|${message}`] = { count: number, firstTs: string, firstId: string }
```

**Algorithm on `write()`:**
1. Build the entry normally (id, caller, ts, level, message, payload/payload_id)
2. Look up `key = caller + "|" + level + "|" + message`
3. If no pending entry → insert `{ count: 1, firstId, firstTs }` → write entry normally
4. If pending entry exists → increment count, suppress write
5. On 5s interval flush: for each pending entry with count > 1, write summary: `message =`original message (×N total in 5000ms)``, then delete pending entry

**Never dedup:**
- `level === "ERROR"` — always write
- `message.startsWith("bug:")` — bug collection must capture every occurrence
- Different `caller` values — different code locations, different entries

**On process exit:** flush all remaining pending entries before file close.

## Implementation

### Phase 1: Core log.ts dedup

**File:** `packages/core/src/util/log.ts`

1. [ ] Add dedup map: `const dedupState = new Map<string, { count: number; firstId: string; firstTs: string }>()`
2. [ ] Add flush timer: `let dedupTimer: Timer | undefined`
3. [ ] Add `flushDedup()` function that writes summaries and clears map
4. [ ] In `build()` or the write path, check/update dedupState before writing
5. [ ] Start 5s interval timer in `init()`, clear in `reopen()`
6. [ ] On `cleanup()` exit, flush remaining dedupState
7. [ ] Skip dedup for ERROR level and `bug:` messages

### Phase 2: Mirror in log-bridge.ts

**File:** `packages/desktop-electron/src/main/log-bridge.ts`

8. [ ] Mirror identical dedup logic (no shared code, this is a separate process)
9. [ ] Same 5s flush window, same never-dedup rules

### Phase 3: Build and verify

10. [ ] `bun typecheck` from packages/opencode + packages/desktop-electron
11. [ ] `pwsh _build.ps1`
12. [ ] Launch, trigger a message stream, verify logs show dedup summaries
13. [ ] Verify `rg "publishing" .opencode/data/log` shows first + summary lines, not 50 duplicates

## Status

| Phase | Status |
|-------|--------|
| 1 | Pending |
| 2 | Pending |
| 3 | Pending |
