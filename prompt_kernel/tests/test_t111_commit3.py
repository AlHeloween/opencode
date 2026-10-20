"""t111 commit 3 — unlisted-rules line (2026-10-20).

RED on HEAD (line absent), GREEN after.
Provenance: owner target text, 2026-10-20.
Line: «A shared rule that no gate lists in its shared_rules applies at every gate.»
Present in all 4 variants (product, claude, codex, cursor) — reference_grammar is render-common.
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

LINE = "A shared rule that no gate lists in its shared_rules applies at every gate."


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_unlisted_rules_line_present_in_all_variants(variant) -> None:
    """Owner target text Commit 3, 2026-10-20."""
    addons, identity_addons = VARIANTS[variant]
    text = render_kernel(KERNEL, addons, identity_addons) if identity_addons is not None else render_kernel(KERNEL, addons)
    assert LINE in text
