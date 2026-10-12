@echo off
rem Live smoke for the seeded rung (plan 2026-10-12_model-wire-param-gate, S9):
rem real zen/go GLM-5.3-Flash through the repo's own auth config.
cd /d "%~dp0stand"
set OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
bun run D:\zPython\opencode\packages\opencode\src\index.ts run "Reply with exactly: PONG" -m opencode-go/glm-5.3-flash
echo EXIT=%ERRORLEVEL%
