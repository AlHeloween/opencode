# Development Plan

## 2026-06-07 Runtime Path And Project DB Routing

Goal: keep runtime data out of copied executable `bin` folders, route project data to the requested project directory when it has local opencode state, and remove the experimental console-account SQLite side database.

Tasks:

- [x] Remove stale automatic cache-collapse and stream-stall control-flow work from the active plan surface.
- [x] Default pre-worktree `Global.Path.data/cache/state/log/bin` to the launch working directory instead of `process.execPath`'s directory.
- [x] Preserve executable-adjacent `Global.Path.config` for the current auth/config policy.
- [x] Treat directories with a local opencode project DB/config file as project boundaries before walking up to a parent git repository.
- [x] Treat `dir\\bin\\opencode.json` and `dir\\bin\\opencode.jsonc` as a boundary for portable bundles launched from `dir`.
- [x] Use stable path-derived project IDs for non-git/no-commit fallback projects instead of routing project data through `ProjectID.global`.
- [x] Preserve normal git-root discovery for subdirectories without local opencode boundaries.
- [x] Remove `account.db` creation by deleting config-level SQLite DB helpers.
- [x] Replace `AccountRepo` SQLite persistence with process-local in-memory state for experimental console account flows.
- [x] Remove unused opencode account/account_state SQLite schema definitions.
- [x] Fix `_build.ps1` PowerShell 5 path joins so the portable bundle build completes.

Verification:

- [x] `bun test --timeout 30000 test/project/project.test.ts` from `packages/opencode` (`cmd_runner` run `20260607T172739Z_0b43b725`).
- [x] `bun test --timeout 30000 test/global.test.ts` from `packages/core` (`cmd_runner` run `20260607T095003Z_a1f469e3`).
- [x] `bun test --timeout 30000 test/account/repo.test.ts test/account/service.test.ts` from `packages/opencode` (`cmd_runner` run `20260607T143800Z_18177818`).
- [x] `bun test --timeout 30000 test/server/httpapi-experimental.test.ts` from `packages/opencode` (`cmd_runner` run `20260607T143800Z_6e017afb`).
- [x] `bun typecheck` from `packages/opencode` (`cmd_runner` run `20260607T143800Z_421139e7`).
- [x] `bun typecheck` from `packages/opencode` after the portable boundary fix (`cmd_runner` run `20260607T172739Z_642b7319`).
- [x] `pwsh _build.ps1` from repo root passed and produced version `10.0.98` (`cmd_runner` run `20260607T172921Z_c0f5d996`).
- [x] Fresh portable launch from `bin_tst\\tst3` opened `bin_tst\\tst3\\.opencode\\data\\opencode.db` and created no `bin\\account.db` (`cmd_runner` run `20260607T173159Z_24d85141`).
- [x] Restore-oriented relaunch reused project ID `c0e7496c66ae89d0c28c5d036a623b3f356c7761` and the same project DB (`cmd_runner` run `20260607T173918Z_cb0a119e`).
