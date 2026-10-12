@echo off
rem E2E oracle for the learned wire-param gate (plan 2026-10-12_model-wire-param-gate).
rem Project = this script's stand/ directory; config dir carries the stub provider.
cd /d "%~dp0stand"
set OPENCODE_CONFIG_DIR=%~dp0config
set STUBWIRE_API_KEY=stub
bun run D:\zPython\opencode\packages\opencode\src\index.ts run "Reply with exactly: PONG" -m stubwire/glm-stub
echo EXIT=%ERRORLEVEL%
