#!/usr/bin/env bash
# _opentui.sh
# ───────────────────────────────────────────────────────────
# OpenTUI build: Zig native lib + TypeScript packages.
# Source into _build.sh or run standalone:
#   source ./_opentui.sh
#   build_opentui
#   build_opentui true   # full monorepo
# ───────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC} $*"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $*"; }

# ─── OpenTUI build ───────────────────────────────────────────────────
build_opentui() {
  local full="${1:-false}"
  local root="${2:-$ROOT}"
  local opentui_root="$root/packages/opentui"

  if [ ! -d "$opentui_root" ]; then
    echo "OpenTUI root not found: $opentui_root" >&2
    exit 1
  fi

  if [ "$full" = "true" ]; then
    echo -e "  ${YELLOW}Building OpenTUI (full monorepo)...${NC}"
    (cd "$opentui_root" && bun run build) || { fail "OpenTUI full build failed"; exit 1; }
    ok "OpenTUI full monorepo build complete"
    return
  fi

  local core_dir="$opentui_root/packages/core"
  local solid_dir="$opentui_root/packages/solid"
  local three_dir="$opentui_root/packages/three"

  echo -e "  ${YELLOW}Building OpenTUI core (Zig native + TypeScript lib)...${NC}"
  (cd "$core_dir" && bun run build) || { fail "OpenTUI core build failed"; exit 1; }
  ok "OpenTUI core rebuilt ($NATIVE_PREFIX${NATIVE_PREFIX}opentui.${NATIVE_EXT} + dist/)"

  echo -e "  ${YELLOW}Building OpenTUI solid...${NC}"
  (cd "$solid_dir" && bun run build) || { fail "OpenTUI solid build failed"; exit 1; }
  ok "OpenTUI solid rebuilt"

  echo -e "  ${YELLOW}Building OpenTUI three...${NC}"
  (cd "$three_dir" && bun run build) || { fail "OpenTUI three build failed"; exit 1; }
  ok "OpenTUI three rebuilt"

  local native_lib="$opentui_root/packages/${OPENTUI_PLATFORM}/${NATIVE_PREFIX}opentui.${NATIVE_EXT}"
  if [ ! -f "$native_lib" ]; then
    fail "opentui native lib missing after core build: $native_lib"
    exit 1
  fi
  ok "OpenTUI native lib present ($native_lib)"
}
