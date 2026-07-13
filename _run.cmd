@echo off
SET OPENCODE_TEST_CONFIG=D:\zPython\opencode\bin
SET OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
SET OPENCODE_DB=D:\zPython\opencode\.opencode\data\opencode.db

:: ── Increase Bun/JavaScriptCore heap limit ──────────────────
:: Default heap limit was causing segfaults under load.
:: Set to 8 GB (8 * 1024^3) to give more headroom.
SET BUN_JSC_maxHeapSize=8589934592

cd /d D:\zPython\opencode
bun run --cwd packages/opencode --conditions=browser src/index.ts D:\zPython\opencode
