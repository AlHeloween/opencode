@echo off
SET OPENCODE_TEST_CONFIG=D:\zPython\opencode\bin
SET OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
SET OPENCODE_DB=D:\zPython\opencode\.opencode\data\opencode.db

:: ── Increase Bun/JavaScriptCore heap limit ──────────────────
:: Default heap limit was causing segfaults under load.
:: forceRAMSize sets max heap in bytes (4 GB = 4 * 1024^3).
SET BUN_JSC_forceRAMSize=4294967296

cd /d D:\zPython\opencode
bun run --cwd packages/opencode --conditions=browser src/index.ts D:\zPython\opencode
