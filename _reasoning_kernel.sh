#!/usr/bin/env bash
# _reasoning_kernel.sh
# ───────────────────────────────────────────────────────────
# Reasoning kernel assembly, stability guardrails, and self-test.
# Source into _build.sh or run standalone:
#   source ./_reasoning_kernel.sh
#   sync_kernel_prompt
#   test_reasoning_framework
# ───────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC} $*"; }
fail() { echo -e "  ${RED}[FAIL]${NC} $*"; }

# ─── Kernel prompt sync ──────────────────────────────────────────────
sync_kernel_prompt() {
  local root="${1:-$ROOT}"
  local kernel_dst="$root/packages/opencode/src/session/prompt/reasoning_prompt.mdc"

  # Precompile then assemble unified reasoning_prompt.mdc (matches _reasoning_kernel.ps1)
  ( cd "$root" && python3 -c "from prompts_kernel import write_precompiled_kernel; write_precompiled_kernel()" ) || {
    fail "Kernel precompilation failed"
    return 1
  }
  ( cd "$root" && python3 -c "from prompts_kernel import write_reasoning; write_reasoning()" ) || {
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
  local root="${1:-$ROOT}"
  echo -e "  ${YELLOW}Testing reasoning framework...${NC}"

  # 1. Kernel import
  local import_test
  import_test=$(python3 -c "
import sys; sys.path.insert(0, '$root')
import prompts_kernel as k
print(f'OK: {len(k._KERNEL_SYMBOLS)} symbols, {len(k.PROJECTION_LIBRARY)} projections')
" 2>&1) || { fail "Kernel import failed"; echo "  $import_test" >&2; return 1; }
  ok "Kernel imports ($import_test)"

  # 2. IR roundtrip
  local ir_test
  ir_test=$(python3 -c "
import sys; sys.path.insert(0, '$root')
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
import sys; sys.path.insert(0, '$root')
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
  test_output=$(python3 -m pytest "$root/prompts_kernel/tests" -q --tb=no 2>&1) || {
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
import sys; sys.path.insert(0, '$root')
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
