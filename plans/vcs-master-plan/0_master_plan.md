# VCS Snapshot Backend — Master Plan

## Goal

Replace the current git-based snapshot system (`src/snapshot/index.ts`) with a standalone VCS backend that provides real-time working copy tracking, undo/redo, and session-level rollback — completely independent from the project's git repository.

## Current State (2026-07-03)

### What Exists

| Component | Status | Notes |
|---|---|---|
| Git snapshot (`index.ts`) | ACTIVE (fallback) | Works, but tightly coupled to git |
| jj backend (`jj.ts`) | Code exists, NOT working | `jj debug init-simple` hidden/experimental, binary path issues |
| Fossil backend (`fossil.ts`) | Code exists, NOT working | Wrong binary path, wrong command flags (fixed but untested) |
| TUI indicator | Code exists, NOT working | Shows "git" always — doesn't detect fossil/jj state |
| `.gitignore` translation | Code exists, untested | `.gitignore` → Fossil ignore-glob converter |
| DB schema `op_id` | Added to `session.sql.ts` + `session.ts` | Ready for use |

### What Went Wrong

1. **jj colocated mode** — leaked snapshots into git, created detached HEAD
2. **jj standalone** — `jj init` blocked by existing `.git`, workspace add failed
3. **jj native backend** — `jj debug init-simple` is hidden/experimental in v0.28
4. **jj scanning paralysis** — `jj status` scanned 5000+ files, froze the system
5. **Fossil binary path** — hardcoded to `Global.Path.home + "external/fossil/fossil.exe"`, doesn't resolve in test projects
6. **Fossil command flags** — used git-style flags (`--name-only`, `--rev`, `--stat`) that don't exist in fossil
7. **Fossil output parsing** — used `uuid:` regex instead of `hash:`
8. **No integration tests** — all fixes were untested before "shipping"

## Architecture Decision: Fossil > jj

| Criterion | jj | Fossil | Winner |
|---|---|---|---|
| Binary size | ~25MB (Rust) | ~4MB (C) | Fossil |
| Dependencies | None | None | Tie |
| Native backend | Experimental/hidden | Production-ready | Fossil |
| Storage format | `.jj/` directory tree | Single `.fsl` SQLite file | Fossil |
| Git independence | Partial (git backend default) | Complete | Fossil |
| Undo | `jj op restore` | `fossil update` + `fossil undo` | Fossil |
| Ignore format | Respects `.gitignore` | Own glob format (translator needed) | jj |
| Stability | Young, breaking changes | 20+ years, SQLite ecosystem | Fossil |
| Built-in features | VCS only | VCS + wiki + bug tracker + web UI | Fossil |
| Windows support | Good | Good | Tie |

**Decision: Fossil is the primary backend. jj remains as alternative.**

## Sub-Plans

### Plan 1: Binary Discovery (`1_binary-discovery.md`)
**Problem:** Fossil binary path hardcoded, doesn't work across projects.
**Solution:** Multi-location search with fallback chain.

### Plan 2: Command Validation (`2_command-validation.md`)
**Problem:** Wrong flags, wrong output formats, untested commands.
**Solution:** Integration test suite that validates every fossil command.

### Plan 3: Ignore Translation (`3_ignore-translation.md`)
**Problem:** `.gitignore` format differs from Fossil glob format.
**Solution:** Tested translator with edge case coverage.

### Plan 4: Init Lifecycle (`4_init-lifecycle.md`)
**Problem:** Self-healing init has multiple failure modes.
**Solution:** Robust init sequence with state machine.

### Plan 5: Track & Snapshot (`5_track-snapshot.md`)
**Problem:** File tracking and snapshot flow untested end-to-end.
**Solution:** Test-driven implementation with real fossil operations.

### Plan 6: Rollback & Undo (`6_rollback-undo.md`)
**Problem:** Session-level rollback via `op_id` untested.
**Solution:** Verify `fossil update <hash>` and `fossil undo` work correctly.

### Plan 7: TUI Integration (`7_tui-integration.md`)
**Problem:** Indicator doesn't detect active backend.
**Solution:** Check for `.fsl` checkout marker, not just `.fossil` file.

### Plan 8: Migration from jj (`8_migration-cleanup.md`)
**Problem:** jj.ts still exists, runtimes still import it.
**Solution:** Clean migration path with git snapshot as ultimate fallback.
