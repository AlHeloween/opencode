"""t111 commit 2 — 10 structural fixes, target text (2026-10-20).

RED on HEAD (before fixes), GREEN after.
Provenance: owner target text S01-S11, 2026-10-20.
S08 NOT-REAL, S12/S13 UNCLEAR — not changed, no test.
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


def _gate_rule(gate_id: str, rule_id: str) -> str:
    return next(
        rule.text for gate in KERNEL.gates if gate.id == gate_id for rule in gate.local_rules if rule.id == rule_id
    )


def _shared(rule_id: str) -> str:
    return next(rule.text for rule in KERNEL.shared_rules if rule.id == rule_id)


def _protocol(proto_id: str):
    return next(p for p in KERNEL.protocols if p.id == proto_id)


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_s01_marker_scope(variant) -> None:
    """S01: marker applies in reasoning records; MUST NOT alter shipped product text."""
    text = render_kernel(KERNEL, *VARIANTS[variant]) if VARIANTS[variant][1] is not None else render_kernel(KERNEL, VARIANTS[variant][0])
    assert "The ASSERTION_STATUS marker applies in reasoning records" in text
    assert "commits, memory, replies and working notes" in text
    assert "It MUST NOT alter shipped product text" in text
    assert "a marker there is a defect." in text


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_s01_assertion_form(variant) -> None:
    """S01: every assertion in a reasoning record carries its status."""
    text = render_kernel(KERNEL, *VARIANTS[variant]) if VARIANTS[variant][1] is not None else render_kernel(KERNEL, VARIANTS[variant][0])
    assert "every assertion in a reasoning record carries its status" in text


def test_s02_stabilize_entry() -> None:
    """S02: STABILIZE entry is a classified reproducer, not a READY surface."""
    edit_sv = _gate_rule("G7", "EDIT_SV")
    assert "or the entry condition of its WORK_KIND (CHANGE: a READY surface; STABILIZE: a classified reproducer) = no direction" in edit_sv


def test_s03_delegation_observes_g3_g9() -> None:
    """S03: DELEGATION observed at G3 and G9."""
    proto = _protocol("DELEGATION")
    assert "G3" in proto.observed_at and "G9" in proto.observed_at
    text = render_kernel(KERNEL)
    assert "DELEGATION: observe [G1, G2, G3, G6, G7, G8, G9]" in text


def test_s04_interrupt_partial_entry() -> None:
    """S04: interrupt fills G9 requires from what exists, missing stated Unknown."""
    edge = next(e for e in KERNEL.edges if e.source == "*" and e.target == "G9")
    assert "G9's requires are filled from what exists, each missing one stated Unknown, never invented" in edge.condition
    assert "no false DONE" in edge.condition
    assert "CLEAN_NEXT_STATE" in KERNEL.state_fields
    clean = KERNEL.state_fields["CLEAN_NEXT_STATE"]
    assert "next_action" in clean and "continuation_receipt" in clean


def test_s05_unknown_member() -> None:
    """S05: VERIFIED_OUTCOME and ORACLE_STAMP gain UNKNOWN."""
    assert "unknown" in KERNEL.state_fields["VERIFIED_OUTCOME"]
    assert "UNKNOWN" in KERNEL.state_fields["ORACLE_STAMP"]


def test_s06_stall_vs_exhaustion() -> None:
    """S06: STALL runs same-run descent; exhaustion persists next-run route."""
    prog = _shared("LOOP_PROGRESS")
    assert "STALL routes to G9, where closure decides; with budget left the descent G9 → G1/G2 runs in this run." in prog
    assert "Exhaustion routes to G9 too, but persists that descent as the next run's route and never executes it." in prog


def test_s07_bootstrap_prerequisites() -> None:
    """S07: BOOTSTRAP names idempotent grounding prerequisites."""
    boot = KERNEL.state_fields["BOOTSTRAP"]
    assert "plus the idempotent grounding prerequisites G1 itself names (organization init, index refresh, snapshot reopen)" in boot
    assert "a read-only identity requests them from its parent" in boot


def test_s09_oracle_fail_criterion() -> None:
    """S09: oracle adds nothing only when it cannot fail on this input."""
    oracle = _gate_rule("G8", "ORACLE")
    assert "If it cannot fail on this input → it adds nothing" in oracle
    assert "a predicted PASS that could have failed, with a fresh run receipt, is evidence." in oracle


def test_s10_majority_names_where_to_look() -> None:
    """S10: majority names where to look; ground diverge side against requirement."""
    found = False
    for rule in KERNEL.shared_rules:
        if "The majority names where to look, not who is wrong" in rule.text:
                assert "@TEST_INVARIANT" in rule.text
                found = True
    assert found


def test_s11_divergence_precedence() -> None:
    """S11: diverged stamped premise goes to G1 first."""
    div = _shared("DIVERGENCE_PROTOCOL")
    assert "Precedence: a diverged stamped premise goes to the G1 full re-grounding first" in div
