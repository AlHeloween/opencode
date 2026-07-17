param(
    [ValidateSet("check", "build", "release")]
    [string] $Task = "build",

    [string] $Version = "",

    [switch] $SkipTests = $false,

    [switch] $SkipTypecheck = $false,

    # Skip OpenTUI Zig+TS rebuild (faster when only opencode TS changed and DLL is already current)
    [switch] $SkipOpenTui = $false,

    # Rebuild full OpenTUI monorepo (core, qrcode, three, solid, react, keymap, ssh)
    # Default builds only packages opencode needs: core (native+lib), solid, three.
    [switch] $OpenTuiFull = $false
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$DistDir = Join-Path $Root "dist"
$OpencodePkg = Join-Path (Join-Path $Root "packages") "opencode"
$OpenTuiRoot = Join-Path (Join-Path $Root "packages") "opentui"

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

# ───────────────────────────────────────────────────────────
# OpenTUI rebuild (Zig native + TypeScript lib)
#
# packages/opentui/scripts/ is monorepo tooling (link/publish/clean).
# Real compile is packages/opentui/packages/*/scripts/build.ts:
#   core:  build:native (Zig → opentui.dll) + build:lib (TS → dist/)
#   solid / three: bun scripts/build.ts
#
# _build.ps1 previously only *copied* a prebuilt DLL — that left sixel/Image
# TS+Zig fixes out of dist. Always rebuild OpenTUI before opencode compile.
# ───────────────────────────────────────────────────────────
function Invoke-OpenTuiBuild {
    param(
        [switch] $Full = $false
    )

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
            throw "OpenTUI core build failed (exit $LASTEXITCODE) — zig and/or TS lib"
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

# ═══════════════════════════════════════════════════════════
# CHECK TASK
# ═══════════════════════════════════════════════════════════
function Invoke-Check {
    Write-Step "Running Checks"

    $allPassed = $true

    # Check 0: Clean up .temp/test/ directory (grows significantly from test runs)
    $tempTestDir = Join-Path $Root ".temp\test"
    if (Test-Path $tempTestDir) {
        Write-Host "  Cleaning .temp/test/..." -ForegroundColor Yellow
        Remove-Item $tempTestDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success ".temp/test/ cleaned"
    }

    # Check 0b: Sync kernel prompt first so tests verify the latest content
    $kernelSynced = Sync-KernelPrompt
    if (-not $kernelSynced) {
        $allPassed = $false
    }

    # Check 0c: Reasoning framework self-test (290 pytest tests)
    $reasoningPassed = Test-ReasoningFramework
    if (-not $reasoningPassed) {
        $allPassed = $false
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
# BUILD TASK
# ═══════════════════════════════════════════════════════════

function Sync-KernelPrompt {
    $kernelSrc = Join-Path $Root "opencode_prompts_kernel.py"
    $kernelDst = Join-Path (Join-Path (Join-Path $Root "packages") "opencode") "src\session\prompt\opencode_prompts_kernel.txt"

    if (-not (Test-Path $kernelSrc)) {
        Write-Error- "Kernel source not found: $kernelSrc"
        return $false
    }

    & python $kernelSrc --render-runtime $kernelDst --render-skills "$(Join-Path $Root ".opencode\skills")" "$(Join-Path $Root ".cursor\skills")"
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Kernel runtime compilation failed"
        return $false
    }
    Write-Success "Kernel prompt compiled ($(Get-Item $kernelDst).Length bytes)"
    return $true
}

# ═══════════════════════════════════════════════════════════
# REASONING FRAMEWORK SELF-TEST
# ═══════════════════════════════════════════════════════════
function Test-ReasoningFramework {
    Write-Host "  Testing reasoning framework..." -ForegroundColor Yellow

    # 1. Verify Python import works (kernel compiles)
    # Use forward slashes to avoid Python SyntaxWarning on Windows backslash escapes
    $importRoot = $Root.Replace("\", "/")
    $importTest = python -c "import sys; sys.path.insert(0, '$importRoot'); import opencode_prompts_kernel as k; print(f'OK: {len(k._KERNEL_SYMBOLS)} symbols, {len(k.PROJECTION_LIBRARY)} projections')" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Kernel import failed"
        Write-Host "  $importTest" -ForegroundColor Red
        return $false
    }
    Write-Success "Kernel imports ($importTest)"

    # 2. Verify IR roundtrip (compile → expand = identity)
    $irTest = python -c @"
import sys; sys.path.insert(0, '$importRoot')
import opencode_prompts_kernel as k
r = {'invariants': ['must balance'], 'constraints': ['must be safe']}
ir = k.compile_to_ir(r)
e = k.expand_from_ir(ir)
assert e == r, 'Roundtrip failed'
errs = k.validate_ir_equivalence(r, ir)
assert len(errs) == 0, f'Equivalence errors: {errs}'
print('OK: compile/expand/validate all pass')
"@ 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "IR roundtrip failed"
        Write-Host "  $irTest" -ForegroundColor Red
        return $false
    }
    Write-Success "IR compilation roundtrip (identity)"

    # 3. Verify MappingProxyType immutability
    $immutTest = python -c @"
import sys; sys.path.insert(0, '$importRoot')
import opencode_prompts_kernel as k
try:
    k._KERNEL_SYMBOLS['_k_hack'] = 'value'
    print('FAIL: mutation should raise TypeError')
    exit(1)
except TypeError:
    print('OK: mutation blocked')
"@ 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Immutability check failed"
        Write-Host "  $immutTest" -ForegroundColor Red
        return $false
    }
    Write-Success "MappingProxyType immutability (TypeError on write)"

    # 4. Run full pytest suite (290 tests)
    $testOutput = python -m pytest $Root\tests\ -q --tb=no 2>&1
    $testExitCode = $LASTEXITCODE
    if ($testExitCode -ne 0) {
        Write-Error- "pytest suite failed (exit code: $testExitCode)"
        Write-Host "  $testOutput" -ForegroundColor Red
        return $false
    }
    # Extract summary line: "290 passed in X.XXs"
    $summaryLine = ($testOutput -split "`n") | Where-Object { $_ -match "passed" } | Select-Object -Last 1
    Write-Success "pytest: $summaryLine"

    # 5. Verify discipline projection hierarchy consistency
    $hierarchyTest = python -c @"
import sys; sys.path.insert(0, '$importRoot')
import opencode_prompts_kernel as k
checks = 0
for name, proj in k.PROJECTION_LIBRARY.items():
    if proj.parent:
        assert proj.parent in k.PROJECTION_LIBRARY, f'{name}: parent {proj.parent} not found'
        checks += 1
    kp = proj.kernel_projection or {}
    has_inv = bool(kp.get('invariants', []))
    has_forb = bool(kp.get('forbidden_actions', []))
    assert has_inv or has_forb, f'{name}: no invariants or forbidden_actions'
print(f'OK: {checks} parent relationships verified')
"@ 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Discipline hierarchy check failed"
        Write-Host "  $hierarchyTest" -ForegroundColor Red
        return $false
    }
    Write-Success "Discipline projection hierarchy ($hierarchyTest)"

    return $true
}

