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


def test_edges_are_serialized_once_in_kernel_map() -> None:
    text = render_kernel(KERNEL)
    edge_lines = tuple(
        line for line in text.splitlines()
        if line.startswith(("- forward:", "- side:", "- back:", "- terminal:"))
    )
    assert len(edge_lines) == len(KERNEL.edges)
    gate_detail = text[text.index("## 3. GATE_REFINEMENT"):]
    assert not any(
        line.startswith(("- forward:", "- side:", "- back:", "- terminal:"))
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
    assert normalized_token_count(text) <= 2_810
