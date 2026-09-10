---
reproduce:
  files:
    - packages/opencode/src/cli/cmd/db.ts
    - packages/opencode/src/project/project.ts
    - packages/opencode/test/storage/db.test.ts
  commands:
    - tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/storage/db.test.ts
  inputs: portable project database relocated to a new worktree
  expected_outputs: startup does not rewrite session paths; opencode db fix explicitly remaps matching project and session paths
---

# Explicit portable database repair

## Context / goal

Make a relocated portable database repairable only by `opencode db fix`, rather than by normal startup. The command must update only paths below the selected old worktree, preserve unrelated rows, and report its work.

## Prior art (REUSE.BEFORE)

reuse: local `opencode db compact` command and `Project.remapWorktreePath()`.

## Implementation steps

- [ ] Record the existing storage test baseline.
- [ ] Add a tested database repair helper that validates and transactionally remaps project/session paths.
- [ ] Expose it as `opencode db fix`; remove startup-time session and project-identity rewriting.
- [ ] Document the explicit recovery workflow and run focused tests plus typecheck.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `tools/adm.exe --cmd-runner start --cwd packages/opencode -- bun test test/storage/db.test.ts` | pass | 2 pass / 0 fail (`20260910T133018Z_afa74dac`) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | focused project/storage tests through cmd_runner | 45 pass / 0 fail (`20260910T133357Z_209c5219`) |
| 2 | `bun typecheck` from `packages/opencode` through cmd_runner | pass (`20260910T133438Z_dd89435c`) |
| 3 | `pwsh -File _build.ps1` through cmd_runner | Windows build complete; packaged version smoke `10.0.958` (`20260910T133716Z_d50c5648`) |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-impl smoke passed before [x]
