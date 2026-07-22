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
$DiffyWasmDir = Join-Path $RepoRoot "packages\wasm\diffy-wasm"
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
$RdiffDir = Join-Path $RepoRoot "packages\wasm\rdiff"
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
$JsonRepairDir = Join-Path $RepoRoot "packages\wasm\json-repair\json-repair"
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

# Build anyrepair WASM module (multi-format repair: JSON, XML, YAML, etc.)
$AnyrepairDir = Join-Path $RepoRoot "packages\wasm\anyrepair"
$AnyrepairOut = Join-Path $WasmCorePkg "anyrepair"
if (Test-Path $AnyrepairDir) {
    Write-Host "Building anyrepair WASM module..."
    Push-Location $AnyrepairDir
    wasm-pack build --target nodejs --no-opt
    Pop-Location
    if (-not (Test-Path $AnyrepairOut)) { New-Item -ItemType Directory -Path $AnyrepairOut | Out-Null }
    Copy-Item -Recurse -Force "$AnyrepairDir\pkg\*" $AnyrepairOut
    Write-Host "anyrepair WASM staged to $AnyrepairOut"
}

# Build path_validator WASM (C → wasm32) for bash path feedback
$PathValidatorSrc = Join-Path $RepoRoot "packages\wasm\core\src\path_validator.c"
$PathValidatorOut = Join-Path $WasmCorePkg "path_validator.wasm"
$LlvmClang = "C:\Program Files\LLVM\bin\clang.exe"
$Clang = if (Test-Path $LlvmClang) { $LlvmClang } else { "clang" }
if (Test-Path $PathValidatorSrc) {
    $needs = $true
    if (Test-Path $PathValidatorOut) {
        $srcTime = (Get-Item $PathValidatorSrc).LastWriteTime
        $outTime = (Get-Item $PathValidatorOut).LastWriteTime
        if ($srcTime -le $outTime) { $needs = $false }
    }
    if ($needs) {
        Write-Host "Building path_validator.wasm..."
        if (-not (Test-Path $WasmCorePkg)) { New-Item -ItemType Directory -Path $WasmCorePkg -Force | Out-Null }
        & $Clang --target=wasm32 -Oz -Wall -Wextra -nostdlib `
            "-Wl,--no-entry" "-Wl,--export=pv_validate" "-Wl,--export=pv_version" `
            "-Wl,--import-memory" "-Wl,--allow-undefined" `
            -o $PathValidatorOut $PathValidatorSrc
        if ($LASTEXITCODE -ne 0) { throw "path_validator.wasm compile failed" }
        if (Get-Command wasm-opt -ErrorAction SilentlyContinue) {
            & wasm-opt -Oz -o $PathValidatorOut $PathValidatorOut
        }
        Write-Host "path_validator.wasm staged to $PathValidatorOut"
    } else {
        Write-Host "path_validator.wasm up to date, skipping rebuild."
    }
}
