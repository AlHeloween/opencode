# test-scratch.ps1 — live-aware cleanup of the test scratch dir (.temp/test).
#
# t74 (plans/2026-10-16_build-cleanup-vs-tests.md): _build.ps1's first phase deleted
# EVERY entry under .temp/test/ while other robots' tests were still running in them
# (t73 measured 0/6 llm.test.ts at ~11:01Z: 5x ENOENT in ensureGitignore plus
# SQLITE_CANTOPEN errno 14). This helper deletes only what no live test owns;
# _build.ps1 calls it instead of removing entries blindly.
#
# Ownership (checked per top-level entry):
#   1. sibling marker `<dir>.owner.json` {pid, started} with a LIVE pid -> SKIP.
#      Written by packages/opencode/test/fixture/fixture.ts NEXT TO every tmpdir —
#      never inside it: an inside marker breaks the git-porcelain-clean fixture test
#      (test/git/git.test.ts:19) and the ripgrep exact file listings
#      (test/file/ripgrep.test.ts:158,177), measured t74. The fixture removes its own
#      marker on dispose; orphans (a marker whose dir is gone, e.g. a crashed run,
#      or whose pid is dead) are deleted with the sweep.
#   2. `opencode-test-data-<pid>` with a LIVE pid -> SKIP (test/preload.ts
#      per-process dirs carry the pid in the name; preload is untouched).
#   3. LastWriteTimeUtc younger than -ProtectMinutes (default 60) -> SKIP. Covers
#      live dirs of old code without markers and short-lived fixtures (build-lock/
#      is seconds old). 60 = 30x the measured per-file wall (121 s under 6x
#      contention, test/session/llm.test.ts:35-37) and 3x the forbidden full suite
#      (18 min, AGENTS.md); the 80 GB mass is hours/days old and still goes.
# Dead/old entries are removed entry by entry with honest reporting (the t_03
# pattern: a survivor is named, never reported as cleaned).
#
# Usage from _build.ps1 (dot-sourced — functions only, no side effects):
#   . (Join-Path $Root "scripts\test-scratch.ps1")
#   Clear-TestScratch -Path <dir> -Label ".temp/test/"
#
# Standalone (tests / probing):
#   pwsh -NoProfile -File scripts/test-scratch.ps1 -Clean [-ScratchDir <dir>] [-ProtectMinutes N]
#
# Fixture seam (tests only): $env:TEST_SCRATCH_DIR overrides the real .temp/test/
# so the Bun oracle never touches real state (t58 pattern from build-lock.ps1).
param(
    [switch] $Clean,

    [string] $ScratchDir = "",

    [int] $ProtectMinutes = 60
)
$ErrorActionPreference = "Stop"

function Get-TestScratchDir {
    if ($script:ScratchDir) { return $script:ScratchDir }
    if ($env:TEST_SCRATCH_DIR) { return $env:TEST_SCRATCH_DIR }
    $repoRoot = Split-Path $PSScriptRoot -Parent
    return (Join-Path $repoRoot ".temp\test")
}

