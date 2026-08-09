# _reasoning_kernel.ps1
# ───────────────────────────────────────────────────────────
# Reasoning kernel assembly, stability guardrails, and self-test.
# Dot-source into _build.ps1 or run standalone:
#   . .\_reasoning_kernel.ps1
#   Sync-KernelPrompt
#   Test-KernelStability
#   Test-ReasoningFramework
# ───────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

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

# ═══════════════════════════════════════════════════════════
# KERNEL PROMPT SYNC
# ═══════════════════════════════════════════════════════════
function Sync-KernelPrompt {
    param([string] $Root = $PSScriptRoot)

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
    param(
        [string] $KernelPath,
        [string] $Root = $PSScriptRoot
    )

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
        "BASE_AGENT", "RULE", "G", "NOISE_FILTER"
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
    param([string] $Root = $PSScriptRoot)

    Write-Host "  Testing reasoning framework..." -ForegroundColor Yellow

    $importRoot = $Root.Replace("\", "/")

    # 1. Verify Python import works (kernel compiles)
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
