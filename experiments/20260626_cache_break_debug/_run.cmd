@echo off
:: Cache-break debug sandbox — isolates opencode with fresh DB.
:: Traces system hash changes via checkSystemStability diff logging.
SET DEEPSEEK_API_KEY=
SET HF_TOKEN=
SET OPENROUTER_API_KEY=
SET STREAMLAKE_API_KEY=
SET OPENCODE_TEST_CONFIG=%~dp0
SET OPENCODE_CONFIG_DIR=%~dp0
SET OPENCODE_DB=%~dp0\.opencode\data\opencode.db
cd /d %~dp0
bun run --cwd %~dp0..\..\packages\opencode --conditions=browser src/index.ts %~dp0
