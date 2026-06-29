# Master Emergency Performance & Bug Fix Plan
> sv=[[checkpoint, silent-catch, memory-leak, event-handler, race-condition, subscription, eviction, corruption],[0.20,0.18,0.15,0.12,0.10,0.08,0.09,0.08]]
> abstract="Comprehensive emergency triage plan addressing 8 CPU hotspots, 9 memory leaks, 12 confirmed bugs including silent state corruption, race conditions, and unrecoverable checkpoints in the opencode project."

**Status:** All emergency items resolved (2026-06-28). 10 new fixes applied this session. C12 audited low-risk. B8 deferred P3-LOW. C10 implemented incorrectly in prior session — fixed this session (worktree removed from deriveKey).

## Execution Order

### Phase 1: P0 Critical ✅ DONE
| Step | Item | Status |
|------|------|--------|
| 1.1 | C6-C7: Checkpoint silent catches | ✅ |
| 1.2 | C10: Checkpoint key derivation fix | ✅ (2026-06-28 — worktree removed) |
| 1.3 | B3: Session route subscriptions leak | ✅ |
| 1.4 | B1: heap.ts stop() export | ✅ |
| 1.5 | B4: Editor WebSocket listener leak | ✅ |

### Phase 2: P1 High ✅ DONE
| Step | Item | Status |
|------|------|--------|
| 2.1 | C1: Stream cancel silent catch | ✅ |
| 2.2 | C11: Checkpoint temp file collision | ✅ |
| 2.3 | B6: Jobs Map unbounded growth | ✅ (2026-06-28 — 5-min TTL + MAX_JOBS cap) |
| 2.4 | B7: PTY subscriber cleanup | ✅ (2026-06-28 — WS close/error cleanup) |

### Phase 3: P2 Medium ✅ DONE
| Step | Item | Status |
|------|------|--------|
| 3.1 | A1: BG Pulse optimization | ✅ (2026-06-28 — memo split + focus gating) |
| 3.2 | A2: Autocomplete polling | ✅ (2026-06-28 — reactive memos) |
| 3.3 | A3: Logo animation interval | ✅ (2026-06-28 — 16→33ms) |
| 3.4 | A4-A5: TokenEst + Message map | ✅ (2026-06-28 — cached + fast-path) |
| 3.5 | A6: findUp cache | ✅ (2026-06-28 — 5s TTL) |
| 3.6 | C2-C5: Remaining silent catches | ✅ |

### Phase 4: P3 Low ✅ DONE
| Step | Item | Status |
|------|------|--------|
| 4.1 | B8: Gateway limiter TTL | ⏸️ Deferred (P3-LOW, complex integration) |
| 4.2 | B9: ScopedCache capacity limit | ✅ |
| 4.3 | A7-A8: Gateway status / page size | ✅ (NO ACTION — documented) |
| 4.4 | C8-C9, C12: Remaining bugs | ✅ (C8-C9), ✅ (C12 audited — single-fiber, low risk) |

## Session Additions (2026-06-28)
| ID | Fix |
|----|-----|
| C10 | Removed worktree from checkpoint deriveKey (4 src + 2 test files) |
| A1 | BG Pulse: ringStates/normalizedMasks split memos + focus gating |
| A2 | Autocomplete: 50ms setInterval → reactive createMemo |
| A3 | Logo: setInterval 16ms → 33ms |
| A4 | TokenEst: cached by messages.length |
| A5 | Orphan filter: fast-path .some() check |
| A6 | findUp/globUp: 5s TTL cache |
| B5 | GitHub CLI: unsub in finally (verified) |
| B6 | Jobs Map: 5-min TTL + MAX_JOBS=1000 |
| B7 | PTY: WebSocket close/error cleanup |
| C12 | Processor race: audited — single-fiber, low risk |
