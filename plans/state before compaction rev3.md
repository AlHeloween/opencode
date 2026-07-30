# State Before Compaction — Memory Dump rev3

**Date:** 2026-07-23 ~10:03 UTC
**Session:** `ses_0735964c5ffeAlWIBFfuJMdR6Y`
**Purpose:** Baseline snapshot of agent memory before compaction, to verify what survives.

---

## 1. Commit History (this session, chronological)

```
6ea50ebcfe chore: add Python fossil+codegraph smoke test scripts
17d962ee73 feat: refactor codegraph tool to use direct SQLite reads instead of CLI subprocess
47b26aa04d feat: auto-start codegraph MCP server daemon for live index sync
b4b9499d24 feat: show structural metadata in TUI footer from snapshot sym tag
9699368495 docs: formalize outer-loop continuous development paradigm in AGENTS.md
5cfb0c5b8a feat: Snapshot.lastImpact reads structural tag from current checkpoint
728c1048cf feat: add Snapshot.impact(from, to) — structural caller-trace on demand
e94d5d57a5 feat: require smoke tests and reuse search before implementation
ee69cadab1 feat: codegraph structural tagging on fossil snapshot track
```

**User commits (above ours):**
```
011286b6b4 fix: fossil tag add argument order for structural sym values  ← CRITICAL FIX
5c944f2d7c docs: document codegraph-rust fossil sandbox smoke paths
d8330901b7 feat: auto-inject mcp.codegraph when index or binary present
3eb12cb66b feat: CodeGraph hybrid MCP touch then SQLite pack for agents
5c321ebaac test: cover CodeGraph MCP-only path and live fossil-diff smoke
aa641c77d2 feat: CodeGraph live path is MCP-only with hard-fail
```

---

## 2. Architecture — What We Built

### Three-Layer Structural Grounding Pipeline

```
Layer 1: FOSSIL SNAPSHOTS (immutable, append-only)
  Snapshot.track() → fossil commit "auto-snapshot"
  Every change captured, diffable, restorable. No git reset --hard.

Layer 2: CODEGRAPH STRUCTURAL TAGS (per-snapshot)
  fossil tag add sym "KINDS:method=224,class=32|TOP:guardCommand[fn@constitution.ts]..." HASH
  Stored as fossil tags, queryable via fossil tag list HASH
  P0: Auto-tagged at every Snapshot.track() call

Layer 3: COMPACTION SUMMARIES (semantic layer)
  AI-generated summaries with message IDs, decisions, semantic vectors
  Chain-linked via prior message* IDs
  Survive across compaction cycles as "Decisions" block
```

### Key Files Created/Modified

| File | Purpose |
|------|---------|
| `packages/opencode/src/codegraph/reader.ts` | Direct SQLite reads: symbolsInFilePaths(), callersOf(), structuralDiff() |
| `packages/opencode/src/codegraph/sqlite-pack.ts` | MCP-refresh-then-SQLite-pack for agents (user's addition) |
| `packages/opencode/src/codegraph/mcp-client.ts` | MCP client for codegraph serve --mcp (user's addition) |
| `packages/opencode/src/snapshot/index.ts` | Added ImpactSummary schema, impact(), lastImpact() |
| `packages/opencode/src/snapshot/fossil.ts` | P0 sym tagging, P1 impact(), P2 lastImpact() |
| `packages/opencode/src/tool/codegraph.ts` | Refactored from CLI subprocess to direct SQLite reads |
| `packages/opencode/src/cli/cmd/tui/util/snapshot-symtag.ts` | Sync fossil tag reader for TUI footer |
| `packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx` | TUI footer shows "◆ method=224,class=32 (410)" |
| `packages/opencode/src/project/bootstrap.ts` | Auto-start codegraph MCP daemon (later replaced by MCP-only) |
| `tests/fossil-codegraph-smoke/structural_diff.py` | Python prototype: 200ms pipeline proof |
| `tests/fossil-codegraph-smoke/bench.py` | Performance breakdown: fossil diff 55ms, codegraph query 5ms |
| `tests/fossil-codegraph-smoke/check_schema.py` | DB schema inspection |

### MCP-First Architecture (user's refinement)

The final architecture is MCP-first:
- `codegraph serve --mcp` runs as managed MCP server (not detached daemon)
- MCP `explore` refreshes live index first
- SQLite pack delivers structured symbols + cross-file edges to agents
- Hard-fail if MCP is down — no silent staleness
- `mcp.codegraph` auto-injected when index or binary present

### Fossil Tag Format

```
KINDS:method=224,class=32,function=50,import=59,constant=29|TOP:guardCommand[fn@constitution.ts],allowDestructiveCommands[fn@constitution.ts]|IMPACT:dialog-navigation.tsx,index.ts
```

Stored via: `fossil tag add sym HASH "KINDS:...|TOP:..."` (ARGUMENT ORDER FIXED by user)

### Performance

- P0 tag-at-snapshot: ~70ms (fossil diff 55ms + codegraph query 5ms + tag 10ms)
- P1 on-demand impact: ~75ms
- P2 tag read: ~20ms (fossil tag list only)
- codegraph tool: ~5ms (direct SQLite, no CLI subprocess)

---

## 3. Key Design Decisions

- **Bypass constitution for fossil experiments**: Added `bypass_constitution` config + env var (`OPENCODE_BYPASS_CONSTITUTION`). Separate from `destructive` permission.
- **Destructive permission split**: User refactored into `destructive-file`, `destructive-db`, `destructive-git`, `destructive-fossil` — independent policy buckets.
- **Git stash hard-blocked**: After stash chaos, `git stash pop/apply/drop/clear` added to hard-block patterns.
- **No `codegraph sync` CLI**: Direct SQLite reads avoid the 10-minute full sync. MCP server handles incremental updates.
- **Fossil tags for structural metadata**: No new database. Rides on fossil's existing append-only storage.
- **Python prototype first**: Smoke test validated the pipeline before TypeScript implementation.

---

## 4. Critical Bug Fixes

| Bug | Fix |
|-----|-----|
| `session.time_compacting` never set | Added `setCompacting()` method, called from `compact()` |
| Summary injection counter reset on every compact | Changed `outputTokensSinceLastSummary = 0` → `countersSeeded = false` |
| `compaction.txt` stale references in Python tests | Removed from test file (`d85b05af`) |
| Fossil tag argument order wrong | User fix: `TAGNAME HASH VALUE` not `TAGNAME VALUE HASH` |
| SQLITE_BUSY from CLI+MCP conflict | Refactored codegraph tool to direct SQLite reads |

---

## 5. Config State

- `config.json`: `"bypass_constitution": true` (for fossil experiments)
- `config.json`: `"destructive": "deny"` (permission dialog auto-denied, separate from constitution)
- `opencode.json`: MCP `adm-rag` server configured
- Codegraph MCP auto-injected when index present

---

## 6. Working Tree State

Clean. All changes committed and pushed to `Local_Development` branch.
