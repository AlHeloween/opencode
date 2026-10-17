[CmdletBinding()]
param(
    [ValidateSet('build', 'test')][string]$Action = 'build',
    [string[]]$Packages,
    [string]$Go = 'go',
    [string]$Scratch,
    [string]$TargetOS = $env:GOOS,
    [string]$OutputName
)

$ErrorActionPreference = 'Stop'
$moduleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Packages) {
    if ($Action -eq 'test') {
        throw 'Pass explicit focused package paths with -Packages for tests'
    }
    $Packages = @('./cmd/dais-ci')
}
$Packages = @($Packages | ForEach-Object { $_ -split ',' })
if ($Action -eq 'test' -and ($Packages -contains './...' -or $Packages -contains '.')) {
    throw 'Tests require explicit focused package paths'
}
if (-not $TargetOS) {
    $TargetOS = if ($IsWindows) { 'windows' } else { 'linux' }
}
$overlay = & (Join-Path $PSScriptRoot 'prepare-zoekt-overlay.ps1') -Scratch $Scratch -TargetOS $TargetOS
$goArgs = @($Action, '-buildvcs=false')
if ($overlay) {
    $goArgs += @('-overlay', $overlay)
}
if ($Action -eq 'test') {
    $goArgs += @('-count=1', '-v', '-timeout=180s')
}
if ($Action -eq 'build') {
    if (-not $OutputName) {
        $OutputName = if ($TargetOS -eq 'windows') { 'dais-ci.exe' } else { 'dais-ci' }
    }
    if ([IO.Path]::GetFileName($OutputName) -ne $OutputName -or $OutputName -in @('.', '..')) {
        throw 'OutputName must be a filename inside module/dist'
    }
    $dist = Join-Path $moduleRoot 'dist'
    [void][IO.Directory]::CreateDirectory($dist)
    $goArgs += @('-o', (Join-Path $dist $OutputName))
}
$goArgs += $Packages
$previousGOOS = $env:GOOS
Push-Location -LiteralPath $moduleRoot
try {
    $env:GOOS = $TargetOS
    & $Go @goArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Go $Action failed with exit code $LASTEXITCODE"
    }
} finally {
    $env:GOOS = $previousGOOS
    Pop-Location
}
