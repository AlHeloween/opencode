from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_SEMANTICS = tuple(sorted((
    "ACTION_CLASS",
    "CAPABILITY_GRAPH",
    "CLAIM_LEDGER",
    "CLOSURE_PROOF",
    "EVOLUTION_CANDIDATES",
    "EXECUTION_ENVELOPE",
    "EXECUTION_GOAL",
    "FRACTAL_GEOMETRY",
    "G1_GROUND",
    "G2_DECOMPOSE",
    "G3_MASTER_PLAN",
    "G4_AUTHORIZE",
    "G5_CONCERN_LOOP",
    "G6_GROUND_PLAN",
    "G7_IMPLEMENT",
    "G8_ORACLE",
    "G9_CLEAN_STATE",
    "INTENT_PROJECTION",
    "MANHATTAN_L1",
    "MASTER_PLAN",
    "MIGRATION_PROTOCOL",
    "OUTCOME_CONTRACT",
    "PLAN_BINDING",
    "PLAN_CONTRACT",
    "PROJECT_GEOMETRY",
    "PROVENANCE",
    "QUALITY_GUARDRAILS",
    "QUALITY_VECTOR",
    "RISK_LEDGER",
    "SMOKE_BEFORE",
    "SV_FORMAT",
    "DOMAIN_SOURCES",
    "PREV_MD5",
    "PARENT_GOAL_MD5",
)))
REQUIRED_NEXT_SEMANTICS = (
    "GETMODE",
    "SOURCE_ROUTING",
    "SOURCE_STAMP",
)


def _normalized(text: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", text.upper())


def compatibility_report(current: str, next_kernel: str) -> dict[str, tuple[str, ...]]:
    current_normalized = _normalized(current)
    next_normalized = _normalized(next_kernel)
    return {
        "missing_from_current": tuple(item for item in REQUIRED_SEMANTICS if item not in current_normalized),
        "missing_from_next": tuple(item for item in REQUIRED_SEMANTICS if item not in next_normalized),
        "missing_next_only": tuple(item for item in REQUIRED_NEXT_SEMANTICS if item not in next_normalized),
    }


def next_kernel_contract_gaps(kernel=None, rendered: str | None = None) -> tuple[str, ...]:
    from .render import render_kernel
    from .source import KERNEL, LEGACY_DOMAIN_DISCIPLINES

    if kernel is None:
        kernel = KERNEL
    text = rendered if rendered is not None else render_kernel(kernel)
    normalized = _normalized(text)
    gaps: list[str] = []
    for marker in (*REQUIRED_SEMANTICS, *REQUIRED_NEXT_SEMANTICS):
        if marker not in normalized:
            gaps.append(f"rendered kernel missing {marker}")
    disciplines = {route.discipline for route in kernel.source_routing.routes}
    for name in LEGACY_DOMAIN_DISCIPLINES:
        if name not in disciplines:
            gaps.append(f"missing legacy discipline {name}")
    for route in kernel.source_routing.routes:
        if not route.primary:
            gaps.append(f"{route.discipline} has no primary authority route")
    if "INFERRED" not in _normalized(kernel.source_routing.generic_web_rule):
        gaps.append("generic web rule does not mention Inferred")
    return tuple(gaps)


def assert_current_kernel_unchanged() -> list[str]:
    import hashlib

    manifest = json.loads((Path(__file__).resolve().parent / "baseline.json").read_text(encoding="utf-8"))
    errors = []
    for name, record in manifest.items():
        path = ROOT / record["path"]
        if not path.is_file():
            errors.append(f"{name}: missing {path}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest.lower() != record["sha256"].lower():
            errors.append(f"{name}: expected {record['sha256']}, got {digest}")
    return errors
