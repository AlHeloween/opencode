@echo off
:: TDA sandbox — mirrors the repo-root _run.cmd pattern, self-locating like
:: experiments_history/2026-06-26_sandbox-isolation/_run.cmd.
::
:: It runs the SOURCE tree (bun ... src/index.ts), so the sandbox exercises exactly the working
:: copy under test and never touches bin/ — no deploy, and the run needs no build of its own.
::
:: Its OWN config dir and its OWN database: the acquisition flag and the sandbox model must not leak
:: into the developer's session, and the rows it writes must not land in the real project DB.
::
:: Credentials are deliberately NOT cleared (unlike the isolation experiment): the sandbox has to
:: reach `opencode/qwen3.6-plus-free` — free, but still authenticated.
SET OPENCODE_TEST_CONFIG=%~dp0
SET OPENCODE_CONFIG_DIR=%~dp0
SET OPENCODE_DB=%~dp0\.opencode\data\opencode.db
cd /d %~dp0
:: No project positional. The launcher has already chdir'd into the experiment folder and the CLI reads
:: the project from the cwd — and passing the path TOGETHER WITH a subcommand made the CLI print usage
:: and exit 1 (measured 2026-09-19). So `%*` only: with no arguments this is still the interactive TUI.
bun run --cwd %~dp0..\..\packages\opencode --conditions=browser src/index.ts %*
exit /b %ERRORLEVEL%
