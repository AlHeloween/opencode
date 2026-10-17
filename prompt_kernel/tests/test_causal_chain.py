"""t79 causal-chain invariant — no gate closes on user testimony or visual capture alone.

Field case: D:/zPascal/ Projects/ClientSoft/docs/3d-render-verification.md
§2 (three legs: data-only / our-code-only / framework-only; own smokes count
once) and §3 (M1–M5 predictions registered BEFORE the render; the CUA
screenshot judges them).
"""
from __future__ import annotations

from prompt_kernel import KERNEL


def _rules():
    rules = list(KERNEL.shared_rules)
    for gate in KERNEL.gates:
        rules.extend(gate.local_rules)
    for protocol in KERNEL.protocols:
        rules.extend(protocol.local_rules)
    return rules


def _by_id(rule_id: str):
    for rule in _rules():
        if rule.id == rule_id:
            return rule
    raise AssertionError(f"missing rule {rule_id}")


def test_medoid_simplex_defines_independence_operationally() -> None:
    text = _by_id("MEDOID_SIMPLEX").text
    assert "neither leg can yield its result through the other's failure" in text
    assert "different input" in text
    assert "different instrument" in text
    assert "data | our code | framework-or-spec" in text
    assert "own scripts over own reading count as ONE source" in text


def test_g3_binds_mechanism_prediction_and_rejects_user_visual_only() -> None:
    g3 = next(gate for gate in KERNEL.gates if gate.id == "G3")
    assert "CAUSAL_CHAIN" in {rule.id for rule in g3.local_rules}
    text = _by_id("CAUSAL_CHAIN").text
    assert "ACCEPTANCE_FRAME" in text
    assert "path:line or formula" in text
    assert "beforehand prediction" in text
    assert "@SMOKE_BEFORE" in text
    assert "@ORACLE_ROLE" in text
    assert "@ORACLE" in text
    assert "@MEDOID_SIMPLEX" in text
    assert "user word or visual capture alone closes Unknown" in text
    assert "computed geometry decides" in text
    assert "the render only judges the prediction" in text


def test_no_gate_closes_on_user_or_visual_only_oracle() -> None:
    """Whole-graph invariant: user testimony or a visual capture alone never
    proves a claim — any rule naming that evidence must close Unknown."""
    causal = _by_id("CAUSAL_CHAIN")
    assert "Unknown" in causal.text
    offenders = []
    for rule in _rules():
        low = rule.text.lower()
        names_user_visual = ("user word" in low) or ("visual capture" in low)
        if not names_user_visual:
            continue
        if "unknown" not in low and "testimony" not in low:
            offenders.append(rule.id)
    assert offenders == [], offenders
    # The oracle itself still demands a drivable instrument, not a witness.
    oracle = _by_id("ORACLE").text
    assert "an instrument that cannot fail proves nothing" in oracle
