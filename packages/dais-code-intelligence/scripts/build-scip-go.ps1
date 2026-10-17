[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$Go,
    [Parameter(Mandatory)][string]$Scratch,
    [Parameter(Mandatory)][string]$Destination
)

$ErrorActionPreference = 'Stop'
foreach ($value in @($SourceRoot, $Go, $Scratch, $Destination)) {
    if (-not [IO.Path]::IsPathFullyQualified($value)) { throw 'Absolute paths are required' }
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$Scratch = [IO.Path]::GetFullPath($Scratch)
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Scratch) { throw 'Scratch must be a new caller-owned directory' }
if (Test-Path -LiteralPath $Destination) { throw 'Destination must not already exist' }
$source = Join-Path $SourceRoot 'internal/visitors/visitor_file.go'
$expectedBefore = 'fbab6b7f228809fc670d684242f6767ae4ad704fb1fbb744360caad188556018'
$expectedAfter = 'a1827a2106e1fd6a5ab03624999d688a91f1e3c7e5c8ceb93ad88778d02f6969'
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedBefore) {
    throw 'scip-go v0.2.7 source pin mismatch'
}
$module = [IO.File]::ReadAllText((Join-Path $SourceRoot 'go.mod'))
if ($module -notmatch '^module github.com/scip-code/scip-go\s') { throw 'Unexpected producer module' }
$pins = [ordered]@{}
$totalBytes = 0L
foreach ($file in [IO.Directory]::EnumerateFiles($SourceRoot, '*', [IO.SearchOption]::AllDirectories)) {
    if ($pins.Count -ge 129) { throw 'Producer source file count exceeds the qualified tree' }
    $size = [IO.FileInfo]::new($file).Length
    $totalBytes += $size
    if ($size -gt 18908 -or $totalBytes -gt 399003) { throw 'Producer source bytes exceed the qualified tree' }
    $relative = [IO.Path]::GetRelativePath($SourceRoot, $file).Replace('\', '/')
    $pin = (Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()
    $pins[$relative] = $pin
}
$names = [string[]]@($pins.Keys)
[Array]::Sort($names, [StringComparer]::Ordinal)
$tree = [Text.StringBuilder]::new()
foreach ($name in $names) {
    [void]$tree.Append($name.Replace('\', '/')).Append([char]0).Append($pins[$name]).Append("`n")
}
$treeHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($tree.ToString()))).ToLowerInvariant()
if ($treeHash -ne '9e9780c217cb827727ca876e4e8c137109f7f900fad86538d4115f8aaf159ed8') {
    throw 'Producer source tree differs from the qualified v0.2.7 module'
}
[void][IO.Directory]::CreateDirectory($Scratch)
$candidateRoot = Join-Path $Scratch 'source'
foreach ($relative in $pins.Keys) {
    $copy = Join-Path $candidateRoot $relative
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($copy))
    [IO.File]::Copy((Join-Path $SourceRoot $relative), $copy, $false)
    if ((Get-FileHash -LiteralPath $copy).Hash.ToLowerInvariant() -ne $pins[$relative]) { throw "Source copy mismatch: $relative" }
}
$candidate = Join-Path $candidateRoot 'internal/visitors/visitor_file.go'
if ((Get-FileHash -LiteralPath $candidate).Hash.ToLowerInvariant() -ne $expectedBefore) { throw 'Copy readback mismatch' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$patch = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../compat/scip-go/position-encoding.patch'))
$patchDirectory = [IO.Path]::GetDirectoryName($candidate)
& git -C $repoRoot apply --check --unsafe-paths --directory $patchDirectory --whitespace=nowarn $patch
if ($LASTEXITCODE -ne 0) { throw 'Reviewed position-encoding patch does not apply' }
& git -C $repoRoot apply --unsafe-paths --directory $patchDirectory --whitespace=nowarn $patch
if ($LASTEXITCODE -ne 0) { throw 'Position-encoding patch failed' }
$normalized = [Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText($candidate).Replace("`r`n", "`n"))
if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($normalized)).ToLowerInvariant() -ne $expectedAfter) {
    throw 'Patched source differs from the qualified candidate'
}
& $Go -C $candidateRoot build -mod=readonly -buildvcs=false -o $Destination ./cmd/scip-go
if ($LASTEXITCODE -ne 0) { throw 'Native producer build failed' }
foreach ($relative in $pins.Keys) {
    if ((Get-FileHash -LiteralPath (Join-Path $SourceRoot $relative)).Hash.ToLowerInvariant() -ne $pins[$relative]) {
        throw "Original producer module changed: $relative"
    }
}
[ordered]@{
    version = 'scip-go v0.2.7 + DAIS declared UTF8 positions'
    executable = $Destination
    executable_sha256 = (Get-FileHash -LiteralPath $Destination).Hash.ToLowerInvariant()
    source_sha256 = $expectedBefore
    source_tree_sha256 = $treeHash
    candidate_source_normalized_sha256 = $expectedAfter
    copied_files = $pins.Count
    patch_sha256 = (Get-FileHash -LiteralPath $patch).Hash.ToLowerInvariant()
    go_executable_sha256 = (Get-FileHash -LiteralPath $Go).Hash.ToLowerInvariant()
} | ConvertTo-Json
