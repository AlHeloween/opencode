# Master Plan: Remaining Items Cleanup

**Created**: 2026-06-19
**Purpose**: Finish all items left open across the autoupdate/telemetry removal and Reasonix enhancement plans.

**Grounded against**: 3 explore audits verifying actual code state vs. plan markers.

---

## Goal 1: Complete Autoupdate/Telemetry Removal Cleanup

**Abstract**: The core removal (CLI, server, desktop, config, flags) is complete. Remaining: web app UI stubs, i18n strings, OpenAPI schema, SDK regeneration, and documentation across 19 locales.

### Task 1.1: Web App Update UI Removal

**File(s)**: `packages/app/src/pages/layout.tsx`, `packages/app/src/components/settings-general.tsx`, `packages/app/src/components/platform.tsx`, `packages/app/src/components/error.tsx`

**Math**: These are dead UI paths — `Platform.checkUpdate()` / `updateAndRestart()` would call functions that no longer exist. Removing the UI eliminates stale user-visible controls.

**Input**: Current source files with autoupdate UI references.
**Output**: Source files with all autoupdate UI code excised. Typecheck passes.

| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/app/src/pages/layout.tsx` | Remove `useUpdatePolling()` function definition and its `useUpdatePolling()` invocation |
| [ ] | `packages/app/src/components/settings-general.tsx` | Remove `Check for updates on startup` toggle and `settings.updates.startup()` binding |
| [ ] | `packages/app/src/components/platform.tsx` | Remove `Platform.checkUpdate()` and `Platform.updateAndRestart()` method stubs |
| [ ] | `packages/app/src/components/error.tsx` | Remove update-related error case |

**Test**: `bun typecheck` from `packages/app/` passes.

### Task 1.2: i18n Updater String Removal

**Abstract**: Remove `desktop.updater.*` strings from Tauri (15 locales) and Electron renderer (15 locales) i18n files. Remove `toast.update.*` and `settings.updates.*` from app i18n files (19 locales).

**File count**: ~49 files. All changes are rote deletion of specific key blocks.

**Strategy**: Use `adm --patch-tool` or scripted `rg` + `edit` to remove the same key pattern from each locale file. Pattern per file type:

| File group | Keys to remove |
|------------|---------------|
| `packages/desktop/src/i18n/*.ts` | `desktop.updater.check`, `desktop.updater.downloading`, `desktop.updater.installing`, `desktop.updater.latest`, `desktop.updater.error` |
| `packages/desktop-electron/src/renderer/i18n/*.ts` | Same `desktop.updater.*` keys |
| `packages/app/src/i18n/*.ts` | `toast.update.available`, `toast.update.installed`, `settings.updates.startup` + label/description |

**Input**: 49 i18n files with updater string entries.
**Output**: 49 i18n files without updater string entries. No syntax errors.

**Test**: `bun typecheck` from `packages/desktop/`, `packages/desktop-electron/`, `packages/app/`.

### Task 1.3: OpenAPI Schema Cleanup

**Abstract**: Remove the `/global/upgrade` endpoint from `openapi.json` and the `installation.updated` / `installation.update-available` event schemas. Then regenerate SDK.

**File**: `packages/sdk/openapi.json`

**Changes**:
| [ ] | Change |
|-----|--------|
| [ ] | Remove `/global/upgrade` path block (lines ~161-232) |
| [ ] | Remove `installation.updated` event schema (find and remove) |
| [ ] | Remove `installation.update-available` event schema (find and remove) |
| [ ] | Remove any remaining `autoupdate` config property description |
| [ ] | Regenerate SDK: `bun run packages/sdk/js/script/build.ts` |

**Input**: `openapi.json` with stale upgrade/autoupdate paths.
**Output**: Clean `openapi.json` + regenerated `types.gen.ts` (v1), `types.gen.ts` (v2), `sdk.gen.ts` (v2).

**Test**: `bun run packages/sdk/js/script/build.ts` exits clean. `bun typecheck` from `packages/sdk/js/`.

### Task 1.4: Documentation Cleanup (19 Locales)

**Abstract**: Remove `autoupdate` configuration docs, `OPENCODE_DISABLE_AUTOUPDATE` flag docs, and `opencode upgrade` CLI docs from all locale documentation files.

**Files** (57 total):

| File pattern | What to remove | Locales |
|---|---|---|
| `packages/web/src/content/docs/**/config.mdx` | `autoupdate` config option (table row + description) | en, zh-tw, zh-cn, tr, th, ru, pt-br, pl, nb, ko, ja, it, fr, es, de, da, bs, ar (18 locales — en is root) |
| `packages/web/src/content/docs/**/cli.mdx` | `--disable-autoupdate` flag docs + `upgrade` command docs | 18 locales |
| `packages/web/src/content/docs/**/troubleshooting.mdx` | `opencode upgrade` reference | 18 locales |

**Strategy**: Each file needs 3-5 line-level deletions. Use scripted `edit` tool calls targeting the specific lines.

**Input**: 57 MDX documentation files with autoupdate/upgrade references.
**Output**: 57 MDX files without autoupdate/upgrade references.

**Test**: `rg -n 'autoupdate|OPENCODE_DISABLE_AUTOUPDATE|opencode upgrade' packages/web/src/content/docs/` returns zero matches.

---

## Goal 2: Reasonix Enhancement Gaps

**Abstract**: Close the three remaining gaps: compaction TUI toast, job SQLite persistence, task tool background integration.

### Task 2.1: CompactionNotice TUI Toast

**Abstract**: `Event.CompactionNotice` is defined and published when context reaches soft threshold (50%). The TUI should display a brief toast notification so the user knows compaction is approaching.

**Math**:

```
Event publish:  compactionTier() → "soft" → publish CompactionNotice{ sessionID, ratio, tier }
Event consume:   app.tsx useEffect → listen for CompactionNotice → render toast("Context at {ratio}% — compaction will trigger at 80%")
Toast lifetime:  5 seconds, auto-dismiss
Dedupe:          track last sessionID; skip if same session already showing toast
```

**Structural diagram**:
```
overflow.ts                     prompt.ts                    app.tsx
compactionTier()                publish()                    useEffect(listener)
  → "soft"                       CompactionNotice             → toast notification
  → "full"                       trigger compaction
  → "force"
