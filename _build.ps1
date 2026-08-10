param(
    [ValidateSet("check", "build", "release")]
    [string] $Task = "build",

    [string] $Version = "",

    [switch] $SkipTests = $false,

    [switch] $SkipTypecheck = $false
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$DistDir = Join-Path $Root "dist"
$OpencodePkg = Join-Path (Join-Path $Root "packages") "opencode"

# ── Prerequisites (run separately before build) ──
#   python prompts_kernel/_assemble_prompts_kernel.py  # kernel assembly (optional)
#   .\_opentui.ps1                   — OpenTUI Zig+TS rebuild
#   .\_opentui.ps1 -Full             — full OpenTUI monorepo
#   .\_build_rust.ps1                — Rust WASM modules (also called by build task)

function Write-Step {
    param([string] $Message)
    Write-Host ""
    Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor White
    Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string] $Message)
    Write-Host "  [OK] $Message" -ForegroundColor Green
}

function Write-Error- {
    param([string] $Message)
    Write-Host "  [FAIL] $Message" -ForegroundColor Red
}

function Test-Command {
    param([string] $Name, [scriptblock] $Script)
    try {
        & $Script
        Write-Success "$Name passed"
        return $true
    } catch {
        Write-Error- "$Name failed"
        Write-Host $_ -ForegroundColor Red
        return $false
    }
}

function Get-Version {
    $pkgJson = Get-Content (Join-Path $OpencodePkg "package.json") -Raw | ConvertFrom-Json
    return $pkgJson.version
}

# ═══════════════════════════════════════════════════════════
# CHECK TASK — typecheck, tests, prettier only.
# Kernel assembly → python prompts_kernel/_assemble_prompts_kernel.py
# ═══════════════════════════════════════════════════════════
function Invoke-Check {
    Write-Step "Running Checks"

    $allPassed = $true

    # Clean up .temp/test/ directory
    $tempTestDir = Join-Path $Root ".temp\test"
    if (Test-Path $tempTestDir) {
        Write-Host "  Cleaning .temp/test/..." -ForegroundColor Yellow
        Remove-Item $tempTestDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success ".temp/test/ cleaned"
    }

    # Check 1: Typecheck
    if (-not $SkipTypecheck) {
        $allPassed = $allPassed -and (Test-Command "Typecheck" {
            Push-Location $OpencodePkg
            try {
                bun typecheck
            } finally {
                Pop-Location
            }
        })
    } else {
        Write-Host "  [-] Skipping typecheck (--skip-typecheck)" -ForegroundColor Yellow
    }

    # Check 2: Tests
    if (-not $SkipTests) {
        $allPassed = $allPassed -and (Test-Command "Tests" {
            Push-Location $OpencodePkg
            try {
                bun test
            } finally {
                Pop-Location
            }
        })
    } else {
        Write-Host "  [-] Skipping tests (--skip-tests)" -ForegroundColor Yellow
    }

    # Check 3: Prettier
    $prettierResult = bun run prettier --check "packages/opencode/src/**/*.ts" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Prettier failed"
        $allPassed = $false
    } else {
        Write-Success "Prettier passed"
    }

    if (-not $allPassed) {
        Write-Host ""
        Write-Host "Some checks failed. Fix the issues above and try again." -ForegroundColor Red
        exit 1
    }

    Write-Success "All checks passed"
}

