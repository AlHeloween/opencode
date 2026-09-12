---
state: COMPLETED
---

# Active agent model display sync

## Goal

An explicit global `/agents` model save for the active agent must set the model
used by the current session's next prompt, so the agent list and prompt status
do not show different choices because of an older session override. A running
turn remains pinned to its already-created request model.

## Tasks

| Task | Surface | Oracle |
|---|---|---|
| Synchronize active-agent global save into the session override | `packages/opencode/src/cli/cmd/tui/context/local.tsx` | [COMPLETION] focused TUI/session test and typecheck |
| Document the precedence behavior | workflow records | [COMPLETION] diff/read-back |

## Smoke Tests

- Baseline and post-change: `bun test test/tui/agent-selection.test.ts test/session/session-settings-persist.test.ts` from `packages/opencode` via `cmd_runner`.
- `bun typecheck` from `packages/opencode` via `cmd_runner`.

## Verification

- Baseline: 27 pass / 0 fail (`20260911T222134Z_ea066d0a`).
- Post-change: 29 pass / 0 fail (`20260911T222408Z_7b1f57e2`), including session-over-worktree precedence and settings read-back.
- `bun typecheck`: exit 0 (`20260911T222415Z_0a1f4f94`).
- Windows build: `10.0.973` (`20260911T222530Z_cc726959`). The executable-adjacent promotion is pending because the currently running `bin/opencode.exe` holds its file lock.
