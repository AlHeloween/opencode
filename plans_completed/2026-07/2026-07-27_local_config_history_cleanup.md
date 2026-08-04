# Local config ignore and unpushed-history cleanup

## Intent

Keep the root `config.json` as an untracked, local TUI configuration file. Stop
the runtime from reintroducing it to newly initialized project `.gitignore`
files. Remove the unpushed configuration-policy commit and the audit-artifact
commit while preserving their useful local files.

## Scope

- [x] Add root `config.json` to the repository `.gitignore`.
- [x] Extend the runtime `.gitignore` initializer to add `config.json` without
  treating another runtime ignore as sufficient.
- [x] Add focused tests for the initializer and idempotence.
- [x] Remove the tracked root `config.json` with `git rm --cached` after the
  ignore rule is staged; this preserves its local TUI contents and is required
  because the remote baseline tracks the file.
- [x] Rewrite only local commits after `origin/Local_Development` to omit
  `7cc916456c` and `a07fa63872f6a75273d85c01ccc2aa9f92f1eac9`, after creating
  a backup ref and proving neither commit is on a remote branch.
- [x] Copy the four audit artifacts to an ignored local location before the
  rewrite, then verify they remain present but untracked afterwards.

## Non-goals

- Do not alter system prompts, compaction behavior, provider policy, or any
  pushed commit.
- Do not delete the local config or diagnostic artifacts.

## Prior art

reuse: N/A — this is repository-local Git tracking and initializer behavior.

## Smoke Tests

### Baseline [Exact]

- CWD: `packages/opencode`
- `bun test test/project/gitignore.test.ts` — Actual [Exact]: exited 1 because
  the focused test file did not yet exist.
- `bun typecheck` — post-change type oracle.

### Post-implementation

- CWD: `packages/opencode`
- `bun test test/project/gitignore.test.ts` passes and proves `config.json`
  is appended once even when another runtime ignore already exists. The default
  entry is root-only `/config.json`; a pre-existing bare legacy entry is
  accepted without widening or rewriting the user's file.
- `bun typecheck` passes.
- From repository root, `git check-ignore -v config.json` resolves to the root
  `.gitignore`, and `git ls-files config.json` is empty while the local file
  remains present.

## Validation [Exact]

- `bun test ./test/project/gitignore.test.ts test/session/compaction.test.ts`:
  80/80 passed.
- `bun typecheck`: passed.
- The local `config.json` and all four audit artifacts match their ignored
  SHA-256 recovery copies; none is tracked.
