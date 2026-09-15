@echo off
setlocal
pushd "%~dp0..\.."
bun run "experiments\tui-image-rendering\terminal-capabilities-probe.ts"
popd
