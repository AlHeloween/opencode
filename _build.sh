#!/usr/bin/env bash
set -euo pipefail

# ─── Usage ───────────────────────────────────────────────────────────
usage() {
  cat <<'EOF'
Usage: ./_build.sh [check|build|release] [options]

Tasks:
  check   - Run typecheck, tests, and prettier
  build   - Rebuild OpenTUI (Zig+TS) then opencode; collect artifacts to dist/
  release - Run checks, build, and create release manifest

Options:
  --version <ver>     Override version for release (default: from package.json)
  --skip-tests        Skip test execution
  --skip-typecheck    Skip typecheck
  --skip-opentui      Skip OpenTUI Zig+TS rebuild (use existing binaries)
  --opentui-full      Full OpenTUI monorepo build (default: core+solid+three only)

OpenTUI build chain:
  packages/opentui/packages/core  → bun run build  (build:native + build:lib)
  packages/opentui/packages/solid → bun run build
  packages/opentui/packages/three → bun run build
  then packages/opencode script/build.ts --single (copies native lib into compile)
EOF
  exit 1
}

# ─── Helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

step() { echo -e "\n${CYAN}════════════════════════════════════════${NC}"; echo -e "${WHITE}  $*${NC}"; echo -e "${CYAN}════════════════════════════════════════${NC}\n"; }
ok()   { echo -e "  ${GREEN}[OK]${NC} $*"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $*"; }
warn() { echo -e "  ${YELLOW}[-]${NC} $*"; }

run_check() {
  local name="$1" script="$2"
  if eval "$script"; then
    ok "$name passed"
    return 0
  else
    fail "$name failed"
    return 1
  fi
}

get_version() {
  node -e "console.log(require('$ROOT/packages/opencode/package.json').version)"
}

# ─── Platform detection ──────────────────────────────────────────────
detect_platform() {
  PLATFORM_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  PLATFORM_ARCH="$(uname -m)"
  case "$PLATFORM_OS" in
    darwin)  PLATFORM_OS="darwin" ;;
    linux)   PLATFORM_OS="linux" ;;
    *)       echo "Unsupported OS: $PLATFORM_OS" >&2; exit 1 ;;
  esac
  case "$PLATFORM_ARCH" in
    x86_64|amd64) PLATFORM_ARCH="x64" ;;
    arm64|aarch64) PLATFORM_ARCH="arm64" ;;
    *)            echo "Unsupported arch: $PLATFORM_ARCH" >&2; exit 1 ;;
  esac

  # Native naming conventions
  case "$PLATFORM_OS" in
    darwin)
      NATIVE_EXT="dylib"
      NATIVE_PREFIX="lib"
      OPENCODE_PLATFORM="opencode-darwin-${PLATFORM_ARCH}"
      OPENTUI_PLATFORM="core-darwin-${PLATFORM_ARCH}"
      ;;
    linux)
      NATIVE_EXT="so"
      NATIVE_PREFIX="lib"
      OPENCODE_PLATFORM="opencode-linux-${PLATFORM_ARCH}"
      OPENTUI_PLATFORM="core-linux-${PLATFORM_ARCH}"
      ;;
  esac
}

# ─── Root paths ──────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT/dist"
OPENCODE_PKG="$ROOT/packages/opencode"
OPENTUI_ROOT="$ROOT/packages/opentui"

# ─── OpenTUI build ───────────────────────────────────────────────────
build_opentui() {
  local full="${1:-false}"

  if [ ! -d "$OPENTUI_ROOT" ]; then
    echo "OpenTUI root not found: $OPENTUI_ROOT" >&2
    exit 1
  fi

  if [ "$full" = "true" ]; then
    echo -e "  ${YELLOW}Building OpenTUI (full monorepo)...${NC}"
    (cd "$OPENTUI_ROOT" && bun run build) || { fail "OpenTUI full build failed"; exit 1; }
    ok "OpenTUI full monorepo build complete"
    return
  fi

  local core_dir="$OPENTUI_ROOT/packages/core"
  local solid_dir="$OPENTUI_ROOT/packages/solid"
  local three_dir="$OPENTUI_ROOT/packages/three"

  echo -e "  ${YELLOW}Building OpenTUI core (Zig native + TypeScript lib)...${NC}"
  (cd "$core_dir" && bun run build) || { fail "OpenTUI core build failed"; exit 1; }
  ok "OpenTUI core rebuilt (libopentui.${NATIVE_EXT} + dist/)"

  echo -e "  ${YELLOW}Building OpenTUI solid...${NC}"
  (cd "$solid_dir" && bun run build) || { fail "OpenTUI solid build failed"; exit 1; }
  ok "OpenTUI solid rebuilt"

  echo -e "  ${YELLOW}Building OpenTUI three...${NC}"
  (cd "$three_dir" && bun run build) || { fail "OpenTUI three build failed"; exit 1; }
  ok "OpenTUI three rebuilt"

  local native_lib="$OPENTUI_ROOT/packages/${OPENTUI_PLATFORM}/${NATIVE_PREFIX}opentui.${NATIVE_EXT}"
  if [ ! -f "$native_lib" ]; then
    fail "opentui native lib missing after core build: $native_lib"
    exit 1
  fi
  ok "OpenTUI native lib present ($native_lib)"
}

