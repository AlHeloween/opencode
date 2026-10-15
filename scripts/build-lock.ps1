# build-lock.ps1 — exclusive build lock + t55 maintenance-marker honour for _build.ps1.
#
# t58 (plans/2026-10-15_build-lock.md): a brief line does not hold back parallel builds —
# the build script must. A second _build.ps1 while the holder's pid is alive refuses at once.
#
# Usage from _build.ps1 (dot-sourced — functions only, no side effects):
#   . (Join-Path $Root "scripts\build-lock.ps1")
#   $lockCode = Acquire-BuildLock -ForceBuild:$ForceBuild   # 0 ok · 3 locked · 4 maintenance
#   if ($lockCode -ne 0) { exit $lockCode }
#   try { ...build... } finally { Release-BuildLock }
#
# Standalone (tests / probing):
#   pwsh -NoProfile -File scripts/build-lock.ps1 -Acquire [-HoldSeconds N] [-FailAfterAcquire] [-ForceBuild]
#   pwsh -NoProfile -File scripts/build-lock.ps1 -Release
#
# Lock file: .opencode/data/build/build.lock — the runtime state plane the project already uses
# (Global.Path.data = {worktree}/.opencode/data, same plane as t55's .opencode/data/promotion).
# NOT under dist/ or .temp/test/: the build itself cleans both, so a lock there would be swept
# mid-run. Content (JSON): { pid, started, caller } — caller is $env:OPENCODE_SESSION_ID when
# present, else "manual".
#
# Maintenance marker: REUSED from t55 (scripts/promote_bin.py:484) — $env:ORG_HOME/maintenance,
# else ~/.org/maintenance. No second flag. While present the build refuses unless -ForceBuild.
#
# -ForceBuild bypasses the MAINTENANCE marker only (coordination signal), printed as OVERRIDE.
# It never bypasses the exclusive lock: a live holder pid means a build is physically running,
# and overriding that would re-create the 2026-10-14 parallel-build loop (runs 1338/1339/1340).
#
# Fixture seam (tests only): $env:BUILD_LOCK_DIR and $env:BUILD_MAINTENANCE_MARKER override the
# two paths so the Bun oracle never touches real state.
param(
    [switch] $Acquire,

    [switch] $Release,

    [int] $HoldSeconds = 0,

    [switch] $FailAfterAcquire,

    [switch] $ForceBuild
)

$ErrorActionPreference = "Stop"

function Get-BuildLockPath {
    if ($env:BUILD_LOCK_DIR) { return (Join-Path $env:BUILD_LOCK_DIR "build.lock") }
    $repoRoot = Split-Path $PSScriptRoot -Parent
    return (Join-Path $repoRoot ".opencode\data\build\build.lock")
}

function Get-MaintenanceMarkerPath {
    if ($env:BUILD_MAINTENANCE_MARKER) { return $env:BUILD_MAINTENANCE_MARKER }
    $orgHome = $env:ORG_HOME
    if (-not $orgHome) { $orgHome = Join-Path $HOME ".org" }
    return (Join-Path $orgHome "maintenance")
}

function Test-ProcessAlive {
    param([int] $ProcessId)
    if ($ProcessId -le 0) { return $false }
    return ($null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

function Read-LockHolder {
    param([string] $LockPath)
    try {
        return (Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Acquire-BuildLock {
    param([switch] $ForceBuild)
    $marker = Get-MaintenanceMarkerPath
    if (Test-Path -LiteralPath $marker) {
        if (-not $ForceBuild) {
            Write-Host "BUILD BLOCKED: maintenance marker present at $marker (bin promotion in progress) — build refused. Re-run with -ForceBuild to override (fleet lead only)."
            return 4
        }
        Write-Host "OVERRIDE: -ForceBuild given, maintenance marker at $marker ignored."
    }
    $lockPath = Get-BuildLockPath
    if (Test-Path -LiteralPath $lockPath) {
        $holder = Read-LockHolder -LockPath $lockPath
        $holderPid = 0
        if ($holder -and $holder.pid) { [int]::TryParse([string] $holder.pid, [ref] $holderPid) | Out-Null }
        if (($holderPid -gt 0) -and (Test-ProcessAlive -ProcessId $holderPid)) {
            Write-Host "BUILD BLOCKED: another build holds the lock (pid=$holderPid, caller=$($holder.caller), started=$($holder.started)) — lock: $lockPath. Refusing."
            return 3
        }
        $staleInfo = "unreadable lock file"
        if ($holderPid -gt 0) { $staleInfo = "pid=$holderPid, caller=$($holder.caller), started=$($holder.started)" }
        Write-Host "STALE build lock ($staleInfo) — holder pid is dead, taking over: $lockPath"
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    }
    $caller = $env:OPENCODE_SESSION_ID
    if (-not $caller) { $caller = "manual" }
    $record = @{ pid = $PID; started = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"); caller = $caller }
    $dir = Split-Path $lockPath -Parent
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    try {
        $stream = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    } catch [IO.IOException] {
        # Lost a same-instant race: whoever won is now the holder — report them.
        $holder = Read-LockHolder -LockPath $lockPath
        Write-Host "BUILD BLOCKED: another build holds the lock (pid=$($holder.pid), caller=$($holder.caller), started=$($holder.started)) — lock: $lockPath. Refusing."
        return 3
    }
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress))
        $stream.Write($bytes, 0, $bytes.Length)
    } finally {
        $stream.Close()
    }
    Write-Host "BUILD LOCK acquired (pid=$PID, caller=$caller): $lockPath"
    return 0
}

function Release-BuildLock {
    $lockPath = Get-BuildLockPath
    if (-not (Test-Path -LiteralPath $lockPath)) { return }
    $holder = Read-LockHolder -LockPath $lockPath
    $holderPid = 0
    if ($holder -and $holder.pid) { [int]::TryParse([string] $holder.pid, [ref] $holderPid) | Out-Null }
    if ($holderPid -eq $PID) {
        Remove-Item -LiteralPath $lockPath -Force
        Write-Host "BUILD LOCK released: $lockPath"
    } else {
        Write-Host "BUILD LOCK not ours (holder pid=$holderPid, me=$PID) — leaving it in place: $lockPath"
    }
}

# CLI entry — skipped when dot-sourced (then this file defines functions only).
if ($MyInvocation.InvocationName -ne '.') {
    if ($Release) {
        Release-BuildLock
        exit 0
    }
    if ($Acquire) {
        $code = Acquire-BuildLock -ForceBuild:$ForceBuild
        if ($code -ne 0) { exit $code }
        try {
            if ($FailAfterAcquire) { throw "simulated holder failure (-FailAfterAcquire)" }
            if ($HoldSeconds -gt 0) { Start-Sleep -Seconds $HoldSeconds }
        } finally {
            Release-BuildLock
        }
        exit 0
    }
    Write-Host "Usage: build-lock.ps1 -Acquire [-HoldSeconds N] [-FailAfterAcquire] [-ForceBuild] | -Release"
    Write-Host ""
    Write-Host "  -Acquire            take the exclusive lock (exit 0), hold, then release"
    Write-Host "  -HoldSeconds N      hold the lock N seconds before releasing (concurrency probe)"
    Write-Host "  -FailAfterAcquire   throw after acquiring (release path probe — lock must still go)"
    Write-Host "  -ForceBuild         bypass the t55 maintenance marker (printed OVERRIDE, lock still enforced)"
    Write-Host "  -Release            release the lock held by this process, if any"
    Write-Host ""
    Write-Host "Exit codes: 0 ok · 3 another build holds the lock · 4 maintenance marker blocks."
    exit 2
}
