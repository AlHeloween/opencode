# Isolated fossil undo smoke (product Snapshot path, no TUI).
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$pkg = Join-Path $root "packages\opencode"
Set-Location $pkg
bun script/fossil-undo-smoke.ts
exit $LASTEXITCODE
