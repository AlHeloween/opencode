@echo off
:: Graphics oracle for the re-based opentui lib (2026-09-21). SECOND revision.
::
:: WHY the first revision was wrong: `packages/opencode/src/storage/db.ts:19` states the project
:: DB is ALWAYS `{worktree}/.opencode/data/opencode.db` and the worktree comes from the cwd — so
:: the `--cwd %~dp0..\..\packages\opencode` launcher (copied from palette-hint, itself copied from
:: the TDA sandbox) made the worktree the REPO and the sandbox opened the developer's real DB.
:: `OPENCODE_DB` did not save it: it maps to `paths.dbPath` (config.ts:1240), not to the project DB.
::
:: This revision runs the same SOURCE entry point with the cwd inside `wc\`, a throwaway git repo,
:: so the worktree — and therefore the database, the fossil chain and the git state — is the
:: sandbox's own. Modules still resolve from the real package (absolute script path).
SET OPENCODE_TEST_CONFIG=%~dp0
SET OPENCODE_CONFIG_DIR=%~dp0
SET OPENCODE_DB=%~dp0wc\.opencode\data\opencode.db
if not exist "%~dp0wc\.git" (
  git init -q "%~dp0wc"
  git -C "%~dp0wc" config user.email "oracle@local"
  git -C "%~dp0wc" config user.name "oracle"
)
cd /d %~dp0wc
bun run --conditions=browser %~dp0..\..\packages\opencode\src\index.ts %*
exit /b %ERRORLEVEL%
