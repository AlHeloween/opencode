@echo off
cd /d "%~dp0..\..\packages\opencode"
bun run experiments/tui-image-rendering/smoketest-3d.tsx %*
