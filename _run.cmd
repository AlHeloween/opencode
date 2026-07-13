@echo off
setlocal enabledelayedexpansion

SET OPENCODE_TEST_CONFIG=D:\zPython\opencode\bin
SET OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
SET OPENCODE_DB=D:\zPython\opencode\.opencode\data\opencode.db

:: ── Diagnostics directory ───────────────────────────────────
SET DIAG_DIR=D:\zPython\opencode\.opencode\data\diag
if not exist "%DIAG_DIR%" mkdir "%DIAG_DIR%"

:: ── Increase Bun/JavaScriptCore heap limit ──────────────────
:: Default heap limit was causing segfaults under load.
:: forceRAMSize sets max heap in bytes (8 GB = 8 * 1024^3).
SET BUN_JSC_forceRAMSize=8589934592

:: ── Segfault / Crash Diagnostics ────────────────────────────
:: Enable JSC crash logging to stderr/file.
:: crashLogPath:        JSC writes fatal crash info here.
SET WEBKIT_CRASH_LOG=%DIAG_DIR%\webkit_crash.log

:: Enable Bun's internal crash reporter (produces .crashdump files).
SET BUN_ENABLE_CRASH_REPORTER=1
SET BUN_CRASH_REPORT_DIR=%DIAG_DIR%

:: JSC verbose garbage collection logging (uncomment for GC-debug).
:: SET JSC_collectContinuously=1
:: SET JSC_logGC=1

:: Force JSC to dump JIT code stats on crash (helps identify JIT-bug segfaults).
SET JSC_dumpJITDataOnCrash=1

:: Record VM state at crash time for post-mortem analysis.
SET WEBKIT_DUMP_VM_STATE=1
SET WEBKIT_VM_STATE_PATH=%DIAG_DIR%\vm_state.bin

:: ── Session / Run tracking ─────────────────────────────────
:: Generate a run ID so crash logs can be correlated with a specific launch.
:: Uses PowerShell for robust cross-shell timestamp generation (avoids wmic/find issues in mixed environments).
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') do set RUN_ID=%%I
set RUN_LOG=%DIAG_DIR%\run_%RUN_ID%.log
echo [%DATE% %TIME%] RUN_ID=%RUN_ID% starting... > "%RUN_LOG%"

:: ── Record process environment snapshot ─────────────────────
echo [ENV] BUN_JSC_forceRAMSize=%BUN_JSC_forceRAMSize% >> "%RUN_LOG%"
echo [ENV] BUN_ENABLE_CRASH_REPORTER=%BUN_ENABLE_CRASH_REPORTER% >> "%RUN_LOG%"
echo [ENV] WEBKIT_CRASH_LOG=%WEBKIT_CRASH_LOG% >> "%RUN_LOG%"
echo [ENV] WORKDIR=%CD% >> "%RUN_LOG%"
echo [ENV] PATH=%PATH% >> "%RUN_LOG%"

:: ── WER (Windows Error Reporting) local dump configuration ──
:: When opencode.exe crashes, WER writes a full heap dump to LocalDumps.
:: This captures the exact process state at segfault for post-mortem analysis (WinDbg, etc.).
reg query "HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\bun.exe" >nul 2>&1
if !ERRORLEVEL! neq 0 (
    echo [INFO] WER LocalDumps for bun.exe not configured. To enable:
    echo [INFO]   reg add "HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\bun.exe" /v DumpType /t REG_DWORD /d 2 /f
    echo [INFO]   reg add "HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\bun.exe" /v DumpFolder /t REG_EXPAND_SZ /d "%DIAG_DIR%\wer" /f
    echo [INFO]   reg add "HKLM\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\bun.exe" /v DumpCount /t REG_DWORD /d 5 /f
    echo [WARN] WER dumps not enabled >> "%RUN_LOG%"
) else (
    echo [INFO] WER LocalDumps already enabled for bun.exe >> "%RUN_LOG%"
)

:: ── Launch with crash wrapper ──────────────────────────────
cd /d D:\zPython\opencode

echo [%DATE% %TIME%] Launching: bun run --cwd packages/opencode --conditions=browser src/index.ts D:\zPython\opencode >> "%RUN_LOG%"

:: Capture START of execution timestamp for crash correlation
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMddHHmmss'"') do set START_DT=%%I

:: Run the actual command in a SUB-SHELL so a hard segfault doesn't kill the wrapper.
:: When bun crashes with STATUS_ACCESS_VIOLATION, it can take the parent cmd.exe down
:: with it before ERRORLEVEL is captured.  The `cmd /c` outer layer survives and records
:: the exit code for post-mortem analysis.
cmd /c "bun run --cwd packages/opencode --conditions=browser src/index.ts D:\zPython\opencode"
set EXIT_CODE=%ERRORLEVEL%

:: ── Post-mortem diagnostics ────────────────────────────────
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMddHHmmss'"') do set END_DT=%%I

