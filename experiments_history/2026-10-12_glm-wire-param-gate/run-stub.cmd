@echo off
rem E2E oracle for the learned wire-param gate (plan 2026-10-12_model-wire-param-gate).
rem Self-contained: config/opencode.jsonc and stand/.opencode/gateway.jsonc are materialized
rem from the committed *.skeleton twins (the repo's .gitignore hides those exact names
rem everywhere, so only the skeletons are tracked).
rem A missing stand/ or skeleton is a HARD STOP: falling through would run opencode in a
rem FOREIGN cwd and write into the wrong project's database (measured 2026-10-12).
cd /d "%~dp0stand" || (echo FAIL: %~dp0stand missing & exit /b 1)
if not exist "%~dp0config" mkdir "%~dp0config" >nul
if not exist "%~dp0config\opencode.jsonc" copy /Y "%~dp0config\opencode.jsonc.skeleton" "%~dp0config\opencode.jsonc" >nul
if not exist "%~dp0config\opencode.jsonc" (echo FAIL: config/opencode.jsonc.skeleton missing & exit /b 1)
if not exist "%~dp0stand\.opencode" mkdir "%~dp0stand\.opencode" >nul
if not exist "%~dp0stand\.opencode\gateway.jsonc" copy /Y "%~dp0stand\gateway.jsonc.skeleton" "%~dp0stand\.opencode\gateway.jsonc" >nul
if not exist "%~dp0stand\.opencode\gateway.jsonc" echo WARN: gateway.jsonc.skeleton missing — wire capture off
set OPENCODE_CONFIG_DIR=%~dp0config
set STUBWIRE_API_KEY=stub
bun run D:\zPython\opencode\packages\opencode\src\index.ts run "Reply with exactly: PONG" -m stubwire/glm-stub
echo EXIT=%ERRORLEVEL%
