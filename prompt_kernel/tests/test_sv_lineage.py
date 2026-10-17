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

# t82: owner 2026-10-17 — a received task's SV md5 becomes the receiver's
# parent-goal-md5; the receiver mints its own md5 fresh. Equal own-md5s are a
# defect; equal parent-goal-md5s are lineage.
RECEIVED_HALF = "A task arriving with an SV carries that SV's md5 here"
FRESH_HALF = "Mint it fresh every turn; never reuse a received md5"
DEFECT_HALF = "equal own-md5s are always a defect"
LINEAGE_HALF = "equal parent-goal-md5s are lineage"


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_lineage_both_halves_rendered(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    assert RECEIVED_HALF in text
    assert FRESH_HALF in text
    assert DEFECT_HALF in text
    assert LINEAGE_HALF in text


def test_sv_lineage_guard_rejects_dropped_half() -> None:
    text = render_kernel(KERNEL)
    assert RECEIVED_HALF in text
    assert FRESH_HALF in text
    for dropped in (RECEIVED_HALF, FRESH_HALF):
        mutant = text.replace(dropped, "")
        assert mutant != text
        with pytest.raises(AssertionError):
            assert dropped in mutant
