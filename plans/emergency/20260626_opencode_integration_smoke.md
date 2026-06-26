# OpenCode Integration Smoke Test

**Created:** 2026-06-26
**Status:** Active
**Goal:** Verify basic functionality end-to-end in an isolated experiment before AGI loop testing.

## Steps

### Step 1 — Clean launch
- Copy `opencode.exe` + `opencode-markdownify.exe` to `experiments/YYYYMMDDTHHmmssZ_smoke/`
- `git init` in experiment dir
- Launch via `cmd_runner.exe start --cwd <exp_dir> -- opencode.exe`
- **Verify:** Model selected is a Zen free model (MiMo V2.5 Free or similar), NOT GLM

### Step 2 — Basic prompt
- Send: `2+2=?`
- **Verify:** Response contains `4`

### Step 3 — /DIRS command
- Send: `/DIRS`
- **Verify:** Shows allowed directories

### Step 4 — AGI loop (1 plan)
- Create `plans/essay_agi.md` with content: "Write an essay about AGI"
- Toggle AGI on via `<leader>g`
- Wait for orchestrator to process
- Toggle AGI off via `<leader>g`
- **Verify:** `opencode.db` has exactly **2 sessions** (main + orch)

### Step 5 — Add plan, re-run AGI
- Add `plans/story_ai_history.md` with content: "Write a story about AI history"
- Toggle AGI on via `<leader>g`
- Toggle AGI off via `<leader>g`
- **Verify:** `opencode.db` still has exactly **2 AGI sessions** (main + orch reused)
