@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Run source (default) or compiled binary with an isolated experiment worktree.
if not defined MODE set MODE=source
if not defined DURATION_SECONDS set DURATION_SECONDS=1800

set "EXP_DIR=%~dp0"
for %%P in ("%EXP_DIR%.") do set "EXP_DIR=%%~fP"
set "WORKTREE=%EXP_DIR%\..\.."
for %%P in ("%WORKTREE%") do set "WORKTREE=%%~fP"
set "DIAG_DIR=%EXP_DIR%\diag"
if not exist "%DIAG_DIR%" mkdir "%DIAG_DIR%"
set "BUN_EXE=%APPDATA%\npm\node_modules\bun\bin\bun.exe"
if not exist "%BUN_EXE%" goto missing_bun

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "RUN_ID=%%I"
set "RUN_LOG=%DIAG_DIR%\run_%RUN_ID%.log"
set "RUNNER_OUTPUT=%DIAG_DIR%\runner_%RUN_ID%.txt"
set "RUNNER_ID="
set "ELAPSED_SECONDS=0"

set "BUN_JSC_forceRAMSize=8589934592"
set "WEBKIT_CRASH_LOG=%DIAG_DIR%\webkit_crash.log"
set "BUN_ENABLE_CRASH_REPORTER=1"
set "BUN_CRASH_REPORT_DIR=%DIAG_DIR%"
set "JSC_dumpJITDataOnCrash=1"
set "OPENCODE_AUTO_HEAP_SNAPSHOT=1"
set "OPENCODE_SHOW_TTFD=1"

echo MODE=%MODE%
if /I "%MODE%"=="binary" goto start_binary

echo Launching source from %EXP_DIR%
"%WORKTREE%\tools\cmd_runner.exe" start --no-raw --cwd "%EXP_DIR%" -- "%BUN_EXE%" run --conditions=browser "%WORKTREE%\packages\opencode\src\index.ts" --log-level DEBUG --print-logs > "%RUNNER_OUTPUT%" 2>&1
goto capture_runner_id

:start_binary
echo Launching binary from %EXP_DIR%
"%WORKTREE%\tools\cmd_runner.exe" start --no-raw --cwd "%EXP_DIR%" -- "%EXP_DIR%\opencode.exe" --log-level DEBUG --print-logs > "%RUNNER_OUTPUT%" 2>&1

:capture_runner_id
for /f "tokens=1" %%I in ('findstr /r /b "[0-9][0-9][0-9][0-9]" "%RUNNER_OUTPUT%"') do if not defined RUNNER_ID set "RUNNER_ID=%%I"
if not defined RUNNER_ID goto missing_runner_id

set "RUNNER_DIR=%WORKTREE%\logs\cmd_runner\%RUNNER_ID%"
echo %RUNNER_ID% > "%DIAG_DIR%\runner_id.txt"
echo RUN_ID=%RUN_ID% RUNNER=%RUNNER_ID% MODE=%MODE% DURATION_SECONDS=%DURATION_SECONDS% > "%RUN_LOG%"
echo START_UTC=%DATE%T%TIME%>> "%RUN_LOG%"
for /f %%I in ('git -C "%WORKTREE%" rev-parse HEAD') do echo GIT_COMMIT=%%I>> "%RUN_LOG%"
if /I "%MODE%"=="binary" goto record_binary_version
"%BUN_EXE%" --version >> "%RUN_LOG%" 2>&1
goto wait_for_tui

:record_binary_version
"%EXP_DIR%\opencode.exe" --version >> "%RUN_LOG%" 2>&1

:wait_for_tui
echo Waiting for TUI to initialize (10 seconds)...
ping -n 11 127.0.0.1 >nul
echo Sending smoke interaction...
"%WORKTREE%\tools\cmd_runner.exe" send %RUNNER_ID% --text "/new" --crlf
ping -n 3 127.0.0.1 >nul
"%WORKTREE%\tools\cmd_runner.exe" send %RUNNER_ID% --text "hello" --crlf
echo Monitoring for %DURATION_SECONDS% seconds...

:monitor
"%WORKTREE%\tools\cmd_runner.exe" status %RUNNER_ID% 2>&1 | findstr /c:"status=running" >nul
if errorlevel 1 goto done
if %DURATION_SECONDS% GTR 0 if !ELAPSED_SECONDS! GEQ %DURATION_SECONDS% goto stop_runner
ping -n 6 127.0.0.1 >nul
set /a ELAPSED_SECONDS+=5
goto monitor

:stop_runner
echo Requested duration reached; stopping runner.
"%WORKTREE%\tools\cmd_runner.exe" stop %RUNNER_ID% --reason "diagnostic duration reached"
"%WORKTREE%\tools\cmd_runner.exe" wait %RUNNER_ID% --timeout 15000

:done
echo Capturing exit state...
type "%RUNNER_DIR%\state.json" 2>nul
copy /y "%RUNNER_DIR%\state.json" "%DIAG_DIR%\state_%RUN_ID%.json" >nul 2>nul
copy /y "%RUNNER_DIR%\stdout_text.log" "%DIAG_DIR%\stdout_%RUN_ID%.log" >nul 2>nul
copy /y "%RUNNER_DIR%\stderr.log" "%DIAG_DIR%\stderr_%RUN_ID%.log" >nul 2>nul
echo END_UTC=%DATE%T%TIME%>> "%RUN_LOG%"
echo Full log: %RUNNER_DIR%\stdout_text.log
echo Diag dir: %DIAG_DIR%
exit /b 0

:missing_runner_id
echo ERROR: cmd_runner did not return a run ID.
type "%RUNNER_OUTPUT%"
exit /b 1

:missing_bun
echo ERROR: bun.exe was not found at "%BUN_EXE%".
exit /b 1