```

**File**: `packages/opencode/src/cli/cmd/tui/app.tsx`

**Input**: `Event.CompactionNotice` publication from `prompt.ts:1377` (already wired).
**Output**: TUI renders a toast when `CompactionNotice` fires.

**Implementation**:
1. Import `Event.CompactionNotice` from `@/session/compaction`
2. Add `useEffect` subscription in the session component
3. On event, show ink toast: `"Context approaching compaction (XX%)"`
4. Guard: skip toast if one already showing for same session ID

**Test**: Unit test verifying subscription fires on event. Manual: trigger soft tier by setting `compaction.soft_ratio` to 0.1.

### Task 2.2: Job SQLite Persistence

**Abstract**: Background jobs currently live in an in-memory `Map<string, Job>`. On process restart or crash, job state is lost. Add a `job` SQLite table for durability.

**Math**:

```
Schema normalization:
  JobTable = (id: text PK, session_id: text FK, kind: text, label: text,
              status: text, output: text, result: text?,
              created_at: integer, finished_at: integer?)

On startEffect():
  1. INSERT INTO job (id, session_id, kind, label, status, created_at) VALUES (...)
  2. Fork fiber for work
  3. On completion: UPDATE job SET status='done'/'failed', output=..., result=..., finished_at=NOW

On drainCompletedNote():
  1. SELECT * FROM job WHERE session_id = ? AND status IN ('done', 'failed', 'killed')
  2. DELETE processed rows after draining
  3. Return formatted completion note

On recover (startup):
  1. SELECT * FROM job WHERE status = 'running'
  2. Mark all as 'killed' (orphaned jobs from prior process)
```

**Structural diagram**:
```
jobs/index.ts (in-memory Map)          session.sql.ts (schema)
         │                                      │
         │  startEffect()                         │  JobTable
         │    └── INSERT job                      │
         │    └── fiber.onComplete()              │  Migration:
         │         └── UPDATE job                 │    ALTER TABLE ADD migration
         │                                        │
         │  drainCompletedNote()                  │
         │    └── SELECT completed jobs            │
         │    └── DELETE drained jobs              │
         │
         └── recover(): markRunningAsKilled()
```

**Files**:
| [ ] | File | Change |
|-----|------|--------|
| [ ] | `packages/opencode/src/session/session.sql.ts` | Add `JobTable` with 9 columns |
| [ ] | `packages/opencode/src/jobs/index.ts` | Wire SQLite persistence into `startEffect`, `drainCompletedNote`, `list`, and add `recover()` |

**Input**: In-memory only job manager.
**Output**: SQLite-persisted job manager. Jobs survive process restart.

**Test**: 
- Start a job, kill process, restart — job marked as killed
- Start a job, let it complete, drain — row deleted after drain
- `bun test test/jobs/jobs.test.ts` continues to pass

### Task 2.3: Task Tool Background Integration

**Abstract**: The `task` tool currently runs sub-agents synchronously within the main agent loop. Add `run_in_background` flag to spawn sub-agent tasks via `Jobs.Service`, returning a job ID immediately.

**Math**:

```
On execute(task, { run_in_background: true }):
  job = yield* Jobs.Service.startEffect({
    sessionID,
    kind: "task",
    label: task.description,
    run: () => runSubAgent(task)  // returns Effect<string, Error>
  })
  return { output: `Task spawned as job ${job.id}. Use job_output(${job.id}) to read.` }

On execute(task, { run_in_background: false }):  // default
  // current synchronous behavior unchanged