# ─── Kernel prompt sync ──────────────────────────────────────────────
sync_kernel_prompt() {
  local kernel_pkg="$ROOT/prompts_kernel"
  local kernel_dst="$OPENCODE_PKG/src/session/prompt/reasoning_prompt.mdc"

  if [ ! -d "$kernel_pkg" ]; then
    fail "Kernel package not found: $kernel_pkg"
    return 1
  fi

  # Precompile then assemble unified reasoning_prompt.mdc (matches _build.ps1)
  ( cd "$ROOT" && python3 -c "from prompts_kernel import write_precompiled_kernel; write_precompiled_kernel()" ) || {
    fail "Kernel precompilation failed"
    return 1
  }
  ( cd "$ROOT" && python3 -c "from prompts_kernel import write_reasoning; write_reasoning()" ) || {
    fail "write_reasoning → reasoning_prompt.mdc failed"
    return 1
  }
  if [ ! -f "$kernel_dst" ]; then
    fail "Kernel assembly missing output: $kernel_dst"
    return 1
  fi
  local size
  size=$(wc -c < "$kernel_dst" | tr -d ' ')
  ok "Reasoning prompt assembled ($size bytes)"
  return 0
}

# ─── Reasoning framework self-test ───────────────────────────────────
test_reasoning_framework() {
  echo -e "  ${YELLOW}Testing reasoning framework...${NC}"

  # 1. Kernel import
  local import_test
  import_test=$(python3 -c "
import sys; sys.path.insert(0, '$ROOT')
import prompts_kernel as k
print(f'OK: {len(k._KERNEL_SYMBOLS)} symbols, {len(k.PROJECTION_LIBRARY)} projections')
" 2>&1) || { fail "Kernel import failed"; echo "  $import_test" >&2; return 1; }
  ok "Kernel imports ($import_test)"

  # 2. IR roundtrip
  local ir_test
  ir_test=$(python3 -c "
import sys; sys.path.insert(0, '$ROOT')
import prompts_kernel as k
r = {'invariants': ['must balance'], 'constraints': ['must be safe']}
ir = k.compile_to_ir(r)
e = k.expand_from_ir(ir)
assert e == r, 'Roundtrip failed'
errs = k.validate_ir_equivalence(r, ir)
assert len(errs) == 0, f'Equivalence errors: {errs}'
print('OK: compile/expand/validate all pass')
" 2>&1) || { fail "IR roundtrip failed"; echo "  $ir_test" >&2; return 1; }
  ok "IR compilation roundtrip (identity)"

  # 3. MappingProxyType immutability
  python3 -c "
import sys; sys.path.insert(0, '$ROOT')
import prompts_kernel as k
try:
    k._KERNEL_SYMBOLS['_k_hack'] = 'value'
    print('FAIL: mutation should raise TypeError')
    exit(1)
except TypeError:
    print('OK: mutation blocked')
" 2>&1 || { fail "Immutability check failed"; return 1; }
  ok "MappingProxyType immutability (TypeError on write)"

  # 4. Kernel tests (prompts_kernel/tests/)
  local test_output
  test_output=$(python3 -m pytest "$ROOT/prompts_kernel/tests" -q --tb=no 2>&1) || {
    fail "pytest kernel suite failed"
    echo "  $test_output" >&2
    return 1
  }
  local summary
  summary=$(echo "$test_output" | grep "passed" | tail -1)
  ok "pytest kernel: $summary"

  # 5. Discipline projection hierarchy
  local hierarchy_test
  hierarchy_test=$(python3 -c "
import sys; sys.path.insert(0, '$ROOT')
import prompts_kernel as k
checks = 0
for name, proj in k.PROJECTION_LIBRARY.items():
    if proj.parent:
        assert proj.parent in k.PROJECTION_LIBRARY, f'{name}: parent {proj.parent} not found'
        checks += 1
    kp = proj.kernel_projection or {}
    has_inv = bool(kp.get('invariants', []))
    has_forb = bool(kp.get('forbidden_actions', []))
    assert has_inv or has_forb, f'{name}: no invariants or forbidden_actions'
print(f'OK: {checks} parent relationships verified')
" 2>&1) || { fail "Discipline hierarchy check failed"; echo "  $hierarchy_test" >&2; return 1; }
  ok "Discipline projection hierarchy ($hierarchy_test)"

  return 0
}

# ─── CHECK TASK ──────────────────────────────────────────────────────
task_check() {
  step "Running Checks"
  local all_passed=true

  # Clean .temp/test/
  if [ -d "$ROOT/.temp/test" ]; then
    echo -e "  ${YELLOW}Cleaning .temp/test/...${NC}"
    rm -rf "$ROOT/.temp/test"
    ok ".temp/test/ cleaned"
  fi

  # Sync kernel prompt
  sync_kernel_prompt || all_passed=false

  # Reasoning framework test
  test_reasoning_framework || all_passed=false

  # Typecheck
  if [ "$SKIP_TYPECHECK" = "false" ]; then
    run_check "Typecheck" "(cd '$OPENCODE_PKG' && bun typecheck)" || all_passed=false
  else
    warn "Skipping typecheck (--skip-typecheck)"
  fi

  # Tests
  if [ "$SKIP_TESTS" = "false" ]; then
    run_check "Tests" "(cd '$OPENCODE_PKG' && bun test)" || all_passed=false
  else
    warn "Skipping tests (--skip-tests)"
  fi

  # Prettier
  if bun run prettier --check "packages/opencode/src/**/*.ts" 2>&1; then
    ok "Prettier passed"
  else
    fail "Prettier failed"
    all_passed=false
  fi

  if [ "$all_passed" = "false" ]; then
    echo -e "\n${RED}Some checks failed. Fix the issues above and try again.${NC}"
    exit 1
  fi
  ok "All checks passed"
}

# ─── BUILD TASK ──────────────────────────────────────────────────────
task_build() {
  step "Building"

  # Clean .temp/test/
  if [ -d "$ROOT/.temp/test" ]; then
    echo -e "  ${YELLOW}Cleaning .temp/test/...${NC}"
    rm -rf "$ROOT/.temp/test"
    ok ".temp/test/ cleaned"
  fi

  # Sync kernel prompt
  sync_kernel_prompt || { fail "Kernel prompt sync failed"; exit 1; }

  # Reasoning framework self-test
  test_reasoning_framework || { fail "Reasoning framework self-test failed - kernel integrity broken"; exit 1; }

  # Build Rust WASM modules
  echo -e "  ${YELLOW}Building Rust WASM modules...${NC}"
  if [ -f "$ROOT/_build_rust.sh" ]; then
    bash "$ROOT/_build_rust.sh"
  elif [ -f "$ROOT/_build_rust.ps1" ]; then
    warn "_build_rust.sh not found — skipping Rust WASM (PowerShell-only _build_rust.ps1 present)"
  else
    warn "No Rust build script found — skipping WASM modules"
  fi

  # OpenTUI
  if [ "$SKIP_OPENTUI" = "true" ]; then
    warn "Skipping OpenTUI rebuild (--skip-opentui) — using existing binaries"
  else
    build_opentui "$OPENTUI_FULL"
  fi

  # opentui-spinner
  if [ "$SKIP_OPENTUI" != "true" ]; then
    local spinner_dir="$ROOT/packages/opentui-spinner"
    echo -e "  ${YELLOW}Building opentui-spinner...${NC}"
    (cd "$spinner_dir" && bun run build) || { fail "opentui-spinner build failed"; exit 1; }
    ok "opentui-spinner built"
  fi

  # Clean dist
  rm -rf "$DIST_DIR"
  mkdir -p "$DIST_DIR"

  # Build opencode package
  echo -e "  ${YELLOW}Building packages...${NC}"
  (cd "$OPENCODE_PKG" && bun run script/build.ts --single) || { fail "opencode script/build.ts failed"; exit 1; }
  ok "opencode package built"

  # ─── Collect artifacts ─────────────────────────────────────────────
  echo -e "  ${YELLOW}Collecting release artifacts...${NC}"

  # CLI script
  local cli_js="$OPENCODE_PKG/dist/cli.js"
  if [ -f "$cli_js" ]; then
    cp "$cli_js" "$DIST_DIR/cli.js"
    ok "CLI script copied"
  fi

  # Native binary
  local native_bin="$OPENCODE_PKG/dist/${OPENCODE_PLATFORM}/bin/opencode"
  if [ -f "$native_bin" ]; then
    mkdir -p "$DIST_DIR/bin"
    cp "$native_bin" "$DIST_DIR/bin/opencode"
    chmod +x "$DIST_DIR/bin/opencode"
    ok "Native binary copied (${OPENCODE_PLATFORM})"
  fi

  # Native markdownify binary
  local markdownify_src="$ROOT/packages/native/markdownify/target/release/opencode-markdownify"
  local markdownify_dest="$OPENCODE_PKG/dist/${OPENCODE_PLATFORM}/bin/opencode-markdownify"
  if [ -f "$markdownify_src" ]; then
    mkdir -p "$(dirname "$markdownify_dest")"
    cp "$markdownify_src" "$markdownify_dest"
    ok "Markdownify binary staged to platform dist"
  fi
  local markdownify_bin="$OPENCODE_PKG/dist/${OPENCODE_PLATFORM}/bin/opencode-markdownify"
  if [ -f "$markdownify_bin" ]; then
    mkdir -p "$DIST_DIR/bin"
    cp "$markdownify_bin" "$DIST_DIR/bin/opencode-markdownify"
    chmod +x "$DIST_DIR/bin/opencode-markdownify"
    ok "Markdownify binary copied"
  fi

  # Native opentui lib
  local opentui_lib="$OPENTUI_ROOT/packages/${OPENTUI_PLATFORM}/${NATIVE_PREFIX}opentui.${NATIVE_EXT}"
  if [ -f "$opentui_lib" ]; then
    # Copy to platform dist
    local opentui_platform_dest="$OPENCODE_PKG/dist/${OPENCODE_PLATFORM}/bin"
    mkdir -p "$opentui_platform_dest"
    cp "$opentui_lib" "$opentui_platform_dest/${NATIVE_PREFIX}opentui.${NATIVE_EXT}"
    # Copy to final dist/bin
    mkdir -p "$DIST_DIR/bin"
    cp "$opentui_lib" "$DIST_DIR/bin/${NATIVE_PREFIX}opentui.${NATIVE_EXT}"
    ok "opentui native lib copied (from rebuilt ${OPENTUI_PLATFORM})"
  else
    fail "opentui native lib not found at $opentui_lib"
    fail "Run without --skip-opentui or build packages/opentui/packages/core first"
    exit 1
  fi

  # WASM sidecars: mirror packages/wasm/core/pkg as-is (no hardcoded asset list).
  local wasm_src="$ROOT/packages/wasm/core/pkg"
  local wasm_dst="$DIST_DIR/wasm/core/pkg"
  if [ -d "$wasm_src" ]; then
    rm -rf "$wasm_dst"
    mkdir -p "$(dirname "$wasm_dst")"
    cp -a "$wasm_src" "$wasm_dst"

    # Tree-sitter runtime lives in node_modules, not pkg/ — stage if present.
    local ts_wasm
    ts_wasm=$(find "$ROOT/node_modules" -name "web-tree-sitter.wasm" -not -path "*/debug/*" 2>/dev/null | head -1)
    if [ -n "$ts_wasm" ]; then
      cp "$ts_wasm" "$wasm_dst/web-tree-sitter.wasm"
    fi

    local wasm_count
    wasm_count=$(find "$wasm_dst" -type f -name '*.wasm' | wc -l | tr -d ' ')
    if [ "${wasm_count:-0}" -lt 1 ]; then
      fail "WASM mirror produced zero .wasm files under $wasm_dst"
      exit 1
    fi
    ok "WASM modules mirrored to dist ($wasm_count .wasm files under wasm/core/pkg)"
  else
    warn "packages/wasm/core/pkg missing — skipping WASM sidecar copy"
  fi

  # SDK
  local sdk_dir="$ROOT/packages/sdk/js/dist"
  if [ -d "$sdk_dir" ]; then
    cp -r "$sdk_dir" "$DIST_DIR/sdk"
    ok "SDK copied"
  fi

  # App build
  local app_dist="$ROOT/packages/app/dist"
  if [ -d "$app_dist" ]; then
    cp -r "$app_dist" "$DIST_DIR/app"
    ok "App build copied"
  fi

  # Local services (artifacts_dist/)
  if [ -d "$ROOT/artifacts_dist" ]; then
    mkdir -p "$DIST_DIR/bin"
    for svc_dir in "$ROOT/artifacts_dist"/*/; do
      [ -d "$svc_dir" ] || continue
      local svc_name
      svc_name=$(basename "$svc_dir")
      cp -r "$svc_dir" "$DIST_DIR/bin/$svc_name"
      ok "Service $svc_name copied from artifacts_dist/"
    done
  fi

  # Package.json files
  for pkg_dir in "$ROOT/packages"/*/; do
    [ -d "$pkg_dir" ] || continue
    local pkg_json="$pkg_dir/package.json"
    if [ -f "$pkg_json" ]; then
      local pkg_name
      pkg_name=$(basename "$pkg_dir")
      mkdir -p "$DIST_DIR/packages/$pkg_name"
      cp "$pkg_json" "$DIST_DIR/packages/$pkg_name/"
    fi
  done

  ok "Build complete - artifacts in dist/"
}

# ─── RELEASE TASK ────────────────────────────────────────────────────
task_release() {
  local release_version="$VERSION"
  step "Creating Release $release_version"

  # Run checks first
  if [ "$SKIP_TYPECHECK" = "false" ] && [ "$SKIP_TESTS" = "false" ]; then
    task_check
  fi

  # Build
  task_build

  # Get version if not provided
  if [ -z "$release_version" ]; then
    release_version=$(get_version)
  fi

  # Create release manifest
  local manifest="$DIST_DIR/release-manifest.json"
  node -e "
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
function walk(dir, base) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    // Node 20 compat: fs.readdirSync recursive returns strings, not Dirent
    const fullPath = path.join(dir, entry);
    if (fs.statSync(fullPath).isFile()) {
      entries.push({ path: path.relative(base, fullPath).replace(/\\\\/g, '/'), size: fs.statSync(fullPath).size });
    }
  }
  return entries;
}
const manifest = {
  version: '$release_version',
  buildTime: new Date().toISOString(),
  gitSha: execSync('git rev-parse HEAD').toString().trim(),
  gitBranch: execSync('git rev-parse --abbrev-ref HEAD').toString().trim(),
  nodeVersion: process.version,
  artifacts: walk('$DIST_DIR', '$DIST_DIR')
};
fs.writeFileSync('$manifest', JSON.stringify(manifest, null, 2));
console.log('Release manifest created');
" || { fail "Failed to create release manifest"; exit 1; }
  ok "Release manifest created"

  echo -e "\n${GREEN}════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Release $release_version ready in dist/${NC}"
  echo -e "${GREEN}════════════════════════════════════════${NC}\n"
  echo -e "${YELLOW}Next steps:${NC}"
  echo -e "  1. Review dist/ contents"
  echo -e "  2. git add dist/ && git commit -m 'release: v$release_version'"
  echo -e "  3. git tag v$release_version"
  echo -e "  4. git push origin && git push origin v$release_version"
  echo ""
}

# ─── MAIN ────────────────────────────────────────────────────────────
TASK="${1:-build}"
shift 2>/dev/null || true

SKIP_TESTS="false"
SKIP_TYPECHECK="false"
SKIP_OPENTUI="false"
OPENTUI_FULL="false"
VERSION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tests)     SKIP_TESTS="true"; shift ;;
    --skip-typecheck) SKIP_TYPECHECK="true"; shift ;;
    --skip-opentui)   SKIP_OPENTUI="true"; shift ;;
    --opentui-full)   OPENTUI_FULL="true"; shift ;;
    --version)        VERSION="$2"; shift 2 ;;
    -h|--help)        usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

detect_platform

case "$TASK" in
  check)   task_check ;;
  build)   task_build ;;
  release) task_release ;;
  *)       usage ;;
esac
