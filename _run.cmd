@echo off
setlocal enabledelayedexpansion

SET OPENCODE_TEST_CONFIG=D:\zPython\opencode\bin
SET OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
SET OPENCODE_DB=D:\zPython\opencode\.opencode\data\opencode.db

:: Optional heap headroom (process-local only — not written to user registry).
:: Uncomment if you hit Bun OOM under heavy sessions.
:: SET BUN_JSC_forceRAMSize=8589934592

cd /d D:\zPython\opencode
bun run --cwd packages/opencode --conditions=browser src/index.ts D:\zPython\opencode
exit /b %ERRORLEVEL%