```

**Structural diagram**:
```
task.ts                     jobs/index.ts             prompt.ts
execute()                   startEffect()             (next turn)
  ├─ bg: true               ├─ INSERT job              ├─ drainCompletedNote()
  │   └─ startEffect()      ├─ fork fiber              │   └─ <background-jobs>
  │       └─ return jobID   └─ fiber.onComplete()      │       task-5: done
  │                              └─ UPDATE job         │
  └─ bg: false                                           └─ injected into user msg
      └─ runSync()
```

**File**: `packages/opencode/src/tool/task.ts`

**Changes**:
1. Add `run_in_background: boolean` to task tool parameters (default: `false`)
2. When `true` and `Jobs.Service` is available: call `startEffect()`, return job ID
3. When `true` and `Jobs.Service` unavailable: throw descriptive error

**Input**: Task tool without background capability.
**Output**: Task tool with optional background execution via Jobs system.

**Test**:
- `run_in_background: false` — existing behavior unchanged
- `run_in_background: true` — returns job ID, job appears in `list()`, completion note injected next turn
- Incompatible with `subagent_type: "explore"` (explore has no reasoning — it must run synchronously for the primary to read results immediately)

---

## Goal 3: Plan Maintenance

### Task 3.1: Update Plan Document Markers

**Abstract**: Both `20260617_remove_autoupdate_telemetry.md` and `20260618_reasonix_enhancements.md` have stale `[ ]` markers. Update them to reflect actual completion state.

| [ ] | Plan File | Action |
|-----|-----------|--------|
| [ ] | `plans/20260617_remove_autoupdate_telemetry.md` | Mark tasks 1.1-1.7, 1.11, 2.1-2.9 as `[x]`. Leave 1.8, 1.9, 1.10, 1.12 as `[ ]` until this plan completes them. |
| [ ] | `plans/20260618_reasonix_enhancements.md` | Mark Goal 2 tasks 2.1-2.4 as `[x]`, 2.5 as `[ ]`. Mark Goal 3 tasks 3.2, 3.3, 3.5-3.9 as `[x]`, 3.1, 3.4 as `[ ]`. Add note: Goal 1 implemented via different architecture (inline diff). |
| [ ] | `_development_plan.md` | Add entries for 2026-06-17 autoupdate/telemetry removal, 2026-06-18 Reasonix enhancements, 2026-06-19 remaining items cleanup |

### Task 3.2: Move Completed Plans

**Abstract**: Move plans that are fully resolved to `plans_completed/`.

| [ ] | Plan | Status |
|-----|------|--------|
| [ ] | `plans/20260617_remove_autoupdate_telemetry.md` | Will be complete after Goal 1 of this plan |
| [ ] | `plans/20260618_reasonix_enhancements.md` | Will be complete after Goal 2 of this plan |
| [ ] | `plans/20260601_upstream_adoption_phase2.md` | Can move now — all resolvable items done, deferred items tracked elsewhere |

---

## Execution Order

1. **Phase A — Rote Cleanup (Goal 1)**: Tasks 1.1 → 1.2 → 1.3 → 1.4. These are removals only, no new code.
2. **Phase B — Feature Gaps (Goal 2)**: Tasks 2.1 → 2.2 → 2.3. These add new functionality.
3. **Phase C — Plan Maintenance (Goal 3)**: Update markers, move completed plans.

---

## Oracle Verification

| Check | Command |
|-------|---------|
| Typecheck (opencode) | `cd packages/opencode && bun typecheck` |
| Typecheck (core) | `cd packages/core && bun typecheck` |
| Typecheck (app) | `cd packages/app && bun typecheck` |
| Typecheck (desktop) | `cd packages/desktop && bun typecheck` |
| SDK generation | `bun run packages/sdk/js/script/build.ts` |
| Job tests | `cd packages/opencode && bun test test/jobs/jobs.test.ts` |
| Config tests | `cd packages/opencode && bun test test/config/config.test.ts` |
| Autoupdate residue | `rg -n 'autoupdate\|OPENCODE_DISABLE_AUTOUPDATE\|opencode upgrade' packages/web/src/content/docs/` — ZERO |
| OpenAPI residue | `rg -n 'global/upgrade\|installation\.update-available\|autoupdate' packages/sdk/openapi.json` — ZERO |

---

## Files Summary

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1.1 Web app UI | 0 | ~4 |
| 1.2 i18n strings | 0 | ~49 |
| 1.3 OpenAPI + SDK | 0 | ~4 |
| 1.4 Documentation | 0 | ~57 |
| 2.1 Compaction toast | 0 | 1 (`app.tsx`) |
| 2.2 Job persistence | 0 | 2 (`session.sql.ts`, `jobs/index.ts`) |
| 2.3 Task background | 0 | 1 (`task.ts`) |
| 3.1 Plan markers | 0 | 3 |
| **Total** | **0** | **~121** |
