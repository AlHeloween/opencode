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
    assert "For a missing or Unknown source_ref, apply @DOMAIN_TERMS" in g1  # owner-approved cut #11, 2026-10-20 (was: "keeps G1 open")


# --- t90 review 1 (Legislator FAIL findings) ---


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_no_scanner_last_rule_in_g1(variant) -> None:
    """F1: routing is the only instrument rule."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "scanner is last" not in g1
    assert "never first" not in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_no_dangling_chain_refs_in_g1(variant) -> None:
    """F2: the chain is gone; the instrument and layer are named."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "naming its rungs" not in g1
    assert "escalate the whole chain" not in g1
    assert "Name the rung that answered" not in g1
    assert "name the instrument and layer that answered" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_concept_layer_routes_to_retrieval(variant) -> None:
    """F3: concept / unclear target reaches retrieval first."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "unclear target" in g1


def test_concept_layer_tools_per_host() -> None:
    """F3: each host names its own retrieval tool."""
    blocks = {name: _gate_block(render_kernel(KERNEL, *VARIANTS[name]), "G1") for name in VARIANTS}
    assert "adm --query" in blocks["product"]
    assert "adm --query" in blocks["claude"]
    assert "qualified adm query" in blocks["codex"]
    assert "retrieval MCP" in blocks["cursor"]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_task_path_defined(variant) -> None:
    """F4a: task path needs no familiarity judgement."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "change region touches" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_reuse_reads_glossary(variant) -> None:
    """F4b: a current glossary entry is read, not re-searched."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "already in the project glossary" in g1
    assert "@ANTI_CHURN" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_unknown_exit(variant) -> None:
    """F4c: sourceless terms close as residual, never silent."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "Unknown source_ref" in g1  # owner-approved cut #11, 2026-10-20 (was: "source_ref: Unknown")
    assert "no plan step rests on that term" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_search_order_and_authority(variant) -> None:
    """F4d: search order is not authority."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "org wiki" in g1
    assert "higher @INFORMATION_STATUS rung per @SOURCE_ROUTING wins" in g1  # 2026-10-18 review 2 fix 5 supersedes the bare phrase


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_readonly_identities_report(variant) -> None:
    """F4e: read-only identities report; the parent records."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "EXPLORER_AGENT" in g1
    assert "parent records the glossary" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_slot_carries_content_hash(variant) -> None:
    """F4f: the slot names the hash and its source per surface."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "{term, definition, source_ref, content_hash}" in text
    g1 = _gate_block(text, "G1")
    assert "sha256 of the read file" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_domain_reword_no_inferred_collision(variant) -> None:
    """F4g: reinvented from recall, not against the rung."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "reinvented from recall" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_patent_lines_instruct_without_render_claim(variant) -> None:
    """F5: instruction, not an unreceipted render fact."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "client-rendered" not in g1
    assert "discover the patent id" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_engineering_route_names_standards_bodies(variant) -> None:
    """F6: standards publishers ride the engineering route."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "ASTM" in text


# --- t90 review 2 (five small fixes) ---


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_slot_and_rule_agree_on_unknown_exit(variant) -> None:
    """R2F1: the slot closes on Unknown exactly like the rule."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert "source_ref: Unknown with its search receipt closes it as residual" in text
    assert "in place of content_hash" in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_registries_outrank_aggregators_in_engineering_route(variant) -> None:
    """R2F2: official registries primary, aggregators secondary."""
    text = render_kernel(KERNEL, *VARIANTS[variant])
    line = next(l for l in text.splitlines() if l.startswith("- engineering:") and "|" in l)
    primary, secondary = line.split("|")
    for name in ("Espacenet", "USPTO", "WIPO_Patentscope", "ISO", "IEC"):
        assert name in primary, name
    for name in ("Google_Patents", "ASTM"):
        assert name in secondary, name


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_every_variant_binds_one_glossary_path(variant) -> None:
    """R2F3: one bound path every agent reuses."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "docs/glossary.md" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_concept_question_spans_layers(variant) -> None:
    """R2F4: a concept question crosses layers by definition."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "spans layers by definition" in g1


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_conflict_names_the_winning_rung(variant) -> None:
    """R2F5: the higher rung is named, not implied."""
    g1 = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert "higher @INFORMATION_STATUS rung per @SOURCE_ROUTING" in g1
