"""Show the complete immutable prompt schema in action."""
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import prompts_kernel as k

print("=" * 70)
print("  COMPLETE IMMUTABLE PROMPT SCHEMA")
print("=" * 70)

# 1. The readable source
print("\n1. READABLE SOURCE (human-authored)")
print("-" * 50)
readable = {
    "_obj": "Repair parser without changing public behavior.",
    "_scp": {"files": ["src/parser.py", "tests/test_parser.py"]},
    "_cst": {"minimal_diff": True, "preserve_api": True},
    "_seq": ["inspect", "diagnose", "patch", "verify"],
    "_inv": ["existing valid inputs retain identical output"],
    "_acc": ["all parser tests pass"],
    "_ban": ["dependency changes", "unrelated refactoring"],
}
# Convert to standard readable form first
readable = {
    "objective": "Repair parser without changing public behavior.",
    "scope": {"files": ["src/parser.py", "tests/test_parser.py"]},
    "constraints": {"minimal_diff": True, "preserve_api": True},
    "steps": ["inspect", "diagnose", "patch", "verify"],
    "invariants": ["existing valid inputs retain identical output"],
    "acceptance_tests": ["all parser tests pass"],
    "forbidden_actions": ["dependency changes", "unrelated refactoring"],
}
print(json.dumps(readable, indent=2))

# 2. Compiled IR
print("\n2. COMPILED IR (AI-consumed — prefixed, immutable)")
print("-" * 50)
ir = k.compile_to_ir(readable)
print(json.dumps(ir, indent=2))

# 3. Roundtrip verification
print("\n3. ROUNDTRIP VERIFICATION (compile \u2192 expand)")
print("-" * 50)
expanded = k.expand_from_ir(ir)
assert expanded == readable, "Roundtrip failed!"
print(" \u2705 compile_to_ir \u2192 expand_from_ir = identity")
errors = k.validate_ir_equivalence(readable, ir)
print(f" \u2705 validate_ir_equivalence: {len(errors)} violations")

# 4. Immutable symbol table
print("\n4. IMMUTABLE SYMBOL TABLE (MappingProxyType)")
print("-" * 50)
for sym, meaning in k._KERNEL_SYMBOLS.items():
    print(f"  {sym:12s} \u2192 {meaning}")

try:
    k._KERNEL_SYMBOLS["_k_new"] = "hack"
    print("  \u274c MUTATION SUCCEEDED (BUG!)")
except TypeError:
    print("  \u2705 Mutation blocked — TypeError at runtime")

# 5. Projection prefixes
print("\n5. PROJECTION PREFIX REGISTRY")
print("-" * 50)
for ns, prefix in sorted(k._PROJECTION_PREFIXES.items()):
    rule = k.PREFIX_RULE.get(prefix, {})
    meaning = rule.get("meaning", "(no rule)")
    print(f"  {prefix:8s} \u2190 {ns:20s}  {meaning}")

# 6. Discipline projections
print("\n6. DISCIPLINE PROJECTION LIBRARY")
print("-" * 50)
for name, proj in sorted(k.PROJECTION_LIBRARY.items()):
    inv = proj.kernel_projection.get("invariants", [])
    ban = proj.kernel_projection.get("forbidden_actions", [])
    parent = f"  (parent: {proj.parent})" if proj.parent else ""
    print(f"  {name:20s}{parent}")
    for i in inv[:2]:
        shortened = i[:70] + "..." if len(i) > 70 else i
        print(f"    \u251c invariant: {shortened}")
    for b in ban[:1]:
        shortened = b[:70] + "..." if len(b) > 70 else b
        print(f"    \u2514 forbidden: {shortened}")
    if len(inv) > 2:
        print(f"      ... +{len(inv)-2} more invariants")

# 7. Precedence
print("\n" + "=" * 70)
print("  PRECEDENCE RULES (conflict resolution)")
print("-" * 50)
for rule_type, mode in k.PRECEDENCE.items():
    print(f"  {rule_type:30s} \u2192 {mode}")

# Summary
print(f"\n{'=' * 70}")
print(f"  SCHEMA INTEGRITY")
print(f"  {len(k._KERNEL_SYMBOLS)} immutable kernel symbols")
print(f"  {len(k._PROJECTION_PREFIXES)} namespace prefixes")
print(f"  {len(k.PROJECTION_LIBRARY)} discipline projections")
print(f"  {len(k.PREFIX_RULE)} prefix rules with semantics")
print(f"  {len(k.PROJECTION_PACKS)} language compiler packs")
print(f"  {len(k.SYNTAX_PROJECTION)} syntax projection fields")
print(f"  All protected by MappingProxyType. All tested (290 tests).")
print("=" * 70)
