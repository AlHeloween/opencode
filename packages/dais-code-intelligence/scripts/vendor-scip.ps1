[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$moduleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $moduleRoot '../../external/scip'))
$targetRoot = Join-Path $moduleRoot 'internal/scipwire'
$pins = @(
    @{ Source = 'scip.proto'; Target = $null; Hash = '6795900ddf664f2fe12528b1b28eaf39fdf8c12707db1408a727cee83ea978c3' },
    @{ Source = 'bindings/go/scip/scip.pb.go'; Target = 'scip.pb.go'; Hash = '61179ef826a83046aea36226ab63fcd598e66d6c53702536eff5e5d73dd70307' },
    @{ Source = 'LICENSE'; Target = 'LICENSE'; Hash = '1eb85fc97224598dad1852b5d6483bbcf0aa8608790dcc657a5a2a761ae9c8c6' }
)
foreach ($pin in $pins) {
    $source = Join-Path $sourceRoot $pin.Source
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.Hash) {
        throw "Pinned SCIP source mismatch: $($pin.Source)"
    }
}
[void][IO.Directory]::CreateDirectory($targetRoot)
foreach ($pin in $pins) {
    if ($null -eq $pin.Target) { continue }
    $source = Join-Path $sourceRoot $pin.Source
    $target = Join-Path $targetRoot $pin.Target
    [IO.File]::WriteAllBytes($target, [IO.File]::ReadAllBytes($source))
    $readback = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($readback -ne $pin.Hash) { throw "SCIP byte-copy readback mismatch: $($pin.Target)" }
    Write-Output "$($pin.Target) SHA256 $readback"
}
