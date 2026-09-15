@echo off
setlocal
pushd "%~dp0..\..\packages\opencode"
bun run "..\..\experiments\tui-image-rendering\opentui-mermaid-sixel.ts"
popd
