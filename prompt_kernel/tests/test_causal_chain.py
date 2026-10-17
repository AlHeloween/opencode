"""t79 causal-chain invariant — no gate closes on user testimony or visual capture alone.

Field case: D:/zPascal/ Projects/ClientSoft/docs/3d-render-verification.md
§2 (three legs: data-only / our-code-only / framework-only; own smokes count
once) and §3 (M1–M5 predictions registered BEFORE the render; the CUA
screenshot judges them). Review round 3 (Claude + aicall): prediction-not-
verdict language, common-failure phrasing, empty-slot Unknown.
"""
from __future__ import annotations

from prompt_kernel import KERNEL
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS


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
    assert "no single failure can produce both results" in text
    assert "neither source can yield" not in text
    assert "inputs from different categories" in text
    assert "data | our code | framework-or-spec" in text
    assert "different instruments" in text
    assert "at least one source computing from the mechanism" in text
    assert "code or formula" in text
    assert "observations of one kind" in text
    assert "renders, screenshots" in text
    assert "are one category" in text
    assert "A leg is one independent source" in text
    assert "The agent's own scripts built on its own reading of the code count as ONE source" in text


def test_acceptance_frame_tuple_carries_mechanism_and_prediction() -> None:
    for addons in (GATE_ADDONS, CLAUDE_GATE_ADDONS, CODEX_GATE_ADDONS, CURSOR_GATE_ADDONS):
        line = next(
            addon.lines[0]
            for addon in addons
            if addon.gate_id == "G3" and addon.addon_id == "ACCEPTANCE_FRAME"
        )
        assert "{(criterionᵢ, surfaceᵢ, mechanismᵢ, predictionᵢ, instrumentᵢ@rung, falsifierᵢ)}" in line
        assert "mechanismᵢ is path:line or formula" in line
        assert "predictionᵢ is written before the observation" in line
        assert "an empty mechanismᵢ or predictionᵢ leaves the criterion Unknown" in line
    lines = [
        next(
            addon.lines[0]
            for addon in addons
            if addon.gate_id == "G3" and addon.addon_id == "ACCEPTANCE_FRAME"
        )
        for addons in (GATE_ADDONS, CLAUDE_GATE_ADDONS, CODEX_GATE_ADDONS, CURSOR_GATE_ADDONS)
    ]
    assert len(set(lines)) == 1


def test_g3_binds_mechanism_prediction_and_rejects_user_visual_only() -> None:
    g3 = next(gate for gate in KERNEL.gates if gate.id == "G3")
    assert "CAUSAL_CHAIN" in {rule.id for rule in g3.local_rules}
    text = _by_id("CAUSAL_CHAIN").text
    assert "ACCEPTANCE_FRAME" in text
    assert "predictionᵢ" in text
    assert "beforehand prediction" in text
    assert "@SMOKE_BEFORE" in text
    assert "@ORACLE_ROLE" in text
    assert "@ORACLE" in text
    assert "@MEDOID_SIMPLEX" in text
    assert "leaves the claim Unknown" in text
    assert "closes Unknown" not in text
    assert "computed geometry is the prediction" in text
    assert "computed geometry decides" not in text
    assert "the render is the observation that tests it" in text


def test_no_gate_closes_on_user_or_visual_only_oracle() -> None:
    """Whole-graph invariant: user testimony or a visual capture alone never
    proves a claim — any rule naming that evidence must leave it Unknown."""
    causal = _by_id("CAUSAL_CHAIN")
    assert "leaves the claim Unknown" in causal.text
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
