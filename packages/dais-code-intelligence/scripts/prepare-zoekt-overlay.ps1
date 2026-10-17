[CmdletBinding()]
param(
    [string]$Scratch,
    [string]$TargetOS = $env:GOOS
)

$ErrorActionPreference = 'Stop'
if (-not $TargetOS) {
    $TargetOS = if ($IsWindows) { 'windows' } else { 'linux' }
}
if ($TargetOS -ne 'windows') {
    return
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$upstream = Join-Path $repoRoot 'external/zoekt'
$compat = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../compat/zoekt'))
if (-not $Scratch) {
    $Scratch = Join-Path $PSScriptRoot ('.scratch/zoekt-windows-' + [Guid]::NewGuid().ToString('N'))
}
$Scratch = [IO.Path]::GetFullPath($Scratch)

$expectedHead = '74e1e85839697c4c4eb8a6223cc3971e6c26da45'
$head = & git -C $upstream rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head.Trim() -ne $expectedHead) {
    throw "Zoekt HEAD mismatch; expected $expectedHead, observed $head"
}

function Get-NormalizedHash([string]$Path) {
    $text = [IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

$source = Join-Path $upstream 'index/builder.go'
$expectedBefore = '488ba0faee8b9d1b902400e89850d7b1e74114bdc3873f9ec128dcddd3b5d22e'
$expectedAfter = '2b9d4e4e4db3d316420f271b678d2a31f16be85162f34caa6e639ea59a94a16c'
if ((Get-NormalizedHash $source) -ne $expectedBefore) {
    throw 'Zoekt builder source differs from the qualified revision'
}

[void][IO.Directory]::CreateDirectory($Scratch)
$candidate = Join-Path $Scratch 'builder.go'
Copy-Item -LiteralPath $source -Destination $candidate -Force
if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $candidate).Hash) {
    throw 'Builder copy is not byte-identical'
}
$patch = Join-Path $compat 'builder-windows.patch'
& git -C $repoRoot apply --check --unsafe-paths --directory $Scratch --ignore-space-change --whitespace=nowarn $patch
if ($LASTEXITCODE -ne 0) {
    throw 'Reviewed Windows builder patch does not apply'
}
& git -C $repoRoot apply --unsafe-paths --directory $Scratch --ignore-space-change --whitespace=nowarn $patch
if ($LASTEXITCODE -ne 0) {
    throw 'Reviewed Windows builder patch failed'
}
if ((Get-NormalizedHash $candidate) -ne $expectedAfter) {
    throw 'Patched builder differs from the qualified candidate'
}
if ((Get-NormalizedHash $source) -ne $expectedBefore) {
    throw 'External builder changed during preparation'
}

$replace = [ordered]@{}
$replace[[IO.Path]::GetFullPath($source)] = $candidate
$replace[[IO.Path]::GetFullPath((Join-Path $upstream 'index/indexfile_windows.go'))] = Join-Path $compat 'indexfile_windows.go'
$overlayPath = Join-Path $Scratch 'overlay.json'
$json = @{ Replace = $replace } | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($overlayPath, $json, [Text.UTF8Encoding]::new($false))
$readback = Get-Content -LiteralPath $overlayPath -Raw | ConvertFrom-Json
if (@($readback.Replace.PSObject.Properties).Count -ne 2) {
    throw 'Overlay readback did not contain exactly two mappings'
}
Write-Output $overlayPath
