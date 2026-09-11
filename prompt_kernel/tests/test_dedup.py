from __future__ import annotations

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.dedup import (
    REPEATED_NGRAM_ALLOWLIST,
    SEMANTIC_OVERLAP_ALLOWLIST,
    find_unapproved_semantic_overlaps,
    normalized_token_count,
    repeated_ngrams,
)


def test_state_and_rule_semantics_have_no_unreviewed_overlap() -> None:
    assert find_unapproved_semantic_overlaps(KERNEL) == []
    assert all(reason.strip() for reason in SEMANTIC_OVERLAP_ALLOWLIST.values())


def test_renderer_has_no_repeated_owner_boilerplate() -> None:
    text = render_kernel(KERNEL)
    assert not any(line.startswith("owner: ") for line in text.splitlines())


def test_edges_are_serialized_once_in_workflow_map() -> None:
    text = render_kernel(KERNEL)
    # Each edge kind block serializes exactly once: forward_move, CONCERN,
    # back_move, terminal — counts must match the kernel graph.
    edges_by_kind: dict[str, int] = {}
    for edge in KERNEL.edges:
        edges_by_kind[edge.kind] = edges_by_kind.get(edge.kind, 0) + 1
    rendered_forward = text[text.index("forward_move:") : text.index("CONCERN:")]
    rendered_back = text[text.index("back_move:") : text.index("terminal:")]
    rendered_terminal = text[text.index("terminal:") : text.index("side_protocols:")]

    def arrow_lines(block: str) -> tuple[str, ...]:
        return tuple(l for l in block.splitlines() if l.startswith("- ") and " -> " in l)

    assert len(arrow_lines(rendered_forward)) == edges_by_kind["forward"]
    assert len(arrow_lines(rendered_back)) == edges_by_kind["back"]
    assert len(arrow_lines(rendered_terminal)) == edges_by_kind["terminal"]
    assert text.count("CONCERN: G4 -> G5") == edges_by_kind["side"]
    gate_detail = text[text.index("## 3. GATE_REFINEMENT"):]
    assert not any(
        line.startswith(("- forward:", "- side:", "- back:", "- terminal:", "CONCERN:"))
        for line in gate_detail.splitlines()
    )


def test_identity_authority_clause_is_declared_once() -> None:
    text = render_kernel(KERNEL)
    assert text.count("runtime ACL and G4 envelope remain authoritative") == 1


def test_no_unapproved_five_gram_repeats_four_or_more_times() -> None:
    assert repeated_ngrams(
        render_kernel(KERNEL),
        width=5,
        minimum=4,
        allowlist=REPEATED_NGRAM_ALLOWLIST,
    ) == {}


def test_compacted_runtime_budget() -> None:
    text = render_kernel(KERNEL)
    assert len(text.encode("utf-8")) <= KERNEL.utf8_budget
    # 2_950: admits the gate-addons section 6 (2026-09-04, Alexander) —
    # +2.1% tokens for the addon surface against +3.5% bytes; kernel graph untouched.
    # 3_100: admits gate G0 UNDERSTAND (2026-09-07, Alexander) — language +
    # Digital Intention discipline; graph grew by one node and one forward edge.
    # 3_300: admits the @ORACLE purpose clause (why an oracle exists, layer
    # targeting, no self-grading) and the G8 shared-session attribution rule
    # (2026-09-11, Alexander) — same decision raised utf8_budget to 27 000:
    # "там всё нужно, сильная кастрация ведёт к непонятками".
    # 3_450 / utf8_budget 28_000 (2026-09-11, Alexander, same day): admits the
    # §0 error premise and G9 EVIDENCE_BOUNDED_CLOSURE. Policy stated with the
    # decision: "28к мелкая плата за будущие ошибки… может через месяц и будет
    # 30к — нужны дополнения по мере использования". So growth is expected and
    # deliberate, not drift: the prefix is paid per request, and each raise
    # names what it admits. Do not shrink these caps to reclaim margin.
    assert normalized_token_count(text) <= 3_450
