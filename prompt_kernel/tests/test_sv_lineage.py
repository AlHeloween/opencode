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

# t82 review (Legislator + outside falsifier, owner 2026-10-17) — four fixes:
# 1. the reuse ban is scoped to the md5 FIELD: a received md5 never becomes the
#    receiver's OWN md5 (it still rides as parent-goal-md5);
# 2. the parent is the TASK's own SV (brief/artifact vector, never the sender's
#    chat vector), carried on EVERY turn of that task;
# 3. equal parent-goal-md5s share ONE parent (siblings), not the whole ancestry;
# 4. 000… / non-32-hex / the format example are never copied as a parent —
#    name the defect in the report.
FIELD_BAN = "a received md5 never becomes your own md5"
TASK_OWN = "that task's own SV md5 here"
FIX2_CHUNK = "its brief/artifact vector, never the sender's chat vector — on every turn"
ONE_PARENT = "equal parent-goal-md5s share one parent"
NO_ZERO_COPY = "Never copy 000..."
NAME_DEFECT = "name the defect in the report"
OWN_DEFECT = "equal own-md5s are always a defect"


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_lineage_review_fixes_rendered(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    for fragment in (FIELD_BAN, TASK_OWN, FIX2_CHUNK, ONE_PARENT, NO_ZERO_COPY, NAME_DEFECT, OWN_DEFECT):
        assert fragment in text
    assert "never reuse a received md5" not in text
    assert "are lineage" not in text


def test_sv_lineage_guard_rejects_dropped_field_ban() -> None:
    text = render_kernel(KERNEL)
    assert FIELD_BAN in text
    mutant = text.replace(FIELD_BAN, "")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert FIELD_BAN in mutant


def test_sv_lineage_guard_rejects_dropped_task_own() -> None:
    text = render_kernel(KERNEL)
    assert FIX2_CHUNK in text
    mutant = text.replace(FIX2_CHUNK, "")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert FIX2_CHUNK in mutant