function Invoke-Build {
    Write-Step "Building"

    # Step -1: Clean up .temp/test/ (grows significantly from test/build runs)
    $tempTestDirBuild = Join-Path $Root ".temp\test"
    if (Test-Path $tempTestDirBuild) {
        Write-Host "  Cleaning .temp/test/..." -ForegroundColor Yellow
        Remove-Item $tempTestDirBuild -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success ".temp/test/ cleaned"
    }

    # Step 0: Sync opencode_prompts_kernel.py → .txt (canonical prompt source)
    $kernelSynced = Sync-KernelPrompt
    if (-not $kernelSynced) {
        throw "Kernel prompt sync failed"
    }

    # Step 0b: Reasoning framework self-test (290 pytest tests)
    $reasoningPassed = Test-ReasoningFramework
    if (-not $reasoningPassed) {
        throw "Reasoning framework self-test failed - kernel integrity broken"
    }

    # Build Rust WASM modules next
    Write-Host "  Building Rust WASM modules..." -ForegroundColor Yellow
    & "$PSScriptRoot\_build_rust.ps1"

    # OpenTUI: Zig + TS lib *before* opencode compile (so dist ships current sixel/Image)
    if ($SkipOpenTui) {
        Write-Host "  Skipping OpenTUI rebuild (-SkipOpenTui) — using existing DLL/dist" -ForegroundColor Yellow
    } else {
        Invoke-OpenTuiBuild -Full:$OpenTuiFull
    }

    # Clean dist directory
    if (Test-Path $DistDir) {
        Remove-Item $DistDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $DistDir | Out-Null

    # Build opencode package (single-platform for faster builds)
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

    # Copy release artifacts to dist root
    Write-Host "  Collecting release artifacts..." -ForegroundColor Yellow

    # CLI binary (from opencode package)
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

    # Native markdownify binary (built by _build_rust.ps1, stage to platform dist)
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

    # Native markdownify binary (Windows x64)
    $markdownifyBin = [IO.Path]::Combine($OpencodePkg, "dist", "opencode-windows-x64", "bin", "opencode-markdownify.exe")
    if (Test-Path $markdownifyBin) {
        Copy-Item $markdownifyBin ([IO.Path]::Combine($DistDir, "bin", "opencode-markdownify.exe"))
        Write-Success "Markdownify binary copied"
    }

    # Native opentui DLL — required by @opentui/core for rendering (built above unless -SkipOpenTui)
    $opentuiDllSrc = [IO.Path]::Combine($Root, "packages", "opentui", "packages", "core-win32-x64", "opentui.dll")
    if (Test-Path $opentuiDllSrc) {
        # Copy to platform dist (where bun build places the exe)
        $opentuiPlatformDestDir = [IO.Path]::Combine($OpencodePkg, "dist", "opencode-windows-x64", "bin")
        if (-not (Test-Path $opentuiPlatformDestDir)) {
            New-Item -ItemType Directory -Path $opentuiPlatformDestDir -Force | Out-Null
        }
        Copy-Item $opentuiDllSrc ([IO.Path]::Combine($opentuiPlatformDestDir, "opentui.dll")) -Force
        # Copy to final dist/bin (alongside opencode.exe)
        if (-not (Test-Path (Join-Path $DistDir "bin"))) {
            New-Item -ItemType Directory -Path (Join-Path $DistDir "bin") -Force | Out-Null
        }
        Copy-Item $opentuiDllSrc ([IO.Path]::Combine($DistDir, "bin", "opentui.dll")) -Force
        Write-Success "opentui native DLL copied (from rebuilt core-win32-x64)"
    } else {
        throw "opentui.dll not found at $opentuiDllSrc — run without -SkipOpenTui or build packages/opentui/packages/core first"
    }

    # Standalone CodeGraph binary (built with bun --compile from external/codegraph)
    $CgBunEntry = [IO.Path]::Combine($Root, "external", "codegraph", "codegraph.exe")
    $CgBuiltFromDist = [IO.Path]::Combine($OpencodePkg, "node_modules", "@colbymchenry", "codegraph", "dist", "bin", "codegraph.js")
    if (Test-Path $CgBunEntry) {
        Copy-Item $CgBunEntry ([IO.Path]::Combine($DistDir, "bin", "codegraph.exe"))
        Write-Success "CodeGraph standalone binary copied"
    } elseif (Test-Path $CgBuiltFromDist) {
        # Fallback: copy the JS CLI and its node_modules dependencies
        Write-Warning "Standalone codegraph.exe not built - copying JS CLI"
        Copy-Item $CgBuiltFromDist ([IO.Path]::Combine($DistDir, "bin", "codegraph.js"))
    }

    # Copy WASM modules to dist as fallback sidecars; runtime prefers embedded assets.
    $WasmPkgDir = Join-Path $Root "packages\wasm\core\pkg"
    $WasmDistDir = Join-Path $DistDir "wasm\core\pkg"
    if (Test-Path $WasmPkgDir) {
        New-Item -ItemType Directory -Path $WasmDistDir -Force | Out-Null
        Copy-Item -Recurse -Force "$WasmPkgDir\rdiff" $WasmDistDir
        Copy-Item -Recurse -Force "$WasmPkgDir\json_repair" $WasmDistDir
        Copy-Item -Recurse -Force "$WasmPkgDir\diffy" $WasmDistDir
        Copy-Item -Recurse -Force "$WasmPkgDir\grammars" $WasmDistDir
        Copy-Item "$WasmPkgDir\tokenizer.wasm" $WasmDistDir
        if (Test-Path "$WasmPkgDir\path_validator.wasm") {
            Copy-Item "$WasmPkgDir\path_validator.wasm" $WasmDistDir
        }
        $TreeSitterRuntimeWasm = Get-ChildItem (Join-Path $Root "node_modules") -Recurse -Filter "tree-sitter.wasm" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "web-tree-sitter" -and $_.FullName -notmatch "\\debug\\" } | Select-Object -First 1
        if ($TreeSitterRuntimeWasm) {
            Copy-Item $TreeSitterRuntimeWasm.FullName (Join-Path $WasmDistDir "tree-sitter.wasm")
        }

        # Enumerate all WASM assets dynamically — every file in pkg/ and pkg/grammars/ is required.
        $RequiredWasmAssets = @(
            "tokenizer.wasm",
            "path_validator.wasm",
            "tree-sitter.wasm",
            "diffy\diffy_wasm_bg.wasm",
            "json_repair\json_repair_bg.wasm",
            "rdiff\rdiff_bg.wasm"
        )
        # Add all grammar WASMs: scan the source grammars dir and build expected paths
        $GrammarDir = Join-Path $WasmPkgDir "grammars"
        if (Test-Path $GrammarDir) {
            $GrammarFiles = Get-ChildItem $GrammarDir -Filter "*.wasm"
            foreach ($gf in $GrammarFiles) {
                $RequiredWasmAssets += "grammars\$($gf.Name)"
            }
        }
        # Verify every required asset exists in dist
        foreach ($asset in $RequiredWasmAssets) {
            $assetPath = Join-Path $WasmDistDir $asset
            if (-not (Test-Path $assetPath)) {
                throw "Required WASM asset missing from dist: $asset"
            }
        }
        Write-Success "WASM modules copied to dist ($($RequiredWasmAssets.Count) assets)"
    }

    # SDK (from sdk/js package)
    $sdkDir = [IO.Path]::Combine($Root, "packages", "sdk", "js", "dist")
    if (Test-Path $sdkDir) {
        Copy-Item -Recurse $sdkDir (Join-Path $DistDir "sdk")
        Write-Success "SDK copied"
    }

    # App build (from app package)
    $appDist = [IO.Path]::Combine($Root, "packages", "app", "dist")
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
            Copy-Item -Recurse $_.FullName ([IO.Path]::Combine($DistDir, "bin", $_.Name))
            Write-Success "Service $($_.Name) copied from artifacts_dist/"
        }
    }

    # Copy package.json files for each workspace
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
        Write-Host "Usage: .\_build.ps1 [-Task check|build|release] [-Version <version>] [-SkipTests] [-SkipTypecheck] [-SkipOpenTui] [-OpenTuiFull]"
        Write-Host ""
        Write-Host "Tasks:" -ForegroundColor Yellow
        Write-Host "  check   - Run typecheck, tests, and prettier"
        Write-Host "  build   - Rebuild OpenTUI (Zig+TS) then opencode; collect artifacts to dist/"
        Write-Host "  release - Run checks, build, and create release manifest"
        Write-Host ""
        Write-Host "Options:" -ForegroundColor Yellow
        Write-Host "  -Version <version>  Override version for release (default: from package.json)"
        Write-Host "  -SkipTests          Skip test execution"
        Write-Host "  -SkipTypecheck      Skip typecheck"
        Write-Host "  -SkipOpenTui        Skip OpenTUI Zig+TS rebuild (use existing opentui.dll/dist)"
        Write-Host "  -OpenTuiFull        Full OpenTUI monorepo build (default: core+solid+three only)"
        Write-Host ""
        Write-Host "OpenTUI build chain:" -ForegroundColor Yellow
        Write-Host "  packages/opentui/packages/core  → bun run build  (build:native + build:lib)"
        Write-Host "  packages/opentui/packages/solid → bun run build"
        Write-Host "  packages/opentui/packages/three → bun run build"
        Write-Host "  then packages/opencode script/build.ts --single (copies DLL into compile)"
        exit 1
    }
}
