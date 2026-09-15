"""
Fix verification: same patterns with fixes applied.
Each function below mirrors a false-positive case but with a fix.
Run: pyright experiments/2026-07-21_pyright-smoke/smoke_fixes.py
Expected: 0 errors (all fixes should silence the false positive)
"""

from types import MappingProxyType
from typing import Any, cast, TypedDict
import json

# Same setup as smoke_convertible_to_int.py
PROMPT_ABI = MappingProxyType({
    "version": "5",
    "precedence": ("safety", "governance", "task", "domain", "style"),
    "line_endings": "LF",
    "identity_tier": "A",
    "identity_max_bytes": 48_000,
})

# =============================================================================
# FIX A: cast() — explicit type assertion
# Verdict: 0 errors. cast() tells pyright "trust me, this is int"
# =============================================================================
def fix_cast() -> int:
    return int(cast(int, PROMPT_ABI.get("identity_max_bytes", 48_000)))


# =============================================================================
# FIX B: type: ignore[arg-type] — local suppression
# Verdict: 0 errors. Suppresses only the argument-type check.
# =============================================================================
def fix_type_ignore() -> int:
    return int(PROMPT_ABI.get("identity_max_bytes", 48_000))  # type: ignore[arg-type]


# =============================================================================
# FIX C: Explicit intermediate variable with type annotation
# Verdict: 0 errors if we also suppress the assignment, OR use cast.
# =============================================================================
def fix_explicit_variable() -> int:
    raw: int = cast(int, PROMPT_ABI.get("identity_max_bytes", 48_000))
    return int(raw)


# =============================================================================
# FIX D: Bypass int() entirely — the value is already int
# Verdict: 0 errors. No conversion needed for known-int keys.
# =============================================================================
def fix_no_conversion() -> int:
    val = PROMPT_ABI.get("identity_max_bytes", 48_000)
    return cast(int, val)  # just assert, no int() call


# =============================================================================
# FIX E: TypedDict for known schema (ideal solution)
# Verdict: 0 errors. Pyright knows the exact type per key.
# =============================================================================
class AbiSchema(TypedDict):
    version: str
    precedence: tuple[str, str, str, str, str]
    line_endings: str
    identity_tier: str
    identity_max_bytes: int

def fix_typed_dict(abi: AbiSchema) -> int:
    return int(abi["identity_max_bytes"])


# =============================================================================
# FIX F: Use .get() with type-narrowed default
# Verdict: Should pass — default is int, which helps narrow.
# =============================================================================
def fix_default_narrow() -> int:
    # type of .get(key, 48_000) should be int | (union of values)
    # but with explicit int annotation on default, pyright may narrow
    default: int = 48_000
    return int(PROMPT_ABI.get("identity_max_bytes", default))


# =============================================================================
# FIX G: str() then int() — two-step conversion
# Verdict: 0 errors. str() accepts Any/tuple, int() accepts str.
# =============================================================================
def fix_str_then_int() -> int:
    return int(str(PROMPT_ABI.get("identity_max_bytes", 48_000)))


# =============================================================================
# ANTI-PATTERN: What does NOT work
# =============================================================================

# BAD: isinstance check — pyright still can't narrow dict value type by key
def bad_isinstance_check() -> int:
    val = PROMPT_ABI.get("identity_max_bytes", 48_000)
    if isinstance(val, int):
        return int(val)  # SHOULD pass, but pyright may still complain about the union
    return 0


# BAD: assert — pyright respects assert for type narrowing? Let's see.
def bad_assert() -> int:
    val = PROMPT_ABI.get("identity_max_bytes", 48_000)
    assert isinstance(val, int)
    return int(val)  # pyright SHOULD narrow after assert isinstance


# =============================================================================
# SELF-TEST
# =============================================================================
if __name__ == "__main__":
    tests = [
        ("cast", fix_cast, 48_000),
        ("type:ignore", fix_type_ignore, 48_000),
        ("explicit var", fix_explicit_variable, 48_000),
        ("no conversion", fix_no_conversion, 48_000),
        ("str then int", fix_str_then_int, 48_000),
        ("default narrow", fix_default_narrow, 48_000),
        ("isinstance", bad_isinstance_check, 48_000),
        ("assert", bad_assert, 48_000),
    ]
    
    all_pass = True
    for name, fn, expected in tests:
        try:
            result = fn()
            ok = result == expected
            status = "PASS" if ok else f"FAIL (got {result})"
            if not ok:
                all_pass = False
        except Exception as e:
            status = f"FAIL ({e})"
            all_pass = False
        print(f"  [{status}] {name}")
    
    print(f"\nRuntime: {'ALL PASS' if all_pass else 'SOME FAILED'}")
