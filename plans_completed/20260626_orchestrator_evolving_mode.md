# Orchestrator Enhancement: Evolving Mode + Git Integration

**Created:** 2026-06-26
**Status:** Tasks 1-4 DONE (2026-06-27)
**Goal:** Add evolving improvement mode, git auto-init, and branch-based plan iteration to orchestrator.

## Current State

The orchestrator (`orchestrator.txt`) is a pure strategist — read-only tools, observes main session, generates instructions. It has no git awareness, no self-improvement cycle, and plan completion is simple: `plans/` → `plans_completed/`.

## Requirements

### 1. Evolving Option
When enabled, after all active plans are completed, the orchestrator generates a new improvement plan covering 5 categories:
- **Stability** — error handling, crash recovery, edge cases
- **Performance** — bottlenecks, memory, caching, async patterns
- **Observability** — logging, metrics, tracing, debugging
- **Testing** — coverage, test quality, edge case tests
- **User Experience** — TUI responsiveness, error messages, discoverability

The orchestrator analyzes the codebase and proposes specific, actionable tasks in each category. The user can accept/reject categories.

### 2. Git Auto-Init
Before any work begins, if the worktree has no `.git` directory:
- Orchestrator instructs main session to run `git init`
- Create initial `.gitignore` if none exists
- Create initial commit with existing files

### 3. Branch-Based Plan Iteration
After all active plans are completed:
1. Create a new branch (e.g., `improvement/cycle-N`)
2. Generate the improvement plan on this branch
3. Execute the plan on the branch
4. If results are better (tests pass, metrics improve):
   - Merge back to main
5. If results are worse:
   - Keep branch for reference, stay on main

## Implementation

### Task 1: Extend orchestrator prompt
- [x] Add evolving mode instructions
- [x] Add improvement category descriptions
- File: `packages/opencode/src/agent/prompt/orchestrator.txt`

### Task 2: Add git auto-init logic
- [x] Before orchestrator loop starts, check for `.git/`
- [x] If missing, generate `git init` + `.gitignore` instruction
- File: `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`

### Task 3: Add branch-based workflow
- [x] After plan completion detected, create branch
- [x] Execute on branch, evaluate results
- [x] Merge or abandon based on outcome
- File: `packages/opencode/src/cli/cmd/tui/context/agi-mode.tsx`

### Task 4: Add evolving toggle to TUI
- [x] Toggle for "evolving mode" in AGI settings
- [x] Visual indicator when evolving mode is active
- File: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
