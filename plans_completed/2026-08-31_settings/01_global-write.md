# Subplan 01: Global config write (editable global layer + confirmation)

plan_id: 2026-08-31-settings-01-global-write
state: IMPLEMENTED (2026-08-31)
parent: [master.md](master.md)

## Abstract

Global layer (Agent.Info config in `Global.Path.config/opencode.jsonc`) must be writable from the TUI. Every global write requires an explicit confirmation dialog (policy: applies to all projects). Path rule: **`Global.Path.config` is executable-adjacent in this fork — NOT `~/.config/opencode`** (AGENTS.md opencode Paths; forbidden action: switching to `os.homedir()`).

## Structure

```
TUI dialog (scope="global")
  → DialogConfirm (yes/no)                    dialog-confirm.tsx (NEW)
  → local.model.set / variant.set(scope="global")
  → sdk.client.global.config.get()            file-only read (config.ts:601 loadGlobal)
  → merge agent[name].{model|variant}         local.tsx writeGlobalAgentField
  → sdk.client.global.config.update({config})
  → PATCH /global/config                      global.ts:60-78 (handlers, were 501 stubs)
  → Config.updateGlobal                       config.ts:1072-1091
      patchJsonc(before, writableGlobal(cfg)) // comments survive (jsonc-parser)
      invalidate() → instances rebuild
```

## I/O

- Input: agentName, `{model?: "provider/model", variant?: string}`; confirmation result.
- Output: global opencode.jsonc gains `agent[name].model/variant`; toast shows the REAL path from `sdk.client.path.get()` → `config` field (instance.ts:159-168).
- Failure modes: invalid model → warning toast; clearing a global key → NOT possible via patchJsonc (set-only) → honest toast "edit the file" (documented gap); network/server error → warn log + no silent success.

## Implementation (landed)

- `global.ts:84-113` — real `configGet`/`configUpdate` handlers (were 501 stubs, global.ts:97-98); `ctx.payload as Config.Info` cast (decoded readonly → DeepMutable, config.ts:423 pattern).
- `local.tsx` — `writeGlobalAgentField(agentName, field)`; scope="global" branches in `model.set` (before batch; recents still update) and `variant.set` (undefined → clear-gap toast).
- `dialog-confirm.tsx` (NEW) — generic yes/no; no hardcoded `~/` paths in copy (AGENTS.md quiz 04:46 UTC: dialog text must not claim `~/.config/opencode`).
- `dialog-model.tsx` / `dialog-variant.tsx` — global branch replaces the dialog with DialogConfirm before write.

## Test cases

1. typecheck exit 0 — **PASS** (`20260831T050227Z_eae53937`).
2. Manual: /agents → scope → global → Change model → pick → confirm → global opencode.jsonc gains `agent.<name>.model`; toast path == `Global.Path.config`.
3. Comments in the global file survive the write (patchJsonc property — config.ts:1084).
4. Cancel → no write (DialogConfirm onCancel → return to dialog).
5. Known gap: variant "Default" in global scope → toast (no delete op) — future jsonc delete support (subplan 02 registry).
