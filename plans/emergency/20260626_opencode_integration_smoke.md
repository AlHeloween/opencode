# OpenCode Integration Smoke Test

**Created:** 2026-06-26
**Status:** Active
**Goal:** Verify basic functionality end-to-end in an isolated sandbox experiment with source-level stack traces (bun run).

## Infrastructure

- **Experiment dir:** `experiments/20260626T032900Z_sandbox_isolation_test/`
- **Launcher:** `_run.cmd` — self-locating via `%~dp0`, clears all API keys, runs from source
- **Launch:** `.\cmd_runner.exe start --shell cmd --cwd <exp_dir> -- _run.cmd`
- **Why bun run:** exact line numbers in stack traces, no build step, source changes take effect immediately

## Steps

### Step 1 — Clean launch
- `cmd_runner.exe start --shell cmd --cwd experiments/20260626T032900Z_sandbox_isolation_test -- _run.cmd`
- **Verify:** Model selected is a Zen free model (Big Pickle OpenCode Zen), NOT DeepSeek/GLM/HF
- **Verify:** No "bug:" entries in `.opencode/data/log/`

### Step 2 — Basic prompt
- Send: `2+2=?`
- **Verify:** Response contains `4`

### Step 3 — /dirs command
- Send: `/dirs`
- **Verify:** Agent Configuration dialog opens without crash (no TextNodeRenderable error)

### Step 4 — AGI loop (1 plan)
- Create `plans/essay_agi.md` in experiment dir with content: "Write an essay about AGI"
- Toggle AGI on via `<leader>g`
- Wait for orchestrator to process
- Toggle AGI off via `<leader>g`
- **Verify:** `opencode.db` has exactly **2 sessions** (main + orch)

### Step 5 — Add plan, re-run AGI
- Add `plans/story_ai_history.md` with content: "Write a story about AI history"
- Toggle AGI on via `<leader>g`
- Toggle AGI off via `<leader>g`
- **Verify:** `opencode.db` still has exactly **2 AGI sessions** (main + orch reused)
