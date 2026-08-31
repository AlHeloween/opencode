# Subplan 03: Settings option — full interactivity (mouse + keyboard), gap = bug

plan_id: 2026-08-31-settings-03-dialog
state: PLANNED
parent: [master.md](master.md)
policy: "не только programable shortcuts, но и mouse"; "если хоть какие-то настройки отсутствуют там то это считается багом подлежащим исправлению" (Alexander, 2026-08-31)

## Abstract

A unified **Settings** surface in the TUI backed by a machine-readable settings REGISTRY. Every row of the master inventory (groups A–E) must be reachable, viewable and editable (where safe) in all three scopes (global/worktree/session; global → confirmation). Any setting present in the product but absent from the registry/dialog is a **bug**.

## Structure

```
SettingsRegistry (NEW, single source of truth)
  entry = { id, group, title, description, layers: ["global","worktree","session"],
            schemaRef, read(layer) → value, write(layer, value, confirm?),
            danger?: "global-confirm" }
  ← generated from config.ts Info schema + session-settings + model.json + env (read-only rows)
        ↓
SettingsDialog (NEW)
  groups ← registry.group            mouse: click rows (DialogSelect onMouseUp exists)
  scope footer ← ←/→ cycling         keyboard: ←/→ scope, ↑/↓ rows, enter edit
  edit widgets: boolean toggle / enum select / string input / model picker / path input
  global rows → DialogConfirm before write (reuse subplan 01 path)
```

## Registry rows (source of truth = master.md groups A–E)

Every row carries dependent-code refs from master.md (e.g. compaction ratios → session/compaction.ts; sandbox → bash validator; tool_output → tool runners; universal_search/sourcegraph → universalsearch backend). Env rows (group B) are **read-only display** + "which var to set" hint (runtime env is not writable in-place).

## Interaction contract

- Keyboard: full navigation without mouse (programable shortcuts preserved — keybinds remain in config.keybinds, keybind.tsx:19).
- Mouse: click to open/edit, click toggle, click scope arrows. dialog-select.tsx already handles onMouseUp/onMouseOver (lines 336-353) — new widgets must implement the same handlers.
- Scope: ←/→ cycles global/worktree/session (pattern: dialog-agent.tsx cycleScope, 9b73746feb); global writes → DialogConfirm (policy).
- Missing setting in the dialog = bug: acceptance test compares `Object.keys(Config.Info schema)` ∪ session-settings keys ∪ env inventory against registry ids — diff must be empty.

## Implementation sketch

1. `packages/opencode/src/cli/cmd/tui/settings/registry.ts` — typed registry built from the schema; unit test asserts coverage vs schema keys (the policy test).
2. Widgets on DialogSelect primitives (toggle = two options; enum = options; string = prompt input — reuse prompt input pattern).
3. Dialog entry: `/settings` command (app.tsx command list, pattern: agent.list at app.tsx:564-576).
4. Writes reuse existing plumbing: session → saveSessionSettings; worktree → model.json (local.tsx save()); global → PATCH /global/config (subplan 01). New fields beyond agent model/variant extend `Config.update`-style endpoints — server /config PATCH already exists (config.ts:24-33).
5. Read-only rows (env, feature gates) show value + source file:line.

## Test cases

1. **Coverage (policy test)**: registry ids ⊇ schema top-level fields ∪ session-settings ∪ model.json keys — zero diff.
2. Mouse: click a boolean row → toggles; click scope arrow → scope changes (TUI live test).
3. Keyboard-only pass: reach and edit a compaction ratio without mouse.
4. Global write of e.g. `share` → confirm dialog → global opencode.jsonc updated, comments intact (subplan 02 loader).
5. Unknown-layer write attempt → denied with explicit error (no silent cross-layer bleed).

## Known gaps this subplan CLOSES (each = bug per policy)

- provider CRUD, agent prompt/tools, pipelines, commands, skills/instructions, permissions persistence, sandbox, tool_output, compaction ratios, share, search backends, server, feature flags, experimental, paths, formatter/lsp, watcher.ignore, snapshot/diff_requests, plugin specs — all currently ❌ in the master table.
- Keybinds: no TUI editor (config.keybinds only).
- Env: no display surface.
