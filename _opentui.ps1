# _opentui.ps1
# ───────────────────────────────────────────────────────────
# OpenTUI build: Zig native lib + TypeScript packages.
# Dot-source into _build.ps1 or run standalone:
#   . .\_opentui.ps1
#   Invoke-OpenTuiBuild
#   Invoke-OpenTuiBuild -Full
# ───────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

function Write-Success {
    param([string] $Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════════
# OPENTUI BUILD
# ═══════════════════════════════════════════════════════════
#
# packages/opentui/scripts/ is monorepo tooling (link/publish/clean).
# Real compile is packages/opentui/packages/*/scripts/build.ts:
#   core:  build:native (Zig → opentui.dll) + build:lib (TS → dist/)
#   solid / three: bun scripts/build.ts
#
# Always rebuild OpenTUI before opencode compile so dist ships current
# sixel/Image TS+Zig fixes.
# ───────────────────────────────────────────────────────────
function Invoke-OpenTuiBuild {
    param(
        [string] $Root = $PSScriptRoot,
        [switch] $Full = $false
    )

    $OpenTuiRoot = Join-Path $Root "packages\opentui"

    if (-not (Test-Path $OpenTuiRoot)) {
        throw "OpenTUI root not found: $OpenTuiRoot"
    }

    if ($Full) {
        Write-Host "  Building OpenTUI (full monorepo: core+zig+lib, solid, three, …)..." -ForegroundColor Yellow
        Push-Location $OpenTuiRoot
        try {
            bun run build
            if ($LASTEXITCODE -ne 0) {
                throw "OpenTUI monorepo build failed (exit $LASTEXITCODE)"
            }
        } finally {
            Pop-Location
        }
        Write-Success "OpenTUI full monorepo build complete"
        return
    }

    # Packages required by packages/opencode (workspace:*):
    #   @opentui/core, @opentui/solid, @opentui/three
    $coreDir = Join-Path $OpenTuiRoot "packages\core"
    $solidDir = Join-Path $OpenTuiRoot "packages\solid"
    $threeDir = Join-Path $OpenTuiRoot "packages\three"

    Write-Host "  Building OpenTUI core (Zig native + TypeScript lib)..." -ForegroundColor Yellow
    Push-Location $coreDir
    try {
        # build = build:native && build:lib  (packages/core/package.json)
        bun run build
        if ($LASTEXITCODE -ne 0) {
            throw "OpenTUI core build failed (exit $LASTEXITCODE) - zig and/or TS lib"
        }
    } finally {
        Pop-Location
    }
    Write-Success "OpenTUI core rebuilt (opentui.dll + dist/)"

    Write-Host "  Building OpenTUI solid..." -ForegroundColor Yellow
    Push-Location $solidDir
    try {
        bun run build
        if ($LASTEXITCODE -ne 0) {
            throw "OpenTUI solid build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
    Write-Success "OpenTUI solid rebuilt"

    Write-Host "  Building OpenTUI three..." -ForegroundColor Yellow
    Push-Location $threeDir
    try {
        bun run build
        if ($LASTEXITCODE -ne 0) {
            throw "OpenTUI three build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
    Write-Success "OpenTUI three rebuilt"

    $dll = Join-Path $OpenTuiRoot "packages\core-win32-x64\opentui.dll"
    if (-not (Test-Path $dll)) {
        throw "opentui.dll missing after core build: $dll"
    }
    Write-Success "OpenTUI native DLL present ($dll)"
}
