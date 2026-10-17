[CmdletBinding()]
param([string]$Go = 'go')

$ErrorActionPreference = 'Stop'
$module = 'github.com/scip-code/scip/bindings/go/scip@v0.7.1'
$target = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../internal/scipmodern'))
[void][IO.Directory]::CreateDirectory($target)
Push-Location -LiteralPath (Join-Path $PSScriptRoot 'modern-scip-descriptor')
try {
    $info = & $Go mod download -json $module | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $info.Dir) { throw 'Pinned SCIP module download failed' }
    & $Go run -mod=mod . $target $info.Dir
    if ($LASTEXITCODE -ne 0) { throw 'Modern SCIP descriptor generation failed' }
} finally {
    Pop-Location
}
