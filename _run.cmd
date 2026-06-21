@echo off
SET OPENCODE_TEST_CONFIG=D:\zPython\opencode\bin
SET OPENCODE_CONFIG_DIR=D:\zPython\opencode\bin
SET OPENCODE_DB=D:\zPython\opencode\.opencode\data\opencode.db
cd /d D:\zPython\opencode
bun run --cwd packages/opencode --conditions=browser src/index.ts D:\zPython\opencode
