# OpenCode Integration Smoke Test

**Created:** 2026-06-26
**Status:** Completed (2026-06-26)
**Goal:** Verify basic functionality end-to-end in an isolated sandbox experiment with source-level stack traces (bun run).

## Infrastructure

- **Experiment dir:** `experiments/20260626T032900Z_sandbox_isolation_test/`
- **Launcher:** `_run.cmd` — self-locating via `%~dp0`, clears all API keys, runs from source
- **Launch:** `.\cmd_runner.exe start --shell cmd --cwd <exp_dir> -- _run.cmd`
- **Send input (two-step, required):**
  1. `.\cmd_runner.exe send <run_id> -- "<text>"` — types into prompt
  2. `.\cmd_runner.exe send <run_id> --keys "ENTER"` — executes
- **Close dialog:** `.\cmd_runner.exe send <run_id> --keys "ESC"`
- **Toggle AGI:** `.\cmd_runner.exe send <run_id> -- "/agi"` then `ENTER`
- **Why bun run:** exact line numbers in stack traces, no build step, source changes take effect immediately

## Steps

### Step 1 — Clean launch
- [x] Launch from experiment dir
- [x] **Verify:** Model selected is Big Pickle OpenCode Zen
- [x] **Verify:** No "bug:" entries in `.opencode/data/log/`

### Step 2 — Basic prompt
- [x] Send `2+2=?`
- [x] **Verify:** Response contains `4`

### Step 3 — /dirs command
- [x] Send `/dirs`
- [x] **Verify:** Directory Navigation dialog opens, no crash
- [x] Bugs found & fixed: nested `<text>` crash (83c017aa), reactive proxy crash (5e9c4b05)

### Step 4 — /editor command
- [x] Send `/editor`
- [x] **Verify:** Silent failure — `$EDITOR`/`$VISUAL` unset in sandbox
- [x] Fix: added warning log, fixed `enabled()` check (aeedae39)

### Step 5 — AGI loop (1 plan)
- [x] Create `plans/essay_agi.md` in experiment dir
- [x] Toggle AGI on via `/agi`
- [x] **Verify:** 2 sessions created (main + orch)
- [x] Bugs found & fixed: badge stale (ea69e661, a7647eda), plan display 0/0 (5446c1c5), turn count reset (cd58bebb), max turns 20→100 (86fd6e61)

### Step 6 — Re-run AGI
- [x] Create `plans/story_ai_history.md`
- [x] Toggle AGI on, orch resumes existing session
- [x] **Verify:** Orchestrator processes both plans, AGI badge shows active state

## Bugs Found & Fixed During Smoke Test

| Commit | Bug |
|--------|-----|
| 7d2d2e4b | Memory leak: jobs Map + redundant .baselines |
| 2cb88058 | Sandbox: fs.up() unbounded directory walks |
| 5e9c4b05 | `/dirs`: dialog-navigation SolidJS reactive proxy crash |
| 83c017aa | `/dirs`: nested `<text>` inside `<text>` crash |
| aeedae39 | `/editor`: silent failure, `enabled()` didn't check `$EDITOR` |
| a7647eda | AGI: badge delayed during activation |
| ea69e661 | AGI: badge stale — module-level signal fix |
| 5446c1c5 | AGI: plan display 0/0 — planData not shared |
| cd58bebb | AGI: turn count not reset on new activation |
| 86fd6e61 | AGI: max turns 20→100, add 24h runtime limit |
| 82c841e8 | Tool: `skill` blocked during summary/compaction |
| d60994aeb | Orchestrator: task decomposition rule |
| e5ac5bb5 | Orchestrator: test specification enforcement |
| ce251c6d8 | Orchestrator: project organization conventions |
| — | Config leak: system env vars (`DEEPSEEK_API_KEY` etc.) cleared in `_run.cmd` |

## Test Infrastructure Built

- `experiments/20260626T032900Z_sandbox_isolation_test/_run.cmd` — self-locating sandbox launcher
- Sandbox isolation: no out-of-dir config, no env leak, no parent git walk
- cmd_runner send two-step pattern: `-- "<text>"` then `--keys "ENTER"`
- `plans/emergency/20260626_orchestrator_evolving_mode.md` — orchestrator enhancement plan (deferred)
