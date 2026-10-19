"""t96 — acceptance rests on three oracles: documentation, code, execution.

Owner, 2026-10-19: detailed project documentation is the third required
acceptance oracle beside code (mechanism) and execution (reality); each
aspect needs ≥3 independent oracles of its own, else a degenerate simplex.
Measured cases: the pipeviewer segment (code+run agreed, meaning disagreed)
and the edit.txt/edit.ts contradiction (doc+run agreed, code disagreed).
"""
from __future__ import annotations

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS

VARIANTS = {
    "product": (GATE_ADDONS, None),
    "claude": (CLAUDE_GATE_ADDONS, ()),
    "codex": (CODEX_GATE_ADDONS, ()),
    "cursor": (CURSOR_GATE_ADDONS, ()),
}

REQUIRED_CLAUSES = (
    "documentation (meaning), code (mechanism) and execution (reality) agree",
    "≥3 independent oracles under @MEDOID_SIMPLEX",
    "UNIQUE-DETECTION",
    "D1 requirements traceability",
    "E5 differential / back-to-back",
)


def triad_ok(text: str) -> bool:
    """The whole-graph invariant: every clause present, none assumed."""
    return all(clause in text for clause in REQUIRED_CLAUSES)


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_triad_slot_in_all_variants(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "aspects: {documentation, code, execution}" in text
    assert "unique_detection" in text
    assert triad_ok(text)


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_per_aspect_three_refers_to_simplex(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "≥3 independent oracles under @MEDOID_SIMPLEX" in text
    assert "degenerate simplex" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_catalogue_families_present(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    for family in (
        "D1 requirements traceability",
        "D2 executed procedure",
        "D3 executable examples",
        "D4 frameless reader teach-back",
        "D5 doc ↔ contract diff",
        "C1 static analysis",
        "C2 structural graph",
        "C3 mutation testing",
        "C4 invariants",
        "C5 independent diff review",
        "E1 persisted-state read-back",
        "E2 observed output",
        "E3 end-to-end on real data",
        "E4 outside measurement",
        "E5 differential / back-to-back",
    ):
        assert family in text, family
    for number in ("29148", "26514", "1063"):
        assert number in text, number


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_frame_names_three_aspects_per_variant(variant) -> None:
    g3 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G3")
    assert "names its three aspects" in g3


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_g2_leaf_needs_three_aspects(variant) -> None:
    g2 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G2")
    assert "observable on all three aspects" in g2
    assert "not yet a leaf" in g2
    assert "@TOOLCHAIN_QUALIFICATION" in g2


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_guard_rejects_missing_documentation_leg(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert triad_ok(text)
    mutant = text.replace(
        "documentation (meaning), code (mechanism) and execution (reality) agree", ""
    )
    assert mutant != text
    assert not triad_ok(mutant)


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_guard_rejects_relaxed_per_aspect_count(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert triad_ok(text)
    mutant = text.replace("≥3 independent oracles under @MEDOID_SIMPLEX", "")
    assert mutant != text
    assert not triad_ok(mutant)


# --- t96 review 1 (Legislator + frameless falsifier) ---


def _wiring_ok(gates) -> bool:
    by_id = {gate.id: gate for gate in gates}
    return all("THREE_ORACLES" in by_id[gid].shared_rules for gid in ("G3", "G8", "G9"))


def test_gate_wiring_names_three_oracles() -> None:
    """R1F1: acceptance and closure gates carry the rule."""
    assert _wiring_ok(KERNEL.gates)


def test_guard_rejects_unwired_gate() -> None:
    """R1F1 mutation control: drop the wiring, the guard fails."""
    from dataclasses import replace

    gates = [
        replace(gate, shared_rules=tuple(r for r in gate.shared_rules if r != "THREE_ORACLES"))
        if gate.id == "G8"
        else gate
        for gate in KERNEL.gates
    ]
    assert _wiring_ok(KERNEL.gates)
    assert not _wiring_ok(gates)


def test_guard_rejects_optional_unique_detection() -> None:
    """R1F3 mutation control: optional receipt never counts."""
    text = render_kernel(KERNEL)
    assert "unique_detection:" in text
    assert "unique_detection?" not in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_aspect_leg_terms_distinct(variant) -> None:
    """R1F2: ASPECT for the three, LEG for one oracle."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "aspects: {documentation, code, execution}" in text
    assert "two of the three aspects" in text
    assert "two of the three legs" not in text
    assert "names its three aspects" in _gate_block(text, "G3")
    assert "names its three legs" not in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_independence_within_aspect(variant) -> None:
    """R1F4: family AND receipt inside, categories over the whole."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "different catalogue family AND a receipt" in text
    assert "still governs the claim as a whole" in text
    assert "for E1/E2" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_all_other_legs_miss(variant) -> None:
    """R1F5: ALL others miss; other aspects do not matter."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "ALL the other legs of that aspect miss" in text
    assert "do not matter for this receipt" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_agreement_and_divergence(variant) -> None:
    """R1F6: agree, diverge, triage action, return to G1."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "every leg of it passes" in text
    assert "itself a divergence" in text
    assert "re-run every leg" in text
    assert "return to G1" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_documentation_executed_per_family(variant) -> None:
    """R1F7: each doc family names its execution."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    for executed in ("resolved to", "walked with", "executed or parsed", "compared against", "diffed against"):
        assert executed in text, executed
    assert "only read is not a leg" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_unknown_scope(variant) -> None:
    """R1F8: Unknown bars SUCCESS, task stays open."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "cannot reach SUCCESS" in text
    assert "keeps the task open" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_leaf_vs_acceptance_level(variant) -> None:
    """R1F9: one drivable leg stops a leaf, three accept."""
    g2 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G2")
    assert "ONE drivable leg per aspect" in g2
    assert "missing aspect is residual" in g2
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "ACCEPTED (G8/G9)" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_recursion_stops(variant) -> None:
    """R1F10: qualify once, no per-use re-qualification."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "qualified once" in text
    assert "not re-qualified per use" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_no_receipt_no_leg(variant) -> None:
    """R1F11: unconstructible defect means residual, never provisional."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "never counts provisionally" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_catalogue_open(variant) -> None:
    """R1F12: new families declared, same-family tools still one."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "new family may be declared" in text
