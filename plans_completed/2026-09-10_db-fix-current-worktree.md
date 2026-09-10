---
reproduce:
  files:
    - packages/opencode/src/project/database-fix.ts
    - packages/opencode/src/project/project.ts
    - packages/opencode/src/cli/cmd/db.ts
  commands:
    - tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/project/database-fix.test.ts test/project/project.test.ts
  inputs: a moved portable database in the current worktree
  expected_outputs: opencode db fix derives the stored source path without user-supplied roots; startup preserves that evidence
---

# Current-worktree DB fix

## Context / goal

`opencode db fix` operates on the current worktree database. It must not require the user to remember either prior or target roots: the current root is `cwd`, and the repair source is inferred from the database.

## Prior art (REUSE.BEFORE)

reuse: `Project.fromDirectory()` portable database import, `ProjectDatabaseFix.run()`, and `remapWorktreePath()`.

## Implementation steps

- [ ] Record the current explicit-remap baseline.
- [ ] Preserve a relocated database's saved worktree root during normal startup.
- [ ] Infer the repair source from the preserved project root or one unambiguous session root; remove root flags from the CLI.
- [ ] Test normal and fallback inference, update documentation, and rebuild.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/project/database-fix.test.ts test/project/project.test.ts` | pass | 43 pass / 0 fail (`20260910T135402Z_b198fafc`) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | focused project tests through cmd_runner | 45 pass / 0 fail (`20260910T135706Z_c46f8f12`) |
| 2 | `bun typecheck` from `packages/opencode` through cmd_runner | pass (`20260910T135845Z_a5b9b441`) |
| 3 | `pwsh -File _build.ps1` through cmd_runner | Windows build complete; packaged version smoke `10.0.959` (`20260910T135910Z_e44d3191`) |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]
