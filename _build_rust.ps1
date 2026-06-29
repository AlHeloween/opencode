# Build Rust modules for opencode (native binary + WASM)

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$NativeDir = Join-Path $RepoRoot "packages\native\markdownify"
$WasmDir = Join-Path $RepoRoot "packages\wasm\markdownify"
$WasmPkgDir = Join-Path $WasmDir "pkg"
$WasmCorePkg = Join-Path $RepoRoot "packages\wasm\core\pkg"

# Build native binary
$NativeTarget = "release"
$NativeOutDir = Join-Path $NativeDir "target\$NativeTarget"
$NativeBin = Join-Path $NativeOutDir "opencode-markdownify.exe"

function Test-NativeNeedsRebuild {
    if (-not (Test-Path $NativeBin)) { return $true }

    $cargoToml = Join-Path $NativeDir "Cargo.toml"
    $srcDir = Join-Path $NativeDir "src"
    $binTime = (Get-Item $NativeBin).LastWriteTime

    $cargoTime = (Get-Item $cargoToml).LastWriteTime
    if ($cargoTime -gt $binTime) { return $true }

    $srcFiles = Get-ChildItem -Path $srcDir -Recurse -File -Include "*.rs"
    foreach ($f in $srcFiles) {
        if ($f.LastWriteTime -gt $binTime) { return $true }
    }

    return $false
}

if (Test-NativeNeedsRebuild) {
    Write-Host "Building markdownify native binary..."
    Push-Location $NativeDir
    cargo build --release
    Pop-Location
    Write-Host "Native build complete: $NativeBin"
} else {
    Write-Host "Native binary up to date, skipping rebuild."
}

# Check wasm-pack
if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    Write-Host "Installing wasm-pack..."
    cargo install wasm-pack
}

# Build markdownify WASM module
function Test-WasmNeedsRebuild {
    if (-not (Test-Path $WasmPkgDir)) { return $true }
    $wasmFile = Join-Path $WasmPkgDir "markdownify_wasm_bg.wasm"
    if (-not (Test-Path $wasmFile)) { return $true }
    $cargoToml = Join-Path $WasmDir "Cargo.toml"
    $srcDir = Join-Path $WasmDir "src"
    $wasmTime = (Get-Item $wasmFile).LastWriteTime
    $cargoTime = (Get-Item $cargoToml).LastWriteTime
    if ($cargoTime -gt $wasmTime) { return $true }
    $srcFiles = Get-ChildItem -Path $srcDir -Recurse -File -Include "*.rs"
    foreach ($f in $srcFiles) { if ($f.LastWriteTime -gt $wasmTime) { return $true } }
    return $false
}

if (Test-WasmNeedsRebuild) {
    Write-Host "Building markdownify WASM module..."
    Push-Location $WasmDir
    wasm-pack build --target web --release --no-opt
    Pop-Location
    Write-Host "WASM build complete: $WasmPkgDir"
} else {
    Write-Host "Markdownify WASM up to date, skipping rebuild."
}

# Build diffy-wasm module (unified diff: create + apply + parse)
$DiffyWasmDir = Join-Path $RepoRoot "packages\wasm\external\diffy-wasm"
$DiffyWasmOut = Join-Path $WasmCorePkg "diffy"
if (Test-Path $DiffyWasmDir) {
    Write-Host "Building diffy-wasm module..."
    Push-Location $DiffyWasmDir
    wasm-pack build --target nodejs
    Pop-Location
    if (-not (Test-Path $DiffyWasmOut)) { New-Item -ItemType Directory -Path $DiffyWasmOut | Out-Null }
    Copy-Item -Recurse -Force "$DiffyWasmDir\pkg\*" $DiffyWasmOut
    Write-Host "diffy-wasm staged to $DiffyWasmOut"
}

# Build rdiff (diff) WASM module (superseded by diffy, kept for compatibility)
$RdiffDir = Join-Path $RepoRoot "packages\wasm\external\justinbarclay-diff"
$RdiffPkg = Join-Path $RdiffDir "pkg"
$RdiffOut = Join-Path $WasmCorePkg "rdiff"
if (Test-Path $RdiffDir) {
    Write-Host "Building rdiff WASM module..."
    Push-Location $RdiffDir
    wasm-pack build --target nodejs
    Pop-Location
    if (-not (Test-Path $RdiffOut)) { New-Item -ItemType Directory -Path $RdiffOut | Out-Null }
    Copy-Item -Recurse -Force "$RdiffPkg\*" $RdiffOut
    Write-Host "rdiff WASM staged to $RdiffOut"
}

# Build json-repair WASM module (requires nightly)
$JsonRepairDir = Join-Path $RepoRoot "packages\wasm\external\json-repair\json-repair"
$JsonRepairOut = Join-Path $WasmCorePkg "json_repair"
if (Test-Path $JsonRepairDir) {
    Write-Host "Building json-repair WASM module (nightly)..."
    Push-Location $JsonRepairDir
    rustup run nightly wasm-pack build --target nodejs
    Pop-Location
    if (-not (Test-Path $JsonRepairOut)) { New-Item -ItemType Directory -Path $JsonRepairOut | Out-Null }
    Copy-Item -Recurse -Force "$JsonRepairDir\pkg\*" $JsonRepairOut
    Write-Host "json-repair WASM staged to $JsonRepairOut"
}
