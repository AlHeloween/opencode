"""t84 — SV legend: the @SV_FORMAT example block carries its own legend.

Owner, 2026-10-17, verbatim: «Ну можно просто легендой note: hash values are generative».
Bare-SV probe (experiments/2026-10-17_sv-bare-intent/): a frameless reader
reconstructs the intent but takes md5 for a content hash, so the block itself
says its hash values are generative. A trailing legend line keeps every
line-anchored reader green (matrix S1); an inline marker does not.
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

LEGEND = "note: hash values are generative"


def _sv_example_block(text: str) -> str:
    start = text.index("```yaml\nKeywords: topic1 0.35")
    end = text.index("```", start + 6)
    return text[start:end]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_example_ends_with_legend(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    block = _sv_example_block(text)
    lines = [line for line in block.splitlines() if line.strip()]
    assert lines[-1] == LEGEND, lines[-1]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_legend_bullet_explains_in_one_line(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    hits = [line for line in text.splitlines() if LEGEND in line and line.strip().startswith("-")]
    assert len(hits) == 1, hits
    assert "generative" in hits[0]


def test_sv_legend_guard_rejects_dropped_line() -> None:
    text = render_kernel(KERNEL)
    assert LEGEND in text
    mutant = text.replace(LEGEND, "")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert LEGEND in mutant


def test_trivial_carries_no_legend() -> None:
    """The trivial emission carries no hashes, so it carries no legend.

    Consistent rule: the legend rides a YAML block iff md5 fields ride it.
    The trivial form is one inline line with no md5/prev-md5/parent-goal-md5,
    so no `note:` line belongs to it.
    """
    assert "note:" not in KERNEL.sv_contract.trivial_emission
    text = render_kernel(KERNEL)
    trivial_line = next(
        line for line in text.splitlines() if line.strip().startswith("- trivial:")
    )
    assert "note:" not in trivial_line
