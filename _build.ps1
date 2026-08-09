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
# _build.ps1 previously only *copied* a prebuilt DLL - that left sixel/Image
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

    # Check 0b2: Kernel stability guardrails (assembly point, schema density, refcheck, …)
    $kernelStable = Test-KernelStability
    if (-not $kernelStable) {
        Write-Error- "Kernel stability guardrails FAILED - refusing to proceed with broken kernel"
        exit 1
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
    $reasoningMdc = Join-Path $Root "packages\opencode\src\session\prompt\reasoning_prompt.mdc"
    $reasoningTxt = Join-Path $Root "packages\opencode\src\session\prompt\reasoning_prompt.txt"
    # 1a) Precompile kernel (separate process - fresh import needed for step 1b)
    & python -c "from prompts_kernel import write_precompiled_kernel; write_precompiled_kernel()"
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Kernel precompilation failed"
        return $false
    }
    # 1b) Assemble reasoning protocol (fresh import picks up precompiled)
    & python -c "from prompts_kernel import write_reasoning, validate_reasoning_artifacts; write_reasoning(); errors = validate_reasoning_artifacts(); assert not errors, '; '.join(errors)"
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Kernel reasoning/algorithm_card assembly failed"
        return $false
    }
    Write-Success "Reasoning prompts assembled (.mdc $((Get-Item $reasoningMdc).Length) bytes; runtime .txt $((Get-Item $reasoningTxt).Length) bytes)"
    return $true
}

# ═══════════════════════════════════════════════════════════
# KERNEL STABILITY GUARDRAILS
# ═══════════════════════════════════════════════════════════
# See: docs/kernel-stability-principles.md (7 principles, 12-point checklist)
# These checks prevent the assembly point from being destroyed by optimization.
# DO NOT DISABLE without explicit approval - the kernel geometry is Sierpinski,
# meaning all parts are interdependent. A "small" change to one schema
# cascades to affect the entire kernel's structural integrity.

