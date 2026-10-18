"""t90 addenda — instrument by layer; patents as a source route.

Addendum 1 (owner 2026-10-18: «мы привязали codegraph к греп как правило —
это глупо»): the fixed graph-before-scanners rule and the grep-last ordering
go; the instrument is chosen by the question's layer, and each tool's empty
result claims only that tool on that layer.

Addendum 2 (owner 2026-10-18, MFL/Snarskii case): patents join the source
routes, and EVERY domain term is grounded before planning or code —
unguessed, via a DOMAIN_TERMS slot.
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


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_no_variant_contains_graph_before_scanners(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "graph-before-scanners" not in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_no_variant_orders_grep_last(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "grep — LAST" not in text
    assert "-> glob -> grep" not in text
    assert "-> Glob -> Grep" not in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_each_variant_carries_layer_routing(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    g1 = _gate_block(text, "G1")
    assert "Choose the instrument by the question's layer" in g1
    assert "never absence on another layer" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_engineering_route_names_patents(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "Google_Patents" in text
    assert "Espacenet" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_patent_authority_rule_present(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "never proof that it works" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_g1_domain_grounding_slot_in_all_variants(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    g1 = _gate_block(text, "G1")
    assert "DOMAIN_TERMS" in g1
    assert "keeps G1 open" in g1
