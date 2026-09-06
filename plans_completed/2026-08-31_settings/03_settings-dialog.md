# Subplan 03: Settings option — full interactivity (mouse + keyboard), gap = bug

plan_id: 2026-08-31-settings-03-dialog
state: IMPLEMENTED (2026-09-06, v1 — registry generated from schema + /settings dialog; TUI live check pending user rebuild)
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

## Prior art (REUSE.BEFORE)

- **In-repo dialog patterns** — `dialog-agent.tsx` `cycleScope` (scope ←/→ cycling, 9b73746feb); `dialog-select.tsx` onMouseUp/onMouseOver (:336-353) for mouse rows; `dialog-confirm.tsx` (subplan 01) for global writes; `dialog-feature-toggle.tsx` (subplan 05) for mode-parametrized toggle lists with Status chips; `app.tsx` command registration (pattern: agent.list :564-576).
- **Write plumbing (reuse, no new endpoints)** — session → `saveSessionSettings`; worktree → `PATCH /config` (subplan 05 rev 2 merge-patch; 02 rev 1: comment-preserving, null=delete); global → `PATCH /global/config` (subplan 01, DialogConfirm).
- **Registry source of truth** — `Config.Info` zod schema (config.ts ~:100-430) + `session-settings.ts` keys + env inventory (master.md group B). Coverage test mirrors the AGENTS.md policy: missing setting = bug.
- reuse: local — all five reusable surfaces already exist in-tree; no universalsearch needed for v1.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (record before any implementation edit)
| # | Command (cwd packages/opencode) | Expected before implementation | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `cmd_runner start -- bun run typecheck` | exit 0 (green start) | exit 0 — `20260906T040113Z_ed2f5d45` (02 final oracle, same tree before 03 edits) |
| 2 | NEW coverage policy test `test/tui/settings-registry.test.ts` (registry ids ⊇ schema top-level ∪ session-settings ∪ model.json keys) | FAIL — `settings/registry.ts` does not exist | FAIL `20260906T050742Z_6e9726d7`: `Cannot find module 'settings/registry'`, 0 pass |

### Post-implementation oracles
| # | Command (cwd packages/opencode) | Pass criteria | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | same coverage test | PASS — zero diff between registry ids and inventory surfaces | PASS `20260906T051424Z_54ceb85e`: 6 pass / 0 fail (395 asserts) |
| 2 | `cmd_runner start -- bun test --timeout 30000 test/server/httpapi-config.test.ts test/session/session-settings-persist.test.ts` | 0 fail (write plumbing unchanged) | PASS `20260906T051659Z_dd070ae1`: 30 pass / 0 fail |
| 3 | `cmd_runner start -- bun run typecheck` | exit 0 | PASS `20260906T051538Z_89722e74` |
| 4 | TUI live (user rebuild): `/settings` opens; scope row click/enter switches worktree↔global; boolean row toggles; global write fires DialogConfirm | observed on screen | (pending user rebuild — the only open oracle) |

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x] (oracle #4 = user-rebuild live check, intentionally left open)

## Implementation (landed 2026-09-06, v1)

- **`src/cli/cmd/tui/settings/registry.ts`** — rows GENERATED from `Config.Info.zod.shape` (coverage enforced by construction: a new schema field automatically gets a conservative read-only "json" row in group "Other" until curated), enriched by a curated map (groups from master inventory, titles, descriptions, kind overrides). Session rows from exported `SESSION_SETTINGS_KEYS`, model-state rows from `MODEL_STATE_KEYS` (new exports in session-settings.ts), env rows from `ENV_VARS` (master group B, incl. the `OPENCODE_MARKDOWN` pinned true-default note).
- **`test/tui/settings-registry.test.ts`** — the POLICY test: zero diff vs schema top-level ∪ session-settings ∪ model.json keys; env inventory spot-checks + read-only invariant; structural row invariants. Runs in 3.9s, no TUI harness needed (pure module).
- **`component/dialog-settings.tsx`** — DialogSelect over registry rows (category = group, footer = current value preview + "enter to edit"), scope ROW at top (click OR enter — mouse and keyboard share one affordance, no new keybinds): worktree ↔ global; global writes → DialogConfirm (subplan 01 policy) → GET global → set field → `PATCH /global/config`; worktree writes → minimal `PATCH /config` subtree (05 rev 2). Boolean = toggle, enum = sub-select, string/number = DialogPrompt. json/env/session/model-state rows: read-only value preview + pointer hint.
- **`app.tsx`** — command `settings.dialog` (slash `/settings`, category Agent).
- **v1 boundaries (documented, not bugs):** object/array config rows are viewable + hint to edit the file (in-place JSON-object editing = future widget); session/model-state rows are pointers to their owning dialogs (/agents, /model); TUI null-wiring for global clears (server capability exists since 02) = follow-up. Keybinds TUI editor (config.keybinds) NOT in v1 — remains the one unclosed gap-closure bullet below.

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
