# Runtime Path And Account DB Cleanup

**Status:** completed
**Created:** 2026-06-07
**Completed:** 2026-06-08

## Goal

Keep runtime data out of copied executable `bin` folders, route project data to the requested portable project directory, and remove the experimental console-account SQLite side database.

## Rationale

- Portable bundles launched from a directory with `bin\\opencode.exe` must store project data under that launch directory, not under the executable directory or a parent repository.
- `auth.json` remains executable-adjacent configuration, but project data belongs in `{worktree}\\.opencode\\data\\opencode.db`.
- The experimental console account route does not need a persistent local SQLite side database.

## Tasks

### [x] Runtime paths

- Default pre-worktree `Global.Path.data`, `cache`, `state`, `log`, and `bin` to the launch working directory.
- Preserve executable-adjacent `Global.Path.config`.
- Treat local project DB/config files as project boundaries before walking to parent git roots.
- Treat `dir\\bin\\opencode.json` and `dir\\bin\\opencode.jsonc` as a boundary for portable bundles launched from `dir`.
- Use stable path-derived project IDs for non-git/no-commit fallback projects.
- Preserve normal git-root discovery for subdirectories without local opencode boundaries.

### [x] Account DB removal

- Remove config-level SQLite `account.db` helpers.
- Delete unused opencode account/account_state SQLite schema definitions.
- Replace opencode `AccountRepo` SQLite persistence with process-local in-memory state.

### [x] Build and runtime verification

- Fix `_build.ps1` PowerShell 5 path joins so the portable bundle build completes.
- Verify fresh portable launch uses `bin_tst\\tst3\\.opencode\\data\\opencode.db` and creates no `bin\\account.db`.
- Verify restore-oriented relaunch reuses project ID `c0e7496c66ae89d0c28c5d036a623b3f356c7761` and the same project DB.

## Verification

- [x] `bun test --timeout 30000 test/project/project.test.ts` passes from `packages/opencode` (38 pass; `cmd_runner` run `20260607T172739Z_0b43b725`).
- [x] `bun test --timeout 30000 test/global.test.ts` passes from `packages/core` (1 pass; `cmd_runner` run `20260607T095003Z_a1f469e3`).
- [x] `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts` passes from `packages/opencode` (26 pass; `cmd_runner` run `20260607T143800Z_18177818`).
- [x] `bun test --timeout 30000 test/server/httpapi-experimental.test.ts` passes from `packages/opencode` (3 pass, 1 skip; `cmd_runner` run `20260607T143800Z_6e017afb`).
- [x] `bun typecheck` passes from `packages/opencode` (`cmd_runner` run `20260607T143800Z_421139e7`).
- [x] `bun typecheck` passes from `packages/opencode` after the portable boundary fix (`cmd_runner` run `20260607T172739Z_642b7319`).
- [x] `pwsh _build.ps1` passes from repo root and produces version `10.0.98` (`cmd_runner` run `20260607T172921Z_c0f5d996`).
