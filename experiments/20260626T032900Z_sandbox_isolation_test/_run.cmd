@echo off
:: Self-locating experiment runner — mirrors repo-root _run.cmd pattern.
:: Fresh .opencode/ DB in this directory, bun runs from packages/opencode.
:: All API keys cleared for zero-config sandbox isolation.
SET HF_TOKEN=
SET DEEPSEEK_API_KEY=
SET OPENROUTER_API_KEY=
SET STREAMLAKE_API_KEY=
SET OPENCODE_TEST_CONFIG=%~dp0
SET OPENCODE_CONFIG_DIR=%~dp0
SET OPENCODE_DB=%~dp0\.opencode\data\opencode.db
cd /d %~dp0
bun run --cwd %~dp0..\..\packages\opencode --conditions=browser src/index.ts %~dp0
