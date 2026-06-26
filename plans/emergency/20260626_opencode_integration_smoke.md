# OpenCode Integration Smoke Test

**Created:** 2026-06-26
**Status:** Active
**Goal:** Verify basic functionality end-to-end in an isolated sandbox experiment with source-level stack traces (bun run).

## Infrastructure

- **Experiment dir:** `experiments/20260626T032900Z_sandbox_isolation_test/`
- **Launcher:** `_run.cmd` — self-locating via `%~dp0`, clears all API keys, runs from source
- **Launch:** `.\cmd_runner.exe start --shell cmd --cwd <exp_dir> -- _run.cmd`
- **Send input (two-step, required):**
  1. `.\cmd_runner.exe send <run_id> -- "<text>"` — types into prompt
  2. `.\cmd_runner.exe send <run_id> --keys "ENTER"` — executes
- **Close dialog:** `.\cmd_runner.exe send <run_id> --keys "ESC"`
- **Toggle AGI:** `.\cmd_runner.exe send <run_id> --keys "ctrl+x,g"`
- **Why bun run:** exact line numbers in stack traces, no build step, source changes take effect immediately

## Steps

### Step 1 — Clean launch
- `cmd_runner.exe start --shell cmd --cwd experiments/20260626T032900Z_sandbox_isolation_test -- _run.cmd`
- **Verify:** Model selected is a Zen free model (Big Pickle OpenCode Zen), NOT DeepSeek/GLM/HF
- **Verify:** No "bug:" entries in `.opencode/data/log/`

### Step 2 — Basic prompt
- `cmd_runner.exe send <run_id> -- "2+2=?"`
- `cmd_runner.exe send <run_id> --keys "ENTER"`
- **Verify:** Response contains `4`

### Step 3 — /dirs command
- `cmd_runner.exe send <run_id> -- "/dirs"`
- `cmd_runner.exe send <run_id> --keys "ENTER"`
- **Verify:** Directory Navigation dialog opens — shows allowed directories, no crash
- `cmd_runner.exe send <run_id> --keys "ESC"` (close dialog)

### Step 4 — /editor command
- `cmd_runner.exe send <run_id> -- "/editor"`
- `cmd_runner.exe send <run_id> --keys "ENTER"`
- **Verify:** Editor opens (or investigate why not)

### Step 5 — AGI loop (1 plan)
- Create `plans/essay_agi.md` in experiment dir with content: "Write an essay about AGI"
- `cmd_runner.exe send <run_id> --keys "ctrl+x,g"` (toggle AGI on)
- Wait for orchestrator to process
- `cmd_runner.exe send <run_id> --keys "ctrl+x,g"` (toggle AGI off)
- **Verify:** `opencode.db` has exactly **2 sessions** (main + orch)

### Step 6 — Add plan, re-run AGI
- Add `plans/story_ai_history.md` with content: "Write a story about AI history"
- `cmd_runner.exe send <run_id> --keys "ctrl+x,g"` (toggle AGI on)
- `cmd_runner.exe send <run_id> --keys "ctrl+x,g"` (toggle AGI off)
- **Verify:** `opencode.db` still has exactly **2 AGI sessions** (main + orch reused)
