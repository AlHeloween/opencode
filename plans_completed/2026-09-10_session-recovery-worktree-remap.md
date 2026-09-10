---
intent: Recover sessions held in a portable OpenCode database after its project directory has moved, without copying a database by hand.
reproduce:
  files:
    - packages/opencode/src/project/project.ts
    - packages/opencode/src/session/session.ts
    - packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx
  commands:
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun test src/project/project.test.ts
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun typecheck
  inputs: An old worktree containing .opencode/data/opencode.db and a different current worktree.
  expected_outputs: The recovery flow lists the old sessions with saved and destination paths, then replays a selected session into the current project with its directory corrected.
---

# Session recovery after a worktree move

## Smoke Tests

- Baseline: the current portable-DB remap only operates after that DB is opened as the current project; an older independent data root is absent from `/sessions`.
- Post-change: a source root is validated before reading; its session preview exposes source and destination paths; recovering a session replays an ordered event stream into the current project with the destination directory, and rejects duplicate IDs.

| Task | Surface | Oracle |
|---|---|---|
| [x] | Read a selected portable DB as an explicit recovery source and replay one session safely into the current project. | Focused recovery unit tests |
| [x] | Extend `/sessions` with source-root input, path-aware preview, and explicit recovery action. | TUI typecheck plus recovery unit tests |
| [x] | Document the portable recovery path and record verification. | `bun typecheck` from `packages/opencode` |

## Constraints

- Never scan arbitrary disks or silently merge databases: the user supplies the prior worktree.
- Keep `/restore` for edit-backup files; recovery belongs in `/sessions`.
- The source database is read-only; only selected session events are replayed into the active project DB.
- Preserve existing automatic remap for a DB that traveled with the worktree.