echo [%DATE% %TIME%] Process exited with code=%EXIT_CODE% >> "%RUN_LOG%"
echo [META] START=%START_DT% END=%END_DT% >> "%RUN_LOG%"

:: Use goto labels instead of if ( ) else ( ) blocks — avoids delayed-expansion
:: parsing edge cases with nested parenthesized blocks in cmd.exe.
goto check_exit_%EXIT_CODE%_ 2>nul

:check_exit_0_
echo [OK] Clean exit. >> "%RUN_LOG%"
goto done

:: ── Abnormal exits ────────────────────────────────────────
:check_exit_1_
:check_exit_3_
echo [CRASH] Non-zero exit code %EXIT_CODE% detected. >> "%RUN_LOG%"
:: Exit code 3 from Bun can mean either:
::   1) JS runtime error (uncaught exception, invalid input)
::   2) Bun internal segfault caught by Bun's crash handler
::    The crash_archive section below checks for .crashdump / webkit_crash.log
::    to distinguish between these two cases.
goto crash_archive

:: STATUS_ACCESS_VIOLATION (0xC0000005 = -1073741819) — segfault
:check_exit_-1073741819_
echo [CRASH] Non-zero exit code %EXIT_CODE% detected. >> "%RUN_LOG%"
echo [SEGFAULT] STATUS_ACCESS_VIOLATION (0xC0000005) detected. >> "%RUN_LOG%"
echo [SEGFAULT] Check crash_%RUN_ID%.* files in %DIAG_DIR% for details. >> "%RUN_LOG%"
goto crash_archive

:: Catch-all for any other non-zero exit code
:check_exit_
echo [CRASH] Non-zero exit code %EXIT_CODE% detected. >> "%RUN_LOG%"
echo [CLASS] Unknown crash type (exit code %EXIT_CODE%) >> "%RUN_LOG%"
goto crash_archive

:crash_archive
:: Detect if Bun's crash reporter was triggered (Bun internal segfault).
set BUN_CRASH=0
if exist "%DIAG_DIR%\*.crashdump" set BUN_CRASH=1
if exist "%BUN_CRASH_REPORT_DIR%\*.crashdump" set BUN_CRASH=1
if "%EXIT_CODE%"=="3" (
    if exist "%WEBKIT_CRASH_LOG%" set BUN_CRASH=1
)

if %BUN_CRASH% equ 1 (
    echo [SEGFAULT] Bun internal crash detected (segfault caught by Bun crash handler) >> "%RUN_LOG%"
    :: Archive any crash dumps generated during this run
    if exist "%DIAG_DIR%\*.crashdump" (
        move /Y "%DIAG_DIR%\*.crashdump" "%DIAG_DIR%\crash_%RUN_ID%.crashdump" >nul 2>&1
        echo [CRASH] Crash dump archived: crash_%RUN_ID%.crashdump >> "%RUN_LOG%"
    )
    if exist "%BUN_CRASH_REPORT_DIR%\*.crashdump" (
        move /Y "%BUN_CRASH_REPORT_DIR%\*.crashdump" "%DIAG_DIR%\crash_%RUN_ID%.crashdump" >nul 2>&1
        echo [CRASH] Crash dump archived: crash_%RUN_ID%.crashdump >> "%RUN_LOG%"
    )
    :: Archive WebKit crash log if it has content
    if exist "%WEBKIT_CRASH_LOG%" (
        for %%F in ("%WEBKIT_CRASH_LOG%") do if %%~zF gtr 0 (
            copy /Y "%WEBKIT_CRASH_LOG%" "%DIAG_DIR%\crash_%RUN_ID%.webkit.log" >nul 2>&1
            echo [CRASH] WebKit crash log archived. >> "%RUN_LOG%"
        )
    )
    echo [SEGFAULT] Check crash_%RUN_ID%.* files in %DIAG_DIR% for details. >> "%RUN_LOG%"
    echo [SEGFAULT] Bun crash report URL may be available in stderr output. >> "%RUN_LOG%"
) else if "%EXIT_CODE%"=="3" (
    echo [CLASS] Bun runtime error (JS crash / uncaught exception / invalid input) >> "%RUN_LOG%"
) else if "%EXIT_CODE%"=="1" (
    echo [CLASS] Bun general error >> "%RUN_LOG%"
) else (
    echo [CLASS] Unknown crash type (exit code %EXIT_CODE%) >> "%RUN_LOG%"
)
echo [CRASH] Summary: bun exited with code %EXIT_CODE% at %DATE% %TIME% >> "%DIAG_DIR%\crash_summary.log"
goto done

:done
echo [%DATE% %TIME%] RUN_ID=%RUN_ID% finished. >> "%RUN_LOG%"

:: Trim old run logs (keep last 50)
for /f "skip=50 delims=" %%F in ('dir /b /o-n "%DIAG_DIR%\run_*.log" 2^>nul') do del "%DIAG_DIR%\%%F"

exit /b %EXIT_CODE%
