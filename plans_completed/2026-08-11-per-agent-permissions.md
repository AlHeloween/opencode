# Plan: Per-Agent Permissions in /permissions

## Goal
Add per-agent permission overrides to `DialogPermissions` — unified, keyboard-accessible.

## Premises
- [Exact] `ConfigAgent.Info` supports `permission: ConfigPermission.Info` (agent.ts:49)
- [Exact] `DialogPermissions` already has tool policies + directory rules with keyboard nav
- [Exact] `applyConfigPatch` writes to `config.json` atomically
- [Exact] `sync.data.config.agent` holds per-agent config from overlay

## Tasks

### T1: Add agent permission rows to DialogPermissions
- **What**: Insert a new "Agent Permissions" section between tool policies and directory rules
- **Files**: `dialog-navigation.tsx`
- **How**:
  1. Build agent-permission rows from `sync.data.config.agent` — one row per (agent, tool) where override exists
  2. Merge into `allRows` before directory rules
  3. Each row: `[——] build_mode · bash` or `[allow] build_mode · webfetch`
  4. ←→ cycle: `—— → ask → allow → deny → ——`
  5. `——` → add override (start at "ask"), cycling back to `——` → delete override
  6. Enter on `——` row → start override at "ask"
- **Smoke**: Open `/permissions`, verify agent section appears, cycle modes, save, verify config.json

### T2: Save per-agent permissions via applyConfigPatch
- **What**: Persist agent permission overrides to `config.agent[name].permission`
- **Files**: `dialog-navigation.tsx`
- **How**:
  1. On save, collect draft agent permission overrides
  2. Merge into `config.agent[name].permission` in patch
  3. Call `applyConfigPatch` — same path as tool policies
- **Smoke**: Set bash=deny for build_mode, save, verify config.json has agent.build_mode.permission.bash="deny"

### T3: Typecheck + verification
- **What**: `bun typecheck` passes, verify in TUI
- **Smoke**: typecheck clean, manual TUI smoke
