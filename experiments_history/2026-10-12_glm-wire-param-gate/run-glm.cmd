@echo off
rem Live smoke for the seeded rung (plan 2026-10-12_model-wire-param-gate, S9):
rem real zen/go GLM-5.3-Flash through the repo's own auth config.
rem Hard stops: a missing stand/ or bin/ must not fall through into a foreign cwd.
cd /d "%~dp0stand" || (echo FAIL: %~dp0stand missing & exit /b 1)
if not exist "D:\zPython\opencode\bin\opencode.jsonc" (echo FAIL: repo bin config missing & exit /b 1)
set OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
bun run D:\zPython\opencode\packages\opencode\src\index.ts run "Reply with exactly: PONG" -m opencode-go/glm-5.3-flash
echo EXIT=%ERRORLEVEL%