function Test-ScratchProcessAlive {
    param([int] $ProcessId)
    if ($ProcessId -le 0) { return $false }
    return ($null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

function Read-ScratchOwnerPid {
    param([string] $MarkerPath)
    try {
        $owner = (Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json)
        $ownerPid = 0
        if ($owner -and $owner.pid) { [int]::TryParse([string] $owner.pid, [ref] $ownerPid) | Out-Null }
        return $ownerPid
    } catch {
        return 0
    }
}

# Returns "" when the entry may be removed, else the human reason it is kept.
function Test-ScratchEntryKeepReason {
    param($Entry, [int] $ProtectMinutes)
    if ($Entry.PSIsContainer) {
        $marker = $Entry.FullName + ".owner.json"
        if (Test-Path -LiteralPath $marker) {
            $ownerPid = Read-ScratchOwnerPid -MarkerPath $marker
            if ($ownerPid -gt 0) {
                if (Test-ScratchProcessAlive -ProcessId $ownerPid) {
                    return "owner pid=$ownerPid alive"
                }
                # A marker naming a dead pid is authoritative: nobody owns this dir,
                # whatever its age — the recency fallback is only for UNKNOWN ownership.
                return ""
            }
            # Unreadable marker: ownership unknown — fall through to the age check.
        }
        if ($Entry.Name -match '^opencode-test-data-(\d+)$') {
            $namedPid = [int] $Matches[1]
            if (Test-ScratchProcessAlive -ProcessId $namedPid) {
                return "per-process dir pid=$namedPid alive"
            }
            # Leftover of a dead process: nobody owns it, whatever its age.
            return ""
        }
    } else {
        # A sibling owner marker protects nothing on its own: it is kept only while
        # its owner pid lives AND its dir still exists. Otherwise it is sweep litter.
        if ($Entry.Name -like "*.owner.json") {
            $ownerPid = Read-ScratchOwnerPid -MarkerPath $Entry.FullName
            $sibling = $Entry.FullName -replace '\.owner\.json$',''
            if (($ownerPid -gt 0) -and (Test-ScratchProcessAlive -ProcessId $ownerPid) -and (Test-Path -LiteralPath $sibling)) {
                return "live owner's marker"
            }
            return ""
        }
    }
    $ageMin = ((Get-Date).ToUniversalTime() - $Entry.LastWriteTimeUtc).TotalMinutes
    if ($ageMin -lt $ProtectMinutes) {
        return ("recent ({0:N0} min old, no live owner)" -f $ageMin)
    }
    return ""
}

function Clear-TestScratch {
    param([string] $Path, [string] $Label, [int] $ProtectMinutes = 60)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Write-Host "  Cleaning $Label..." -ForegroundColor Yellow
    $kept = @()
    $failed = @()
    $removed = 0
    foreach ($entry in Get-ChildItem -LiteralPath $Path -Force) {
        $reason = Test-ScratchEntryKeepReason -Entry $entry -ProtectMinutes $ProtectMinutes
        if ($reason) { $kept += "$($entry.Name) ($reason)"; continue }
        try {
            Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction Stop
            # A dead owner's sibling marker goes with its dir, whichever is listed first.
            $marker = $entry.FullName + ".owner.json"
            if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker -Force -ErrorAction Stop }
            $removed += 1
        } catch {
            $failed += "$($entry.Name): $($_.Exception.Message)"
        }
    }
    if ($failed.Count -gt 0) {
        Write-Host "  [WARN] $Label - $($failed.Count) entries still in use, left in place:" -ForegroundColor Yellow
        $failed | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    }
    if ($kept.Count -gt 0) {
        Write-Host "  [SKIP] $Label - $($kept.Count) live entries left in place:" -ForegroundColor Cyan
        $kept | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" -ForegroundColor Cyan }
    }
    if ($failed.Count -eq 0 -and $kept.Count -eq 0) {
        Write-Host "  [OK] $Label cleaned ($removed removed)" -ForegroundColor Green
    } elseif ($failed.Count -eq 0) {
        Write-Host "  [OK] $Label swept ($removed removed, $($kept.Count) live kept)" -ForegroundColor Green
    }
}

# CLI entry — skipped when dot-sourced (then this file defines functions only).
if ($MyInvocation.InvocationName -ne '.') {
    if ($Clean) {
        Clear-TestScratch -Path (Get-TestScratchDir) -Label "test scratch" -ProtectMinutes $ProtectMinutes
        exit 0
    }
    Write-Host "Usage: test-scratch.ps1 -Clean [-ScratchDir <dir>] [-ProtectMinutes N]"
    Write-Host ""
    Write-Host "  -Clean               sweep the scratch dir, skipping live test dirs"
    Write-Host "  -ScratchDir <dir>    sweep this dir instead of .temp/test/ (fixture use)"
    Write-Host "  -ProtectMinutes N    keep unmarked entries younger than N minutes (default 60)"
    Write-Host ""
    Write-Host "Seam: TEST_SCRATCH_DIR overrides the real .temp/test/ (fixture tests)."
    exit 2
}
