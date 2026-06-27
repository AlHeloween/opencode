# Master Emergency Performance & Bug Fix Plan
> sv=[[checkpoint, silent-catch, memory-leak, event-handler, race-condition, subscription, eviction, corruption],[0.20,0.18,0.15,0.12,0.10,0.08,0.09,0.08]]
> abstract="Comprehensive emergency triage plan addressing 8 CPU hotspots, 9 memory leaks, 12 confirmed bugs including silent state corruption, race conditions, and unrecoverable checkpoints in the opencode project."

## Triage Summary

| Category | Count | P0 | P1 | P2 | P3 |
|----------|-------|----|----|----|----|
| CPU Hotspots | 8 | 0 | 1 | 4 | 3 |
| Memory Leaks | 9 | 2 | 2 | 2 | 3 |
| Bugs (silent catches, races, corruption) | 12 | 3 | 3 | 3 | 3 |
| Plan-to-Code Gaps | 2 | 1 | 1 | 0 | 0 |
| **TOTALS** | **31** | **6** | **7** | **9** | **9** |

## Execution Order

### Phase 1: P0 Critical (3-4 hours)
Checkpoint corruption fixes + highest-impact memory leaks. These prevent silent data loss and runtime degradation.

| Step | Item | Plan | Est. |
|------|------|------|------|
| 1.1 | C6-C7: Checkpoint silent catches | [silent-catches.md](./silent-catches-and-bugs.md#c6-c7) | 30min |
| 1.2 | C10: Checkpoint key derivation fix | [silent-catches.md](./silent-catches-and-bugs.md#c10) | 45min |
| 1.3 | B3: Session route subscriptions leak | [memory-leaks.md](./memory-leaks.md#b3) | 30min |
| 1.4 | B1: heap.ts stop() export | [memory-leaks.md](./memory-leaks.md#b1) | 15min |
| 1.5 | B4: Editor WebSocket listener leak | [memory-leaks.md](./memory-leaks.md#b4) | 20min |

### Phase 2: P1 High (2 hours)
High-severity leaks and bugs that compound over time.

| Step | Item | Plan | Est. |
|------|------|------|------|
| 2.1 | C1: Stream cancel silent catch | [silent-catches.md](./silent-catches-and-bugs.md#c1) | 10min |
| 2.2 | C11: Checkpoint temp file collision | [silent-catches.md](./silent-catches-and-bugs.md#c11) | 15min |
| 2.3 | B6: Jobs Map unbounded growth | [memory-leaks.md](./memory-leaks.md#b6) | 45min |
| 2.4 | B7: PTY subscriber cleanup | [memory-leaks.md](./memory-leaks.md#b7) | 20min |

### Phase 3: P2 Medium (3 hours)
CPU hotspots that drain battery and add latency.

| Step | Item | Plan | Est. |
|------|------|------|------|
| 3.1 | A1: BG pulse grid optimization | [cpu-hotspots.md](./cpu-hotspots.md#a1) | 60min |
| 3.2 | A2: Autocomplete position polling | [cpu-hotspots.md](./cpu-hotspots.md#a2) | 30min |
| 3.3 | A4-A5: JSON.stringify & message map | [cpu-hotspots.md](./cpu-hotspots.md#a4-a5) | 45min |
| 3.4 | C2-C5: Remaining silent catches (P2) | [silent-catches.md](./silent-catches-and-bugs.md#c2-c5) | 30min |

### Phase 4: P3 Low (2 hours)
Nice-to-haves, long-term health.

| Step | Item | Plan | Est. |
|------|------|------|------|
| 4.1 | B8: Gateway limiter TTL | [memory-leaks.md](./memory-leaks.md#b8) | 20min |
| 4.2 | B9: ScopedCache capacity | [memory-leaks.md](./memory-leaks.md#b9) | 15min |
| 4.3 | A3, A6-A8: Remaining CPU items | [cpu-hotspots.md](./cpu-hotspots.md#a3) | 30min |
| 4.4 | C8-C9, C12: Remaining bug items | [silent-catches.md](./silent-catches-and-bugs.md#c8-c9) | 30min |

## Sub-Plans

| Plan | Items | Severity | Focus |
|------|-------|----------|-------|
| [cpu-hotspots.md](./cpu-hotspots.md) | A1-A8 | P2-P3 | cpu, interval, json, loops, polling, memoization |
| [memory-leaks.md](./memory-leaks.md) | B1-B9 | P0-P3 | event-handler, map, interval, websocket, subscription, eviction |
| [silent-catches-and-bugs.md](./silent-catches-and-bugs.md) | C1-C12 | P0-P2 | silent-catch, checkpoint, race-condition, corruption, integrity |

## Plan-to-Code Gaps to Resolve

| Plan | Issue | Action |
|------|-------|--------|
| `plans_completed/silent-catch-elimination.md` | All 26 items `[ ]` but file in completed/ | Verify items, move back to `plans/` if incomplete |
| `plans_completed/perf-fixes-2.md` | Item 5 unchecked | Verify in code, mark `[x]` or `[ ]` |

## Execution Strategy

1. **Create feature branch** from `Local_Development`: `emergency/perf-bug-leak-fixes`
2. **Fix in order** P0 → P1 → P2 → P3 (each phase = one commit)
3. **Verify each phase** before proceeding:
   ```bash
   # After each fix:
   bun typecheck  # packages/opencode
   bun test       # packages/opencode (smoke tests)
   ```
4. **Post-fix audit** (after Phase 4 complete):
   ```bash
   rg -n '\.catch\(\(\) => \{\}\)' packages/opencode/src
   rg -n 'catch\s*\{\s*/\*' packages/opencode/src
   ```
5. **Update plans**: mark all `[x]`, move to `plans_completed/`
