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
    assert "legs: {documentation, code, execution}" in text
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
def test_frame_names_three_legs_per_variant(variant) -> None:
    g3 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G3")
    assert "names its three legs" in g3


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
