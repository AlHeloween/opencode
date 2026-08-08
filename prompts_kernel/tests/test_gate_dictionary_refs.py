"""
Gate rules/steps must be @REFS into RULES / algorithms / schemas — not bare words.

Bare ``- SV_EVERY_TURN`` is a bug; ``- @SV_EVERY_TURN`` resolves to RULES body.
"""

from __future__ import annotations

import os
import re
import sys

import pytest
import yaml

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, PROJECT_ROOT)

SCHEMAS_PATH = os.path.join(PROJECT_ROOT, "prompts_kernel", "core_schemas.yaml")
MDC_PATH = os.path.join(
    PROJECT_ROOT, "packages", "opencode", "src", "session", "prompt", "reasoning_prompt.mdc"
)
MAP_PATH = os.path.join(PROJECT_ROOT, "prompts_kernel", "reasoning", "00_map.txt")


def _load_gates() -> dict:
    with open(SCHEMAS_PATH, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    gates = data.get("gates") or {}
    assert gates, "core_schemas.yaml missing gates:"
    return gates


def _is_at_ref(item: object) -> bool:
    return isinstance(item, str) and bool(re.match(r"^@[A-Z][A-Z0-9_]*$", item))


def test_protocol_map_has_lookup_abi():
    with open(MAP_PATH, encoding="utf-8") as f:
        text = f.read()
    assert "Lookup" in text or "lookup" in text
    assert "@REFS only" in text or "rules:" in text and "@RULE" in text
    assert "RULES" in text


def test_gate_rules_and_steps_are_at_refs():
    gates = _load_gates()
    bare: list[str] = []
    for gkey, gate in gates.items():
        if not isinstance(gate, dict):
            continue
        for field in ("rules", "steps"):
            items = gate.get(field) or []
            if not isinstance(items, list):
                continue
            for item in items:
                if not _is_at_ref(item):
                    bare.append(f"{gkey}.{field}: {item!r}")
    assert not bare, (
        "Gate rules/steps must be @REFS (e.g. @SV_EVERY_TURN), not bare words:\n  "
        + "\n  ".join(bare)
    )


def test_gate_diagram_fields_are_at_refs():
    gates = _load_gates()
    bad = []
    for gkey, gate in gates.items():
        if not isinstance(gate, dict):
            continue
        diagram = gate.get("diagram")
        if diagram is None:
            continue
        if not _is_at_ref(diagram):
            bad.append(f"{gkey}.diagram: {diagram!r}")
        geometry = gate.get("geometry")
        if geometry is not None and isinstance(geometry, str) and not _is_at_ref(geometry):
            # geometry may be a nested map historically; only flag plain bare strings
            if not geometry.startswith("@"):
                bad.append(f"{gkey}.geometry: {geometry!r}")
    assert not bad, "diagram/geometry must be @REFS:\n  " + "\n  ".join(bad)


def test_g9_sv_every_turn_is_at_ref():
    gates = _load_gates()
    g9 = gates.get("G9") or {}
    rules = g9.get("rules") or []
    assert "@SV_EVERY_TURN" in rules, f"G9 must list @SV_EVERY_TURN, got {rules}"
    assert "SV_EVERY_TURN" not in rules, "bare SV_EVERY_TURN is not a dictionary ref"


def test_assembled_mdc_has_no_bare_gate_rule_lines():
    """Assembled mdc must not emit bare rule list items under gate rules: sections."""
    if not os.path.isfile(MDC_PATH):
        pytest.skip("reasoning_prompt.mdc not built")
    with open(MDC_PATH, encoding="utf-8") as f:
        mdc = f.read()

    # Under each # NAME (@Gn) ... rules: block, every list item must start with @
    bare = []
    for m in re.finditer(r"^# \w+ \(@(G\d+|CC)\)\n(.*?)(?=^# |\Z)", mdc, re.M | re.S):
        gtag, body = m.group(1), m.group(2)
        if "rules:" not in body:
            continue
        after = body.split("rules:", 1)[1]
        for line in after.splitlines():
            if re.match(r"^\s{2}[a-z_][a-z0-9_]*:", line):
                break
            rm = re.match(r"^\s+-\s+['\"]?(@?[A-Za-z0-9_]+)['\"]?\s*$", line)
            if not rm:
                continue
            item = rm.group(1)
            if not item.startswith("@"):
                bare.append(f"{gtag}: {item}")
    assert not bare, "Assembled mdc has bare gate rules (not @refs):\n  " + "\n  ".join(bare)


def test_assembled_mdc_has_lookup_and_g9_at_sv():
    if not os.path.isfile(MDC_PATH):
        pytest.skip("reasoning_prompt.mdc not built")
    with open(MDC_PATH, encoding="utf-8") as f:
        mdc = f.read()
    assert "@SV_EVERY_TURN" in mdc
    assert "Lookup" in mdc or "@REFS only" in mdc
    # classic bug shape
    assert not re.search(r"^\s+-\s+SV_EVERY_TURN\s*$", mdc, re.M)


# Non-RULE tags allowed on gates (schemas / algorithms / diagrams).
_NON_RULE_TAGS = frozenset({
    "ACTION_CLASS",
    "EXECUTION_ENVELOPE",
    "FRACTAL_GEOMETRY",
    "CLAIM_LEDGER",
    "BUG_FIX_CHAIN",
    "MASTER_PLAN_SCHEMA",
    "STAMPS",
    "BUG_FIX_SCHEMA",
    "EXPLORER_GOAL",
    "CLEAN_NEXT_STATE",
    "SV_OUTPUT_SCHEMA",
    "MSG_TAG",
    "BLOCKER",
    "SIGNAL_CLUSTER",
})


def test_gate_rule_refs_exist_in_runtime_rules():
    from prompts_kernel import RUNTIME_RULES

    all_rules = dict(RUNTIME_RULES)

    gates = _load_gates()
    missing = []
    for gkey, gate in gates.items():
        for item in gate.get("rules") or []:
            if not _is_at_ref(item):
                continue
            name = item[1:]
            if re.fullmatch(r"G\d+", name) or name == "CC":
                continue
            if name in _NON_RULE_TAGS:
                continue
            if name not in all_rules:
                missing.append(f"{gkey}: {item}")
    assert not missing, f"@RULE not in RUNTIME_RULES: {missing}"

