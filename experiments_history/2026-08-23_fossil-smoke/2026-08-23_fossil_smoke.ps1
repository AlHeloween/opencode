# 2026-08-23_fossil_smoke.ps1 — timed smoke of fossil primitives on this machine.
# Purpose: attribute session undo slowness (SU-* tests >5s) to fossil CLI cost vs app overhead.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File experiments\2026-08-23_fossil-smoke\2026-08-23_fossil_smoke.ps1
$ErrorActionPreference = 'Continue'

# Prefer repo-bundled binary (canonical location), fallback to PATH.
$fossil = Join-Path $PSScriptRoot '..\bin\tools\fossil.exe'
if (-not (Test-Path $fossil)) { $fossil = 'fossil' }
Write-Output "fossil binary: $fossil"
& $fossil version

$work = Join-Path $PSScriptRoot '2026-08-23_fossil_smoke_work'
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Path $work | Out-Null
Push-Location $work

function Time-Op([string]$name, [scriptblock]$op) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $out = & $op 2>&1
    $sw.Stop()
    $code = $LASTEXITCODE
    Write-Host ("{0,-28} {1,7} ms   exit={2}" -f $name, $sw.ElapsedMilliseconds, $code)
    return [double]$sw.ElapsedMilliseconds
}

$total = 0.0
$total += Time-Op 'init'                 { & $fossil init repo.fossil }
$total += Time-Op 'open'                 { & $fossil open repo.fossil --force }
for ($i = 1; $i -le 5; $i++) {
    $n = $i
    $total += Time-Op "add file #$n"     { "content $n" | Set-Content "f$n.txt"; & $fossil add "f$n.txt" }
    $total += Time-Op "commit #$n"       { & $fossil commit -m "c$n" --no-warnings }
}
$total += Time-Op 'addremove'            { "new" | Set-Content 'g.txt'; & $fossil addremove }
$total += Time-Op 'commit after addrem'  { & $fossil commit -m c6 --no-warnings }
$total += Time-Op 'status'               { & $fossil status }
$total += Time-Op 'timeline'             { & $fossil timeline }
$total += Time-Op 'diff'                 { "changed" | Set-Content f1.txt; & $fossil diff }
$total += Time-Op 'ls'                   { & $fossil ls }

Pop-Location
Write-Output ("TOTAL: {0} ms across ops; workdir kept at {1}" -f $total, $work)
