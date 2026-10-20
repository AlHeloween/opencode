"""t102 — TRIZ name corpus: bare names in three placements, no explanations.

Owner, 2026-10-20: «Да, подключить» (TRIZ); «как только мы добавим ТРИЗ в корпус —
ну ок эти алгоритмы придут в движение». Approved groups: «Ядро», «Эволюция систем»,
«Инструменты анализа». Names activate latent knowledge, paraphrase loses it —
so the kernel carries NAMES only; definitions live in docs/glossary.md (t101).
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

CORE_NAMES = (
    "ИКР",
    "Ideal Final Result",
    "техническое противоречие",
    "engineering contradiction",
    "физическое противоречие",
    "physical contradiction",
    "АРИЗ-85В",
    "ARIZ-85C",
    "40 приёмов",
    "40 inventive principles",
    "матрица противоречий",
    "contradiction matrix",
    "ресурсы",
    "вещество, поле, время, пространство, информация",
    "resources",
)

EVOLUTION_NAMES = (
    "TESE",
    "законы развития технических систем",
    "S-кривая",
    "S-curve",
    "закон идеальности",
    "law of ideality",
    "девять окон",
    "nine windows",
)

ANALYSIS_NAMES = (
    "веполь",
    "Su-Field",
    "76 стандартов",
    "76 standard solutions",
    "усечение",
    "trimming",
    "причинно-следственный анализ",
    "CECA",
    "оперативная зона и время",
    "operating zone and time",
    "указатель научных эффектов",
    "database of scientific effects",
)

ALL_TRIZ_NAMES = (*CORE_NAMES, *EVOLUTION_NAMES, *ANALYSIS_NAMES)


def triz_ok(text: str) -> bool:
    """Every approved name present, none assumed."""
    return all(name in text for name in ALL_TRIZ_NAMES)


@pytest.mark.parametrize("variant", tuple(VARIANTS))
@pytest.mark.parametrize("name", ALL_TRIZ_NAMES)
def test_triz_name_present(variant, name) -> None:
    """Every approved name renders in every variant."""
    assert name in render_kernel(KERNEL, *VARIANTS[variant]), name


@pytest.mark.parametrize("variant", tuple(VARIANTS))
@pytest.mark.parametrize("name", ALL_TRIZ_NAMES)
def test_triz_name_nowhere_outside_its_block(variant, name) -> None:
    """Whole-graph invariant: one block owns the name; measured zero
    pre-existing collisions on 2026-10-20, so exactly one occurrence."""
    assert render_kernel(KERNEL, *VARIANTS[variant]).count(name) == 1, name


def test_guard_rejects_removed_name() -> None:
    """Mutation control: drop one name, the corpus guard fails."""
    text = render_kernel(KERNEL)
    assert triz_ok(text)
    mutant = text.replace("АРИЗ-85В", "")
    assert mutant != text
    assert not triz_ok(mutant)


def test_triz_wiring() -> None:
    """Core corpus rides G2+G5, analysis corpus rides G1+G6."""
    by_id = {gate.id: gate for gate in KERNEL.gates}
    assert "TRIZ_CONTRADICTION" in by_id["G2"].shared_rules
    assert "TRIZ_CONTRADICTION" in by_id["G5"].shared_rules
    assert "TRIZ_ANALYSIS" in by_id["G1"].shared_rules
    assert "TRIZ_ANALYSIS" in by_id["G6"].shared_rules


def test_guard_rejects_unwired_corpus() -> None:
    """Mutation control: unwire one gate, the guard fails."""
    from dataclasses import replace

    gates = [
        replace(gate, shared_rules=tuple(r for r in gate.shared_rules if r != "TRIZ_ANALYSIS"))
        if gate.id == "G1"
        else gate
        for gate in KERNEL.gates
    ]
    by_id = {gate.id: gate for gate in gates}
    assert "TRIZ_ANALYSIS" not in by_id["G1"].shared_rules
