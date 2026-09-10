---
title: Session recovery from a moved worktree
last_verified: 2026-09-10
reproduce:
  files:
    - packages/opencode/src/session/recovery.ts
    - packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx
    - packages/opencode/src/project/database-fix.ts
  commands:
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun test test/session/recovery.test.ts
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun test test/project/database-fix.test.ts
    - cd packages/opencode && ..\\..\\tools\\adm.exe --cmd-runner start -- bun typecheck
  inputs: A previous worktree containing .opencode/data/opencode.db.
  expected_outputs: A selected root session is replayed in the current project with its directory and project ID rebased; explicit database fix remaps only selected stored path prefixes.
---

# Session recovery from a moved worktree

`/sessions` shows the path stored by every visible session and the current launch directory. Its first entry, **Recover from another worktree**, accepts the previous worktree path — the directory containing `.opencode/data/opencode.db`.

The dialog reads that database only to preview root sessions. Choosing one replays its ordered event stream into the current project database. The replay changes `projectID` and paths under the source worktree to the current directory, rejects a malformed stream or duplicate session ID, and leaves the source DB untouched.

`/restore` remains the edit-backup-file command.

## Repairing one moved portable database

Normal startup never rewrites stored session paths. If a whole worktree was moved together with `.opencode/data`, first exit every OpenCode process holding that database, enter the current worktree, then run:

```powershell
opencode db fix
```

The command opens `{cwd}/.opencode/data/opencode.db` in one explicit transaction. The target is always the current worktree. It reads the saved project root from that database and remaps only `project.worktree` and `session.directory` values under it; it does not delete project rows, change session IDs, or alter unrelated paths. For a database already opened by an older build that overwrote its project root, it falls back to one unambiguous saved session path. Multiple competing roots fail closed rather than guessing.