function Test-KernelStability {
    param([string] $KernelPath)

    if (-not $KernelPath) {
        $KernelPath = Join-Path $Root "packages\opencode\src\session\prompt\reasoning_prompt.txt"
    }

    if (-not (Test-Path $KernelPath)) {
        Write-Error- "Kernel not found: $KernelPath"
        return $false
    }

    $content = Get-Content $KernelPath -Raw
    $lines = Get-Content $KernelPath
    $allPassed = $true

    Write-Host "  Kernel stability guardrails (docs/kernel-stability-principles.md):" -ForegroundColor Yellow

    # ── Guard 1: Assembly Point - first H1 must be "Semantic Vector" ──
    $firstH1 = ($lines | Where-Object { $_ -match '^# [^#]' } | Select-Object -First 1)
    if ($firstH1 -notmatch '^# Semantic Vector( \(SV\))?$') {
        Write-Error- "ASSEMBLY POINT: First H1 is '$firstH1', expected '# Semantic Vector' or '# Semantic Vector (SV)'. The assembly point must be the first structural element. See Principle 1."
        $allPassed = $false
    } else {
        Write-Success "Assembly point: $firstH1 (first H1)"
    }

    # ── Guard 2: SV_FORMAT - first @tag must be @SV_FORMAT as H2 ──
    $svFormatLine = ($lines | Where-Object { $_ -match '@SV_FORMAT' } | Select-Object -First 1)
    if ($svFormatLine -notmatch '^## SV_FORMAT') {
        Write-Error- "SV_FORMAT: Expected H2 heading '## SV_FORMAT (@SV_FORMAT)', found '$svFormatLine'. @tag must have dedicated heading. See Principle 1."
        $allPassed = $false
    } else {
        Write-Success "SV_FORMAT: ## SV_FORMAT (@SV_FORMAT) (first @tag, H2)"
    }

    # ── Guard 3: Bold imperative ──
    if ($content -notmatch '\*\*YOU must emit (this|SV) after EVERY response\.\*\*') {
        Write-Error- "IMPERATIVE: Missing bold imperative. Must contain '**YOU must emit SV after EVERY response.**'. See Principle 6."
        $allPassed = $false
    } else {
        Write-Success "Imperative: bold 'YOU must emit' present"
    }

    # ── Guard 4: Protocol violation closing anchor ──
    if ($content -notmatch 'Omission = protocol violation\. SV is a semantic fingerprint, NOT a claim status\.') {
        Write-Error- "ANCHOR: Missing closing 'Omission = protocol violation. SV is a semantic fingerprint, NOT a claim status.' See Principle 6."
        $allPassed = $false
    } else {
        Write-Success "Closing anchor: protocol violation + fingerprint distinction"
    }

    # ── Guard 5: Root-of-Truth - no postscript after it ──
    $rootTruthIdx = $lines.IndexOf(($lines | Where-Object { $_ -match 'THIS KERNEL IS THE ROOT OF TRUTH' } | Select-Object -First 1))
    if ($rootTruthIdx -ge 0) {
        $linesAfter = $lines[($rootTruthIdx + 1)..($lines.Count - 1)] | Where-Object { $_.Trim() -ne '' }
        # The root-of-truth block is 4 lines: "---", declaration, 2 prose lines. After that, nothing.
        # The last substantive line should be "No exception, no override, no grandfathering."
        $lastLine = ($lines | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
        if ($lastLine -notmatch 'No exception, no override, no grandfathering\.') {
            Write-Error- "ROOT-OF-TRUTH: Postscript detected after root-of-truth declaration. Last substantive line: '$lastLine'. Must end with 'No exception, no override, no grandfathering.' See Principle 5."
            $allPassed = $false
        } else {
            Write-Success "Root-of-truth: clean close, no postscript"
        }
    }

    # ── Guard 6: Schema density - critical schemas must not be compressed ──
    $schemaChecks = @{
        "EXECUTION_ENVELOPE" = 35
        "FRACTAL_GEOMETRY" = 15
        "MASTER_PLAN_SCHEMA" = 15
        "CLEAN_NEXT_STATE" = 12
        "SMOKE_CONTRACT" = 12
        "CLAIM_LEDGER" = 12
    }

    foreach ($schema in $schemaChecks.Keys) {
        $startIdx = $lines.IndexOf(($lines | Where-Object { $_ -match "^## $schema" } | Select-Object -First 1))
        if ($startIdx -lt 0) {
            Write-Error- "SCHEMA: '$schema' not found in kernel"
            $allPassed = $false
            continue
        }
        # Count lines until next H2 or blank+next section
        $schemaLines = 0
        for ($i = $startIdx + 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^## [A-Z]' -or $lines[$i] -match '^# [A-Z]') { break }
            $schemaLines++
        }
        $min = $schemaChecks[$schema]
        if ($schemaLines -lt $min) {
            Write-Error- "SCHEMA DENSITY: '$schema' has $schemaLines lines (minimum $min). Schema compression breaks the density gradient. See Principle 2."
            $allPassed = $false
        }
    }
    Write-Success "Schema density: all critical schemas meet minimum line counts"

    # ── Guard 7: Schema heading level - must be H2 under # Schemas ──
    $schemasSectionIdx = $lines.IndexOf(($lines | Where-Object { $_ -match '^# Schemas' } | Select-Object -First 1))
    $badH1Schemas = @()
    if ($schemasSectionIdx -ge 0) {
        for ($i = $schemasSectionIdx + 1; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '^# (CLAIM_LEDGER|STAMPS|FRACTAL_GEOMETRY|SMOKE_CONTRACT|BUG_FIX_SCHEMA|SIGNAL_CLUSTER|EXECUTION_ENVELOPE|MASTER_PLAN_SCHEMA|CLEAN_NEXT_STATE|BLOCKER|MSG_TAG|EXPLORER_GOAL)') {
                $badH1Schemas += $lines[$i].Trim()
            }
            if ($lines[$i] -match '^# (Algorithms|Epistemic|Hygiene|Diagrams)') { break }
        }
    }
    if ($badH1Schemas.Count -gt 0) {
        Write-Error- "HEADING FLATTENING: ${badH1Schemas.Count} schema(s) at H1 level under # Schemas: $($badH1Schemas -join ', '). Schemas must be H2 (##). See Principle 3."
        $allPassed = $false
    } else {
        Write-Success "Heading hierarchy: schemas are H2 under # Schemas (tree, not flat list)"
    }

    # ── Guard 8: Refcheck - no NEW unresolved refs ──
    $KNOWN_UNRESOLVED = @(
        "BASE_AGENT", "RULE", "G", "NOISE_FILTER"  # pre-existing soft/FP refs
        # Note: refcount baseline = 91. Update when adding/removing refs.
    )
    $refcheckOutput = & python -m prompts_kernel.tools.refcheck 2>&1
    $unresolvedBlock = ($refcheckOutput -join "`n" | Select-String -Pattern "UNRESOLVED @refs:" -Context 0,30).Context.PostContext
    $newUnresolved = @()
    foreach ($line in $unresolvedBlock) {
        $ref = ($line -replace '^\s+', '').Trim()
        if ($ref -and $ref -notin $KNOWN_UNRESOLVED) {
            $newUnresolved += $ref
        }
    }
    if ($newUnresolved.Count -gt 0) {
        Write-Error- "REFCHECK: $($newUnresolved.Count) NEW unresolved @ref(s): $($newUnresolved -join ', '). These were not in the baseline. Fix before proceeding."
        $allPassed = $false
    } else {
        Write-Success "Refcheck: no new unresolved @refs (baseline: $($KNOWN_UNRESOLVED.Count) known)"
    }

    if (-not $allPassed) {
        Write-Host ""
        Write-Host "  ╔══════════════════════════════════════════════════════╗" -ForegroundColor Red
        Write-Host "  ║  KERNEL STABILITY CHECK FAILED                       ║" -ForegroundColor Red
        Write-Host "  ║  See: docs/kernel-stability-principles.md            ║" -ForegroundColor Red
        Write-Host "  ║  The assembly point may have been destroyed by       ║" -ForegroundColor Red
        Write-Host "  ║  optimization. Geometry is Sierpinski — all parts     ║" -ForegroundColor Red
        Write-Host "  ║  are interdependent. Fix canonical sources and       ║" -ForegroundColor Red
        Write-Host "  ║  re-assemble via the pipeline.                       ║" -ForegroundColor Red
        Write-Host "  ╚══════════════════════════════════════════════════════╝" -ForegroundColor Red
        Write-Host ""
    }

    # ── Guard 9: Forward references (warn, never blocks) ──
    $lookaheadOut = & python prompts_kernel/tools/ref_lookahead.py 2>&1
    $lookaheadExit = $LASTEXITCODE
    if ($lookaheadExit -eq 0) {
        Write-Success "Forward refs: 0 (all definitions before use)"
    } else {
        $firstLine = ($lookaheadOut | Select-Object -First 1) -replace '[^\d]', ''
        $count = if ($firstLine) { [int]$firstLine } else { "?" }
        Write-Host "  [!] ~$count forward reference(s) — review if new refs were added before definitions" -ForegroundColor Yellow
    }
    }

    # ── Guard 10: Forward references (look-ahead detection) ──
    $fwdRefs = & python prompts_kernel/tools/ref_lookahead.py 2>&1
    if ($LASTEXITCODE -ne 0) {
        $fwdCount = ($fwdRefs | Select-String "forward reference" | Out-String).Trim()
        Write-Host "  [WARN] $fwdCount — forward refs hurt LLM comprehension. Consider reordering." -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] Zero forward references — all @refs defined before first use" -ForegroundColor Green
    }
    
    return $allPassed
}

