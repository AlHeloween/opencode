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

# t82 round 3 (Legislator + outside falsifier, owner 2026-10-17) — five fixes:
# 1. an accepted 000.../non-32-hex/example md5 is NO parent: write 000... and
#    name the defect in your reply (never "Never copy", never "the report");
# 2. the parent rides on EVERY turn OF THAT TASK;
# 3. "your reply", not "the report";
# 4. the md5 bullet mints one fresh vector per emitted vector, not per turn;
# 5. the parent is the FIRST SV block the task arrived with (as t83
#    parse_brief_sv parses it).
FIELD_BAN = "a received md5 never becomes your own md5"
FRESH_ONE = "Mint a fresh one for every vector you emit"
TASK_FIRST = "that task's first SV md5 here"
FIX2_CHUNK = "its brief/artifact vector, never the sender's chat vector — on every turn of that task"
ONE_PARENT = "equal parent-goal-md5s share one parent"
RECEIVED_ZERO = "A received 000..., non-32-hex or example md5"
NO_PARENT = "is no parent: write 000..."
YOUR_REPLY = "name the defect in your reply"
OWN_DEFECT = "equal own-md5s are always a defect"


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_sv_lineage_round3_fixes_rendered(variant) -> None:
    text = render_kernel(KERNEL, *VARIANTS[variant])
    for fragment in (FIELD_BAN, FRESH_ONE, TASK_FIRST, FIX2_CHUNK, ONE_PARENT, RECEIVED_ZERO, NO_PARENT, YOUR_REPLY, OWN_DEFECT):
        assert fragment in text
    for removed in ("Mint it fresh every turn", "Never copy 000", "in the report", "never reuse a received md5", "are lineage", "on every turn;", "An accepted 000"):
        assert removed not in text


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
