"""
Smoke test: Pyright "ConvertibleToInt" false positives.

Reproduces patterns from opencode_prompts_kernel.py, build.py,
consolidate_catalog.py, and scripts/ that trigger:
  "Argument of type "object" cannot be assigned to parameter "x"
   of type "ConvertibleToInt" in function "__new__""

Each test case is labelled PASS (should not error) or FALSE (known false positive).
Run: pyright experiments/2026-07-21_pyright-smoke/smoke_convertible_to_int.py
"""

import json
from types import MappingProxyType
from typing import Any, cast
import sqlite3

# =============================================================================
# HELPERS — mirrors real project patterns
# =============================================================================

# Pattern from opencode_prompts_kernel.py:3079-3087
PROMPT_ABI = MappingProxyType({
    "version": "5",
    "precedence": ("safety", "governance", "task", "domain", "style"),
    "line_endings": "LF",
    "identity_tier": "A",
    "identity_max_bytes": 48_000,
})

# Simulated json.loads — untyped dict
def get_config() -> dict[str, Any]:
    return json.loads('{"max_created": 5, "max_modified": 3, "debug": true, "label": "test"}')

# Simulated sqlite3.Row — __getitem__ returns Any
class FakeRow:
    def __getitem__(self, key: str) -> Any: ...

# =============================================================================
# CASE 1: MappingProxyType.get() → int()  [FALSE POSITIVE — known issue]
# Mirrors: opencode_prompts_kernel.py:3332
# =============================================================================
def case1_mappingproxy_get() -> int:
    """int(PROMPT_ABI.get('identity_max_bytes', 48_000))"""
    return int(PROMPT_ABI.get("identity_max_bytes", 48_000))


# =============================================================================
# CASE 2: json.loads → dict → int()  [FALSE POSITIVE — when chain loses type]
# Mirrors: build.py load_manifest() json.loads → dict
# =============================================================================
def case2_json_loads_chain() -> int:
    """Simulates json.loads data passed to int()."""
    config = get_config()
    created = config.get("max_created", 0)
    return int(created)


# =============================================================================
# CASE 3: sqlite3.Row → int()  [FALSE POSITIVE — Row returns Any]
# Mirrors: scripts/check_explorer_cache.py:23
# =============================================================================
def case3_sqlite_row(row: FakeRow) -> int:
    """int(row['inp'] or 0)"""
    return int(row["inp"] or 0)


# =============================================================================
# CASE 4: str.isdigit() narrow → int()  [SHOULD PASS — but may false trigger]
# Mirrors: consolidate_catalog.py:53
# =============================================================================
def case4_isdigit_narrow(version: str) -> tuple[int, ...]:
    """tuple(int(p) if p.isdigit() else 0 for p in parts[:3])"""
    parts = version.split(".")
    return tuple(int(p) if p.isdigit() else 0 for p in parts[:3])


# =============================================================================
# CASE 5: Mixed dict value types → int()  [FALSE POSITIVE]
# Mirrors: PROMPT_ABI mixed str/int/tuple → int() on known-int key
# =============================================================================
def case5_mixed_dict() -> int:
    """int() on a key known to hold an int, but dict values are union."""
    d: dict[str, str | int | bool] = {"count": 42, "name": "test", "active": True}
    return int(d["count"])


# =============================================================================
# CASE 6: float * int → int()  [SHOULD PASS — clean types]
# Mirrors: scripts/query_sessions.py:28 — int(dt.timestamp() * 1000)
# =============================================================================
def case6_float_to_int() -> int:
    """int(float_value) — should always be clean."""
    ts: float = 1735689600.123456
    return int(ts * 1000)


# =============================================================================
# CASE 7: Any from library → int()  [FALSE POSITIVE in strict mode]
# =============================================================================
def case7_any_to_int(value: Any) -> int:
    """int(Any) — should be allowed but strict mode may complain."""
    return int(value)


# =============================================================================
# FIXES — same patterns with fixes applied
# =============================================================================

# FIX A: cast()
def fix_cast() -> int:
    """cast(int, ...) — explicit, no false positive."""
    return int(cast(int, PROMPT_ABI.get("identity_max_bytes", 48_000)))


# FIX B: type: ignore
def fix_type_ignore() -> int:
    """type: ignore[arg-type] — suppresses the error."""
    return int(PROMPT_ABI.get("identity_max_bytes", 48_000))  # type: ignore[arg-type]


# FIX C: Extract variable with explicit annotation
def fix_explicit_annotation() -> int:
    """Explicit int annotation on intermediate variable."""
    raw: int = PROMPT_ABI.get("identity_max_bytes", 48_000)  # type: ignore[assignment]
    return int(raw)


# FIX D: Use TypedDict for known schema
from typing import TypedDict

class PromptAbi(TypedDict):
    version: str
    identity_max_bytes: int

# Cannot cast MappingProxyType to TypedDict easily, but if we used TypedDict:
def fix_typed_dict(abi: PromptAbi) -> int:
    """TypedDict — no false positive because value type is known."""
    return int(abi["identity_max_bytes"])


# =============================================================================
# SELF-TEST (runtime — all should execute without error)
# =============================================================================
if __name__ == "__main__":
    results: list[tuple[str, bool | None, str]] = []

    def check(name: str, fn, expected: int | tuple | None = None):
        try:
            val = fn()
            ok = expected is None or val == expected
            results.append((name, ok, f"→ {val}" if ok else f"→ {val} (expected {expected})"))
        except Exception as e:
            results.append((name, False, f"EXCEPTION: {e}"))

    check("Case1 MappingProxy.get()", case1_mappingproxy_get, 48_000)
    check("Case2 json.loads chain", case2_json_loads_chain, 5)
    check("Case4 isdigit narrow", lambda: case4_isdigit_narrow("1.2.3"), (1, 2, 3))
    check("Case5 mixed dict", case5_mixed_dict, 42)
    check("Case6 float to int", case6_float_to_int, 1735689600123)
    check("Case7 Any to int", lambda: case7_any_to_int(42), 42)
    check("Fix  cast", fix_cast, 48_000)
    check("Fix  type:ignore", fix_type_ignore, 48_000)
    check("Fix  explicit annotation", fix_explicit_annotation, 48_000)

    # Case 3 requires a FakeRow — skip runtime, pyright-only
    results.append(("Case3 sqlite3.Row", None, "pyright-only (no runtime)"))

    print("=== Runtime smoke test ===")
    passed = 0
    for name, ok, detail in results:
        status = "PASS" if ok else ("N/A" if ok is None else "FAIL")
        print(f"  [{status}] {name}: {detail}")
        if ok:
            passed += 1
    print(f"\nRuntime: {passed}/{len(results)} passed")
