# Enforce `list` for directory and file browsing

## Context / goal

Prevent model-driven `bash`, `cmd`, and `run` tools from using shell
directory/file enumerators.
`list` is the only browsing tool; `glob` remains the pattern-matching tool and
`grep` remains the content-search tool. The restriction must be software
enforced in the shared shell preflight, including direct `run` execution.

## Prior art

reuse: N/A — the repository already centralizes hard shell blocks in
`Constitution.guardCommand()` and routes `bash`, `cmd`, and `run` through
`enforceDestructiveShell()`. Extend that shared enforcement point rather than
adding a provider-visible instruction.

## Implementation

- [x] Detect shell directory/file enumeration commands, including `ls`, `dir`,
      `Get-ChildItem`/`gci`, `tree`, POSIX `find`, `fd`, `rg --files`, and
      `git ls-files`; recognise `.exe`, PowerShell module-qualified, busybox,
      `cmd /c`, shell wrappers, Git option-wrapper forms, and `where /r`.
- [x] Detect simple shell glob enumeration (`echo *`, `printf … *`, POSIX
      `for … in *`, cmd `for /r`/`for … in (*)`, and PowerShell
      `Get-Item *`/`Resolve-Path *`).
- [x] Hard-block those commands before destructive permission handling, without
      an environment-variable bypass; return an actionable `list`/`glob`/`grep`
      alternative.
- [x] Preserve ordinary content search and non-enumerating commands.
- [x] Add Constitution-level regressions for POSIX, cmd, PowerShell, chained,
      and direct-binary forms; verify `bash`, `cmd`, and `run` share the gate.

## Scope boundary

- Included: direct model tool commands sent through `bash`, `cmd`, and `run`.
- Excluded: raw user-entered command execution, custom/MCP/plugin process
  runners, encoded/eval/variable payloads, and arbitrary embedded programs
  (`python -c`, `node -e`). Those are separate execution surfaces, not a safe
  target for command-text classification in this change.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `bun test test/session/constitution.test.ts` (`packages/opencode`) | pass | 15 pass, 0 fail |
| 2 | `bun typecheck` (`packages/opencode`) | pass | exit 0 |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | `bun test test/session/constitution.test.ts test/tool/shell-constitution.test.ts` (`packages/opencode`) | all existing and new shell-browsing blocks pass; shared preflight rejects before spawn |
| 2 | `bun typecheck` (`packages/opencode`) | exit 0 |
| 3 | `git diff --check` (repository root) | no whitespace errors |

### Actual post-implementation results [Exact]

- `bun test test/session/constitution.test.ts test/tool/shell-constitution.test.ts`:
  18 pass, 0 fail, 178 expectations.
- `bun typecheck` exited 0.
- `git diff --check` exited 0.

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-implementation smoke passed before completion