# ═══════════════════════════════════════════════════════════
# BUILD TASK — compile opencode + collect artifacts.
# OpenTUI must be pre-built via _opentui.ps1.
# Kernel must be pre-assembled via python prompts_kernel/_assemble_prompts_kernel.py.
# ═══════════════════════════════════════════════════════════
function Invoke-Build {
    Write-Step "Building"

    # Clean up .temp/test/
    $tempTestDirBuild = Join-Path $Root ".temp\test"
    if (Test-Path $tempTestDirBuild) {
        Write-Host "  Cleaning .temp/test/..." -ForegroundColor Yellow
        Remove-Item $tempTestDirBuild -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success ".temp/test/ cleaned"
    }

    # Build Rust WASM modules
    Write-Host "  Building Rust WASM modules..." -ForegroundColor Yellow
    & "$PSScriptRoot\_build_rust.ps1"

    # Clean dist directory
    if (Test-Path $DistDir) {
        Remove-Item $DistDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $DistDir | Out-Null

    # Build opencode package (single-platform)
    # script/build.ts copies core-win32-x64/opentui.dll into node_modules for bun --compile
    Write-Host "  Building packages..." -ForegroundColor Yellow
    Push-Location $OpencodePkg
    try {
        bun run script/build.ts --single
        if ($LASTEXITCODE -ne 0) {
            throw "opencode script/build.ts failed (exit $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }

    # ── Collect artifacts ─────────────────────────────────────────────
    Write-Host "  Collecting release artifacts..." -ForegroundColor Yellow

    # CLI binary
    $cliBin = [IO.Path]::Combine($OpencodePkg, "dist", "cli.js")
    if (Test-Path $cliBin) {
        Copy-Item $cliBin (Join-Path $DistDir "cli.js")
        Write-Success "CLI script copied"
    }

    # Native binary (Windows x64)
    $nativeBin = [IO.Path]::Combine($OpencodePkg, "dist", "opencode-windows-x64", "bin", "opencode.exe")
    if (Test-Path $nativeBin) {
        if (-not (Test-Path (Join-Path $DistDir "bin"))) {
            New-Item -ItemType Directory -Path (Join-Path $DistDir "bin") | Out-Null
        }
        Copy-Item $nativeBin ([IO.Path]::Combine($DistDir, "bin", "opencode.exe"))
        Write-Success "Native binary copied"
    }

    # Native markdownify binary
    $markdownifySrc = [IO.Path]::Combine($Root, "packages", "native", "markdownify", "target", "release", "opencode-markdownify.exe")
    $markdownifyDest = [IO.Path]::Combine($OpencodePkg, "dist", "opencode-windows-x64", "bin", "opencode-markdownify.exe")
    if (Test-Path $markdownifySrc) {
        $markdownifyDestDir = Split-Path $markdownifyDest -Parent
        if (-not (Test-Path $markdownifyDestDir)) {
            New-Item -ItemType Directory -Path $markdownifyDestDir -Force | Out-Null
        }
        Copy-Item $markdownifySrc $markdownifyDest
        Write-Success "Markdownify binary staged to platform dist"
    }

    $markdownifyBin = [IO.Path]::Combine($OpencodePkg, "dist", "opencode-windows-x64", "bin", "opencode-markdownify.exe")
    if (Test-Path $markdownifyBin) {
        Copy-Item $markdownifyBin ([IO.Path]::Combine($DistDir, "bin", "opencode-markdownify.exe"))
        Write-Success "Markdownify binary copied"
    }

    # Native opentui DLL — must be pre-built via _opentui.ps1
    $opentuiDllSrc = [IO.Path]::Combine($Root, "packages", "opentui", "packages", "core-win32-x64", "opentui.dll")
    if (Test-Path $opentuiDllSrc) {
        $opentuiPlatformDestDir = [IO.Path]::Combine($OpencodePkg, "dist", "opencode-windows-x64", "bin")
        if (-not (Test-Path $opentuiPlatformDestDir)) {
            New-Item -ItemType Directory -Path $opentuiPlatformDestDir -Force | Out-Null
        }
        Copy-Item $opentuiDllSrc ([IO.Path]::Combine($opentuiPlatformDestDir, "opentui.dll")) -Force
        if (-not (Test-Path (Join-Path $DistDir "bin"))) {
            New-Item -ItemType Directory -Path (Join-Path $DistDir "bin") -Force | Out-Null
        }
        Copy-Item $opentuiDllSrc ([IO.Path]::Combine($DistDir, "bin", "opentui.dll")) -Force
        Write-Success "opentui native DLL copied"
    } else {
        throw "opentui.dll not found at $opentuiDllSrc — build OpenTUI first: .\_opentui.ps1"
    }

    # WASM sidecars
    $WasmPkgDir = Join-Path $Root "packages\wasm\core\pkg"
    $WasmDistDir = Join-Path $DistDir "wasm\core\pkg"
    if (Test-Path $WasmPkgDir) {
        if (Test-Path $WasmDistDir) {
            Remove-Item -Recurse -Force $WasmDistDir
        }
        New-Item -ItemType Directory -Path (Split-Path $WasmDistDir -Parent) -Force | Out-Null
        Copy-Item -Recurse -Force $WasmPkgDir $WasmDistDir

        $TreeSitterRuntimeWasm = Get-ChildItem (Join-Path $Root "node_modules") -Recurse -Filter "web-tree-sitter.wasm" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "web-tree-sitter" -and $_.FullName -notmatch "\\debug\\" } |
            Select-Object -First 1
        if ($TreeSitterRuntimeWasm) {
            Copy-Item $TreeSitterRuntimeWasm.FullName (Join-Path $WasmDistDir "web-tree-sitter.wasm") -Force
        }

        $wasmCount = @(Get-ChildItem -Path $WasmDistDir -Recurse -File -Filter "*.wasm" -ErrorAction SilentlyContinue).Count
        if ($wasmCount -lt 1) {
            throw "WASM mirror produced zero .wasm files under $WasmDistDir"
        }
        Write-Success "WASM modules mirrored to dist ($wasmCount .wasm files under wasm/core/pkg)"
    } else {
        Write-Warn "packages/wasm/core/pkg missing - skipping WASM sidecar copy (embedded assets still used at runtime)"
    }

    # SDK
    $sdkDir = [IO.Path]::Combine($Root, "packages", "sdk", "js", "dist")
    if (Test-Path $sdkDir) {
        Copy-Item -Recurse $sdkDir (Join-Path $DistDir "sdk")
        Write-Success "SDK copied"
    }

    # App build
    $appDist = [IO.Path]::Combine($Root, "packages", "app", "dist")
    if (Test-Path $appDist) {
        Copy-Item -Recurse $appDist (Join-Path $DistDir "app")
        Write-Success "App build copied"
    }

    # Local services (artifacts_dist/)
    $artifactsDist = Join-Path $Root "artifacts_dist"
    if (Test-Path $artifactsDist) {
        if (-not (Test-Path (Join-Path $DistDir "bin"))) {
            New-Item -ItemType Directory -Path (Join-Path $DistDir "bin") | Out-Null
        }
        Get-ChildItem $artifactsDist -Directory | ForEach-Object {
            Copy-Item -Recurse $_.FullName ([IO.Path]::Combine($DistDir, "bin", $_.Name))
            Write-Success "Service $($_.Name) copied from artifacts_dist/"
        }
    }

    # Package.json files
    Get-ChildItem (Join-Path $Root "packages") -Directory | ForEach-Object {
        $pkgJson = Join-Path $_.FullName "package.json"
        if (Test-Path $pkgJson) {
            $destDir = [IO.Path]::Combine($DistDir, "packages", $_.Name)
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir | Out-Null
            }
            Copy-Item $pkgJson $destDir
        }
    }

    Write-Success "Build complete - artifacts in dist/"
}

# ═══════════════════════════════════════════════════════════
# RELEASE TASK
# ═══════════════════════════════════════════════════════════
function Invoke-Release {
    param([string] $ReleaseVersion)

    Write-Step "Creating Release $ReleaseVersion"

    # Run checks first
    if (-not $SkipTypecheck -and -not $SkipTests) {
        Invoke-Check
    }

    # Build
    Invoke-Build

    # Get version if not provided
    if (-not $ReleaseVersion) {
        $ReleaseVersion = Get-Version
    }

    # Create release manifest
    $manifest = @{
        version     = $ReleaseVersion
        buildTime   = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        gitSha      = (git rev-parse HEAD)
        gitBranch   = (git rev-parse --abbrev-ref HEAD)
        nodeVersion = (node --version)
        bunVersion  = (bun --version)
        artifacts   = @()
    }

    Get-ChildItem $DistDir -File -Recurse | ForEach-Object {
        $relPath = $_.FullName.Replace($DistDir, "").TrimStart("\")
        $manifest.artifacts += @{
            path = $relPath
            size = $_.Length
        }
    }

    $manifest | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $DistDir "release-manifest.json")
    Write-Success "Release manifest created"

    Write-Host ""
    Write-Host "════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Release $ReleaseVersion ready in dist/" -ForegroundColor Green
    Write-Host "════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Review dist/ contents" -ForegroundColor White
    Write-Host "  2. git add dist/ && git commit -m 'release: v$ReleaseVersion'" -ForegroundColor White
    Write-Host "  3. git tag v$ReleaseVersion" -ForegroundColor White
    Write-Host "  4. git push origin && git push origin v$ReleaseVersion" -ForegroundColor White
    Write-Host ""
}

# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════
switch ($Task) {
    "check" {
        Invoke-Check
    }
    "build" {
        Invoke-Build
    }
    "release" {
        Invoke-Release -ReleaseVersion $Version
    }
    default {
        Write-Host "Usage: .\_build.ps1 [-Task check|build|release] [-Version <version>] [-SkipTests] [-SkipTypecheck]"
        Write-Host ""
        Write-Host "Tasks:" -ForegroundColor Yellow
        Write-Host "  check   - Run typecheck, tests, and prettier"
        Write-Host "  build   - Compile opencode package; collect artifacts to dist/"
        Write-Host "  release - Run checks, build, and create release manifest"
        Write-Host ""
        Write-Host "Options:" -ForegroundColor Yellow
        Write-Host "  -Version <version>  Override version for release (default: from package.json)"
        Write-Host "  -SkipTests          Skip test execution"
        Write-Host "  -SkipTypecheck      Skip typecheck"
        Write-Host ""
        Write-Host "Prerequisites (run before build):" -ForegroundColor Yellow
        Write-Host "  python prompts_kernel/_assemble_prompts_kernel.py — kernel assembly"
        Write-Host "  .\_opentui.ps1                   — OpenTUI Zig+TS rebuild"
        Write-Host "  .\_opentui.ps1 -Full             — full OpenTUI monorepo"
        Write-Host ""
        Write-Host "Typical workflow:" -ForegroundColor Yellow
        Write-Host "  python prompts_kernel/_assemble_prompts_kernel.py  # assemble + validate kernel"
        Write-Host "  .\_opentui.ps1                    # build OpenTUI native + TS"
        Write-Host "  .\_build.ps1                      # compile opencode + collect dist/"
        exit 1
    }
}
