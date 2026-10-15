"""t49 — the kernel is the one copy; kernel/skill fixes go as tickets to the kernel owner.

Owner, 2026-10-15, verbatim: «надо явно прописать в кернеле — не дублировать кернел в памяти и
agents.md и отправлять тикеты по доработке кернела и скиллов, разумеется все будет проходить через
тебя» («тебя» = Claude, the kernel owner, org login `claude`).

Written BEFORE the implementation (tests first). Encodes the two clauses:

1. INTENTION_RESET `PERSISTED_CRITERION` (source.py) is EXTENDED in place — the kernel is the
   single copy: memory, AGENTS.md, skills and briefs never restate its rules, they point to the
    rule tag; a defect or gap found in the kernel or a skill is filed as a ticket to the
   kernel owner with its evidence (reproducer, receipt), never patched or restated locally.
2. The host binding (kernel owner login + the ticket route) lives in the add-ons, where the
   org.fossil line already lives (G1 VCS_ROLES), one place per variant, all four.

Mutation controls: dropping «never restate» or the ticket route from the rendered text must make
the assertions fail — the tests pin the words, not a paraphrase.
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

# The extended clause, split into the parts the mutation controls drop one at a time.
ONE_COPY_CLAUSE = (
    "the kernel is the single copy — memory, AGENTS.md, skills and briefs never restate its rules, "
    "they point to the rule tag; a defect or gap found in the kernel or a skill is filed as "
    "a ticket to the kernel owner with its evidence (reproducer, receipt), never patched or restated locally."
)
NEVER_RESTATE_PART = (
    "memory, AGENTS.md, skills and briefs never restate its rules, they point to the rule tag"
)
TICKET_RULE_PART = (
    "a defect or gap found in the kernel or a skill is filed as a ticket to the kernel owner"
)

# The host binding, one place per variant, where the org.fossil line already lives (G1 VCS_ROLES).
TICKET_ROUTE_CLAUSE = (
    "Kernel owner = org login `claude`; a kernel or skill defect or gap is filed as a ticket to "
    "the kernel owner: python $ORG_HOME/genesis/org.py delegate --assignee claude --title <ticket> "
    "--comment <evidence: reproducer, receipt>"
)
TICKET_ROUTE_PART = (
    "python $ORG_HOME/genesis/org.py delegate --assignee claude --title <ticket>"
)


def _intention_reset_block(rendered: str) -> str:
    start = rendered.index("<INTENTION_RESET_RULES>")
    return rendered[start : rendered.index("</INTENTION_RESET_RULES>", start)]


def _gate_block(rendered: str, gate_id: str) -> str:
    start = rendered.index(f"<{gate_id}_RULES>")
    return rendered[start : rendered.index(f"</{gate_id}_RULES>", start)]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_one_copy_clause_renders_in_intention_reset(variant) -> None:
    text = _intention_reset_block(render_kernel(KERNEL, *VARIANTS[variant]))
    assert ONE_COPY_CLAUSE in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_ticket_route_renders_in_g1_vcs_roles(variant) -> None:
    text = _gate_block(render_kernel(KERNEL, *VARIANTS[variant]), "G1")
    assert TICKET_ROUTE_CLAUSE in text


def test_one_copy_is_declared_once_in_the_kernel() -> None:
    # The kernel is the one copy: the clause renders in the INTENTION_RESET rules block
    # exactly once per render — a second copy in the render would be the defect itself.
    text = render_kernel(KERNEL)
    assert text.count(ONE_COPY_CLAUSE) == 1


def test_ticket_route_is_declared_once_per_variant() -> None:
    for variant, addons in VARIANTS.items():
        text = render_kernel(KERNEL, *addons)
        assert text.count(TICKET_ROUTE_PART) == 1, variant


def test_mutation_control_dropping_never_restate_fails() -> None:
    text = _intention_reset_block(render_kernel(KERNEL))
    mutant = text.replace(NEVER_RESTATE_PART, "memory, AGENTS.md, skills and briefs follow its rules")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert ONE_COPY_CLAUSE in mutant


def test_mutation_control_dropping_ticket_rule_fails() -> None:
    text = _intention_reset_block(render_kernel(KERNEL))
    mutant = text.replace(TICKET_RULE_PART, "a defect or gap found in the kernel or a skill is noted locally")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert ONE_COPY_CLAUSE in mutant


def test_mutation_control_dropping_ticket_route_fails() -> None:
    text = _gate_block(render_kernel(KERNEL), "G1")
    mutant = text.replace(TICKET_ROUTE_PART, "python $ORG_HOME/genesis/org.py delegate --title <ticket>")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert TICKET_ROUTE_CLAUSE in mutant


def test_mutation_control_dropping_assignee_fails() -> None:
    text = _gate_block(render_kernel(KERNEL), "G1")
    mutant = text.replace("--assignee claude", "--assignee <owner>")
    assert mutant != text
    with pytest.raises(AssertionError):
        assert TICKET_ROUTE_CLAUSE in mutant


QUALIFIED_TOOL_CLAUSE = (
    "AST edits need a qualified tool; source-writing scripts are not a substitute."
)


def test_qualified_tool_clause_renders_in_product_and_codex_g7() -> None:
    # t49 addendum (t48 dedup report): the variant-parity hole — addons_codex
    # TOOL_IMPLEMENT carried this clause, the opencode registry lacked it.
    # Claude/Cursor are exempt with reason: neither binds a qualified AST tool
    # (claude: "no bulk patch tool"; cursor: Edit & Reapply only), so the clause
    # would instruct a tool the host does not have.
    for variant, addons in (("product", (GATE_ADDONS, None)), ("codex", (CODEX_GATE_ADDONS, ()))):
        text = _gate_block(render_kernel(KERNEL, *addons), "G7")
        assert QUALIFIED_TOOL_CLAUSE in text, variant


def test_mutation_control_dropping_qualified_tool_clause_fails() -> None:
    text = _gate_block(render_kernel(KERNEL), "G7")
    mutant = text.replace(
        QUALIFIED_TOOL_CLAUSE, "AST edits need care; scripts may edit sources."
    )
    assert mutant != text
    with pytest.raises(AssertionError):
        assert QUALIFIED_TOOL_CLAUSE in mutant
