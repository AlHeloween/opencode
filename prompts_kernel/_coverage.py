"""
kernel coverage: gate ↔ rule mapping audit.
Run: python prompts_kernel/_coverage.py
Checks:
  1. Every rule in RUNTIME_RULES → assigned to exactly one gate
  2. Every gate in core_schemas.yaml → has non-empty rules list
  3. No duplicate rules across gates
  4. Coverage % = rules_assigned / total_rules
"""
from __future__ import annotations

import sys
from pathlib import Path

_KERNEL = Path(__file__).resolve().parent
sys.path.insert(0, str(_KERNEL.parent))

from prompts_kernel._kernel_precompiled import (
    RUNTIME_RULES,
    RUNTIME_RULE_OWNERS,
    RUNTIME_WORKFLOWS,
    _load_core_schemas,
)

# ── gate → rule mapping (from 27_runtime_dict.py gate comments) ──
# Manual mapping mirrors the comment structure in RUNTIME_RULES dict.
GATE_RULES: dict[str, list[str]] = {
    "G1": ["EVIDENCE_ORDER", "SEARCH_ORDER", "WHERE_WHICH", "REUSE_BEFORE",
           "GROUND", "NO_HARDCODE", "VCS_ROOT"],
    "G2": ["DECOMPOSE", "FRACTAL_CANDIDATES", "GOAL_SEEDS", "GOAL_PEAKS",
           "SV_DELTA", "METRIC_ADAPTATION"],
    "G3": ["SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE", "INFOMARK_SEP",
           "PLAN_LIFECYCLE", "PLAN_REVISION"],
    "G4": ["WRITE_SCOPE"],
    "G7": ["CACHE_STABILITY", "CONSTITUTION_BLOCKS", "ADID_OPS",
           "PLAN_CONTRACT", "PLAN_BINDING"],
    "G8": ["VERIFY_OUTCOME", "SMOKE_VERIFY"],
    "G9": ["CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN", "RESIDUAL_LOOP",
           "EMIT_STATE", "PLANS_COMPLETED"],
    "_cross": ["NAMING", "DOCUMENT_SURFACE", "WORKSPACE_LANES", "PROGRESS_LOG",
               "MEMORY_RANK", "MEMORY_LINKS", "ADID_FREEZE"],
}

ALL_RULE_KEYS = set(RUNTIME_RULES.keys())
ASSIGNED = set()
for gate, rules in GATE_RULES.items():
    ASSIGNED.update(rules)

ORPHANS = ALL_RULE_KEYS - ASSIGNED
DUPLICATES: dict[str, list[str]] = {}
for rule in ASSIGNED:
    gates = [g for g, rs in GATE_RULES.items() if rule in rs]
    if len(gates) > 1:
        DUPLICATES.setdefault(rule, gates)

# ── gate rules from core_schemas.yaml ──
SCHEMAS = _load_core_schemas()
GATES_SCHEMA = SCHEMAS.get("gates", {})

# ── report ──
def main() -> int:
    print("=" * 60)
    print("KERNEL COVERAGE: gate ↔ rule mapping")
    print("=" * 60)

    total = len(ALL_RULE_KEYS)
    assigned_n = len(ASSIGNED)
    cross_n = len(GATE_RULES.get("_cross", []))
    pct = assigned_n / total * 100 if total else 0

    print(f"\n  Total rules:     {total}")
    print(f"  Assigned:        {assigned_n} ({pct:.0f}%)")
    print(f"  Cross-cutting:   {cross_n}")
    print(f"  Orphans:         {len(ORPHANS)}")

    if ORPHANS:
        print("\n  ⚠ ORPHAN RULES (not assigned to any gate):")
        for r in sorted(ORPHANS):
            owner = RUNTIME_RULE_OWNERS.get(r, "?")
            print(f"    {r:<30} owner={owner}")

    if DUPLICATES:
        print("\n  ⚠ DUPLICATE RULES (assigned to multiple gates):")
        for rule, gates in sorted(DUPLICATES.items()):
            print(f"    {rule:<30} gates={gates}")

    # ── gate coverage ──
    print("\n  ── Gate breakdown ──")
    for gate, rules in GATE_RULES.items():
        prefix = "  " if gate.startswith("_") else ""
        label = gate if not gate.startswith("_") else "cross-cutting"
        print(f"    {prefix}{label:<18} {len(rules):>2} rules -> {rules}")

    # ── gate rule lists in core_schemas.yaml sync check ──
    print("\n  ── core_schemas.yaml sync ──")
    for gid in sorted(GATES_SCHEMA.keys(), key=lambda x: (x[0] != "G", x)):
        gate = GATES_SCHEMA[gid]
        schema_rules = gate.get("rules", [])
        schema_name = gate.get("name", "?")
        if gid in GATE_RULES:
            mapped = set(GATE_RULES[gid])
            listed = set(schema_rules) if schema_rules else set()
            missing_from_schema = mapped - listed
            extra_in_schema = listed - mapped
            if missing_from_schema:
                print(f"    {gid} ({schema_name}): missing from schema rules[]: {sorted(missing_from_schema)}")
            if extra_in_schema:
                print(f"    {gid} ({schema_name}): extra in schema rules[] (not in kernel): {sorted(extra_in_schema)}")
        else:
            if gid not in ("G5", "G6"):
                print(f"    {gid} ({schema_name}): NOT in GATE_RULES coverage map")

    # ── exit code ──
    errors = len(ORPHANS) + len(DUPLICATES)
    if errors:
        print(f"\n  ❌ {errors} issue(s) found.")
        return 1
    print(f"\n  ✅ All {total} rules assigned, no duplicates.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
