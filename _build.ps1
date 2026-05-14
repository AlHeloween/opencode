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
# CHECK TASK
# ═══════════════════════════════════════════════════════════
function Invoke-Check {
    Write-Step "Running Checks"

    $allPassed = $true

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
# BUILD TASK
# ═══════════════════════════════════════════════════════════
function Invoke-Build {
    Write-Step "Building"

    # Build Rust WASM modules first
    Write-Host "  Building Rust WASM modules..." -ForegroundColor Yellow
    & "$PSScriptRoot\_build_rust.ps1"

    # Clean dist directory
    if (Test-Path $DistDir) {
        Remove-Item $DistDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $DistDir | Out-Null

    # Build opencode package (single-platform for faster builds)
    Write-Host "  Building packages..." -ForegroundColor Yellow
    Push-Location $OpencodePkg
    try {
        bun run script/build.ts --single
    } finally {
        Pop-Location
    }

    # Copy release artifacts to dist root
    Write-Host "  Collecting release artifacts..." -ForegroundColor Yellow

    # CLI binary (from opencode package)
    $cliBin = Join-Path $OpencodePkg "dist" "cli.js"
    if (Test-Path $cliBin) {
        Copy-Item $cliBin (Join-Path $DistDir "cli.js")
        Write-Success "CLI script copied"
    }

    # Native binary (Windows x64)
    $nativeBin = Join-Path $OpencodePkg "dist" "opencode-windows-x64" "bin" "opencode.exe"
    if (Test-Path $nativeBin) {
        if (-not (Test-Path (Join-Path $DistDir "bin"))) {
            New-Item -ItemType Directory -Path (Join-Path $DistDir "bin") | Out-Null
        }
        Copy-Item $nativeBin (Join-Path $DistDir "bin" "opencode.exe")
        Write-Success "Native binary copied"
    }

    # Native markdownify binary (built by _build_rust.ps1, stage to platform dist)
    $markdownifySrc = Join-Path $Root "packages" "native" "markdownify" "target" "release" "opencode-markdownify.exe"
    $markdownifyDest = Join-Path $OpencodePkg "dist" "opencode-windows-x64" "bin" "opencode-markdownify.exe"
    if (Test-Path $markdownifySrc) {
        $markdownifyDestDir = Split-Path $markdownifyDest -Parent
        if (-not (Test-Path $markdownifyDestDir)) {
            New-Item -ItemType Directory -Path $markdownifyDestDir -Force | Out-Null
        }
        Copy-Item $markdownifySrc $markdownifyDest
        Write-Success "Markdownify binary staged to platform dist"
    }

    # Native markdownify binary (Windows x64)
    $markdownifyBin = Join-Path $OpencodePkg "dist" "opencode-windows-x64" "bin" "opencode-markdownify.exe"
    if (Test-Path $markdownifyBin) {
        Copy-Item $markdownifyBin (Join-Path $DistDir "bin" "opencode-markdownify.exe")
        Write-Success "Markdownify binary copied"
    }

    # SDK (from sdk/js package)
    $sdkDir = Join-Path $Root "packages" "sdk" "js" "dist"
    if (Test-Path $sdkDir) {
        Copy-Item -Recurse $sdkDir (Join-Path $DistDir "sdk")
        Write-Success "SDK copied"
    }

    # App build (from app package)
    $appDist = Join-Path $Root "packages" "app" "dist"
    if (Test-Path $appDist) {
        Copy-Item -Recurse $appDist (Join-Path $DistDir "app")
        Write-Success "App build copied"
    }

    # Local services (from artifacts_dist/)
    $artifactsDist = Join-Path $Root "artifacts_dist"
    if (Test-Path $artifactsDist) {
        if (-not (Test-Path (Join-Path $DistDir "bin"))) {
            New-Item -ItemType Directory -Path (Join-Path $DistDir "bin") | Out-Null
        }
        Get-ChildItem $artifactsDist -Directory | ForEach-Object {
            Copy-Item -Recurse $_.FullName (Join-Path $DistDir "bin" $_.Name)
            Write-Success "Service $($_.Name) copied from artifacts_dist/"
        }
    }

    # Copy package.json files for each workspace
    Get-ChildItem (Join-Path $Root "packages") -Directory | ForEach-Object {
        $pkgJson = Join-Path $_.FullName "package.json"
        if (Test-Path $pkgJson) {
            $destDir = Join-Path $DistDir "packages" $_.Name
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

    # Run build
    Invoke-Build

    # Get version if not provided
    if (-not $ReleaseVersion) {
        $ReleaseVersion = Get-Version
    }

    # Create release manifest
    $manifest = @{
        version = $ReleaseVersion
        buildTime = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        gitSha = (git rev-parse HEAD)
        gitBranch = (git rev-parse --abbrev-ref HEAD)
        nodeVersion = (node --version)
        bunVersion = (bun --version)
        artifacts = @()
    }

    # List all artifacts
    Get-ChildItem $DistDir -File -Recurse | ForEach-Object {
        $relPath = $_.FullName.Replace($DistDir, "").TrimStart("\")
        $manifest.artifacts += @{
            path = $relPath
            size = $_.Length
        }
    }

    # Write manifest
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
        Write-Host "  build   - Build all packages and collect artifacts to dist/"
        Write-Host "  release - Run checks, build, and create release manifest"
        Write-Host ""
        Write-Host "Options:" -ForegroundColor Yellow
        Write-Host "  -Version <version>  Override version for release (default: from package.json)"
        Write-Host "  -SkipTests          Skip test execution"
        Write-Host "  -SkipTypecheck      Skip typecheck"
        exit 1
    }
}
