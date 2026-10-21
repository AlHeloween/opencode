@echo off
:: Palette-hint sandbox (2026-09-20).
::
:: Mirrors experiments/2026-09-19_tda-sandbox/_run.cmd, which is the KNOWN-GOOD launcher —
:: the first version here was `bun <abs path>\src\index.ts`, missing `--cwd` and
:: `--conditions=browser`, and it exited 1 with a blank window.
::
:: It runs the SOURCE tree, so the probe exercises exactly the working copy under test — no
:: deploy, no build of its own. Its OWN config dir and its OWN database keep the run out of the
:: developer's session and out of the real project DB.
SET OPENCODE_TEST_CONFIG=%~dp0
SET OPENCODE_CONFIG_DIR=%~dp0
SET OPENCODE_DB=%~dp0\.opencode\data\opencode.db
cd /d %~dp0
bun run --cwd %~dp0..\..\packages\opencode --conditions=browser src/index.ts %*
exit /b %ERRORLEVEL%
