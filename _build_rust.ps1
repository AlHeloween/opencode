# Build Rust modules for opencode (native binary + WASM)

$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$NativeDir = Join-Path $RepoRoot "packages\native\markdownify"
$WasmDir = Join-Path $RepoRoot "packages\wasm\markdownify"
$WasmPkgDir = Join-Path $WasmDir "pkg"

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

# Build WASM module (legacy, kept for compatibility)
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
    foreach ($f in $srcFiles) {
        if ($f.LastWriteTime -gt $wasmTime) { return $true }
    }

    return $false
}

if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
    Write-Host "Installing wasm-pack..."
    cargo install wasm-pack
}

if (Test-WasmNeedsRebuild) {
    Write-Host "Building markdownify WASM module..."
    Push-Location $WasmDir
    wasm-pack build --target web --release --no-opt
    Pop-Location
    Write-Host "WASM build complete: $WasmPkgDir"
} else {
    Write-Host "WASM module up to date, skipping rebuild."
}
