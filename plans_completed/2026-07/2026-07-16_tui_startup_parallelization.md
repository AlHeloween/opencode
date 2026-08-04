# TUI Startup Parallelization Plan — 2026-07-16

**Status:** Completed — core work shipped; optional follow-ups deliberately not pursued
**Goal:** Reduce TUI cold-start time by parallelizing blocking boot-path operations.

### Landed

| Step | Status |
|------|--------|
| 1.1 Plugin theme sync parallel + sequential activate | Done |
| 1.3 Config load overlapped with worker / transport | Done — starts immediately after `chdir` |
| 1.4 `import("./app")` preload early | Done |
| 1.2 Session list parallel with project.sync | **Blocked** — needs worktrees; started after project, not on critical path |
| 2.3 Theme mode wait 1000→400ms | Done |
| 3.1 Critical vs deferred bootstrap | Done — `partial` after providers/agents/config/project; sessions apply next; LSP/MCP deferred to `complete` |

### Not pursuing (low benefit / quality risk)

| Step | Why parked |
|------|------------|
| 2.1 Plugin pre-flight cache | Stale-cache risk; only helps external-plugin heavy setups |
| 2.2 Config file cache | ~50–200ms; mtime false negatives on some FS |
| 2.4 Lazy non-critical providers | Complexity ≫ gain; providers already async onMount |
| 3.2 Stream sessions as they arrive | Needs API change; incomplete-list UX risk |

Reopen only with a measured cold-start bottleneck.

---

See earlier sections in git history for full bottleneck analysis. Implementation details live in:

- `packages/opencode/src/cli/cmd/tui/thread.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx`
- `packages/opencode/src/cli/cmd/tui/app.tsx`
