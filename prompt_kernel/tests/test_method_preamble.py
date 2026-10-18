"""t90 — kernel method preamble: RED tests.

The premise (section 0) must name the working method in order and carry the
no-human-is-an-oracle line; the Claude G1 chain must ground search on
Universal Search hybrid, not WebSearch/WebFetch.
"""
from __future__ import annotations

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

METHOD_STEPS = (
    "search",
    "@SOURCE_ROUTING",
    "papers",
    "patents",
    "@SMOKE_BEFORE",
    "owner",
    "SVM",
    "fractal",
)


def _premise_block(text: str) -> str:
    start = text.index("premise:")
    end = text.index("\n\n", start)
    return text[start:end]


def _gate_block(text: str, gate_id: str) -> str:
    start = text.index(f"<{gate_id}_RULES>")
    return text[start : text.index(f"</{gate_id}_RULES>", start)]


def test_premise_names_method_steps_in_order() -> None:
    text = render_kernel(KERNEL, *VARIANTS["product"])
    block = _premise_block(text).lower()
    positions = [block.index(step.lower()) for step in METHOD_STEPS]
    assert positions == sorted(positions), (METHOD_STEPS, block)


def test_premise_carries_not_an_oracle_line() -> None:
    text = render_kernel(KERNEL, *VARIANTS["product"])
    block = _premise_block(text)
    assert "no human is an oracle" in block.lower()
    assert "@ORACLE_ROLE" in block or "evidence decides" in block.lower()


def test_claude_chain_uses_hybrid_not_websearch() -> None:
    text = render_kernel(KERNEL, *VARIANTS["claude"])
    g1 = _gate_block(text, "G1")
    assert ":3005/hybrid" in g1
    assert "WebSearch" not in g1


def test_premise_parity_across_variants() -> None:
    blocks = {
        name: _premise_block(render_kernel(KERNEL, *VARIANTS[name]))
        for name in VARIANTS
    }
    assert len(set(blocks.values())) == 1, blocks