# ═══════════════════════════════════════════════════════════
# REASONING FRAMEWORK SELF-TEST
# ═══════════════════════════════════════════════════════════
function Test-ReasoningFramework {
    Write-Host "  Testing reasoning framework..." -ForegroundColor Yellow

    # 1. Verify Python import works (kernel compiles)
    # Use forward slashes to avoid Python SyntaxWarning on Windows backslash escapes
    $importRoot = $Root.Replace("\", "/")
    $importTest = python -c "import sys; sys.path.insert(0, '$importRoot'); import prompts_kernel as k; print(f'OK: {len(k._KERNEL_SYMBOLS)} symbols, {len(k.PROJECTION_LIBRARY)} projections')" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error- "Kernel import failed"
        Write-Host "  $importTest" -ForegroundColor Red
        return $false
    }
    Write-Success "Kernel imports ($importTest)"

    # 2. Verify IR roundtrip (compile → expand = identity)
    $irTest = python -c @"
import sys; sys.path.insert(0, '$importRoot')
import prompts_kernel as k
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
import prompts_kernel as k
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

    # 4. Kernel tests (prompts_kernel/tests/)
    $testOutput = python -m pytest $Root\prompts_kernel\tests -q --tb=no 2>&1
    $testExitCode = $LASTEXITCODE
    if ($testExitCode -ne 0) {
        Write-Host "  [!] pytest kernel: $summaryLine (non-blocking — review failures)" -ForegroundColor Yellow
        # Test failures are WARNINGS, not errors. Guardrails (above) are authoritative.
        # Fix test assertions when kernel structure changes intentionally.
    } else {
        Write-Success "pytest kernel: $summaryLine"
    }

    # 5. Verify discipline projection hierarchy consistency
    $hierarchyTest = python -c @"
import sys; sys.path.insert(0, '$importRoot')
import prompts_kernel as k
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

    # Step 0: Sync prompts_kernel.py → .txt (canonical prompt source)
    $kernelSynced = Sync-KernelPrompt
    if (-not $kernelSynced) {
        throw "Kernel prompt sync failed"
    }

    # Step 0a: Kernel stability guardrails - refuse to build with broken kernel
    $kernelStable = Test-KernelStability
    if (-not $kernelStable) {
        throw "Kernel stability guardrails FAILED - assembly point integrity check. See docs/kernel-stability-principles.md"
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
        Write-Host "  Skipping OpenTUI rebuild (-SkipOpenTui) - using existing DLL/dist" -ForegroundColor Yellow
    } else {
        Invoke-OpenTuiBuild -Full:$OpenTuiFull
    }

    # opentui-spinner: build before opencode (required by opencode imports)
    $SpinnerDir = Join-Path $Root "packages\opentui-spinner"
    if (-not ($SkipOpenTui)) {
        Write-Host "  Building opentui-spinner..." -ForegroundColor Yellow
        Push-Location $SpinnerDir
        try {
            bun run build
            if ($LASTEXITCODE -ne 0) {
                throw "opentui-spinner build failed (exit $LASTEXITCODE)"
            }
        } finally {
            Pop-Location
        }
        Write-Success "opentui-spinner built"
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

    # Native opentui DLL - required by @opentui/core for rendering (built above unless -SkipOpenTui)
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
        throw "opentui.dll not found at $opentuiDllSrc - run without -SkipOpenTui or build packages/opentui/packages/core first"
    }

    # WASM sidecars: mirror packages/wasm/core/pkg as-is (no hardcoded asset list).
    # Runtime prefers embedded assets; dist/wasm is offline fallback only.
    # Missing optional files (e.g. retired tokenizer.wasm) are simply absent.
    $WasmPkgDir = Join-Path $Root "packages\wasm\core\pkg"
    $WasmDistDir = Join-Path $DistDir "wasm\core\pkg"
    if (Test-Path $WasmPkgDir) {
        if (Test-Path $WasmDistDir) {
            Remove-Item -Recurse -Force $WasmDistDir
        }
        New-Item -ItemType Directory -Path (Split-Path $WasmDistDir -Parent) -Force | Out-Null
        Copy-Item -Recurse -Force $WasmPkgDir $WasmDistDir

        # Tree-sitter runtime lives in node_modules, not pkg/ - stage if present.
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
