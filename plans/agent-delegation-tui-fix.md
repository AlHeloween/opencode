# Fix: Agent Delegation — global config + per-session subagents

## Status: Phase 1–2 DONE (2026-08-07); TUI display minimal

## Problem (clarified)

opencode binary serves **many worktrees**. Session files are worktree-local and do not conflict.
**Global** agent body (including `subagents`) is shared — changing it everywhere is uncomfortable.

Session already overrode **model/variant** only. Full agent (incl. `subagents`) always came from global `Agent.get()`.

## Done

### Phase 1 — Global config → runtime
- [x] `ConfigAgent` schema + `KNOWN_KEYS` include `subagents`
- [x] Agent merge: `item.subagents = value.subagents.map(canonicalIdentity)`
- [x] Test: config `subagents` merge + short-name canonicalization

### Phase 2 — Session override (worktree-local)
- [x] `SessionAgentOverride.subagents?: string[]`
- [x] Load/save in `session-settings.ts`
- [x] `effectiveSubagents(agent, global, settings)` — session wins when set
- [x] `task` tool gate loads session settings and enforces effective list
- [x] TUI: footer shows `task: N` via `local.model.subagentsFor`; `setSubagents` persists session-only

### Phase 3 — TUI edit UX
- [ ] Dialog to edit allow-list (optional)

## Priority for multi-project

Session file path: `{worktree}/.opencode/data/sessions/{sessionID}.jsonc`  
→ project A session subagents never touch project B.

Global config subagents still useful as intentional defaults; session overrides for isolation.
