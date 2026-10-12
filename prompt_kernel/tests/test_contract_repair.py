"""K04/K05 contract repair — the G2 sufficiency gate and the G9 close-vs-SUCCESS split.

Each case fails on the missing behavior and pins it: the count the gate reads must be the
REAL candidate list (never a separately asserted number), a small exhaustive space is only
admissible with a nonempty list AND a domain-evidence reference, and a recorded non-PASS may
close the run through a lawful bounded stop without ever being read as SUCCESS.

The G2 rule predicate and the G2 FSM must gate ONE shared condition; the G9 FSM must return
one transition per (from, to) pair, so an OR faked with duplicate endpoints — where
StateMachine.is_valid_transition only ever sees the first match — cannot pass for a branch.
"""

from __future__ import annotations

from prompt_kernel.source import G2_FSM, G9_FSM, KERNEL


def _rule_predicate(gate_id: str, rule_id: str):
    gate = next(g for g in KERNEL.gates if g.id == gate_id)
    return next(rule.predicate for rule in gate.local_rules if rule.id == rule_id)


def _transition(fsm, from_state: str, to_state: str):
    return next(t for t in fsm.transitions if t.from_state == from_state and t.to_state == to_state)


# ---------------------------------------------------------------- G2 sufficiency (K04)


def test_g2_rule_and_fsm_gate_one_shared_sufficiency_condition() -> None:
    from prompt_kernel.source import G2_CANDIDATE_SUFFICIENCY

    transition = _transition(G2_FSM, "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS")
    assert transition.predicate == G2_CANDIDATE_SUFFICIENCY
    # The rule keeps its own L1/medoid clauses, but the sufficiency clause is the SAME object —
    # a second spelling (GE 5 here, GT 4 there) is what let the rule and the FSM disagree.
    manhattan = _rule_predicate("G2", "MANHATTAN_L1")
    assert manhattan is not None
    assert manhattan.op == "AND"
    assert G2_CANDIDATE_SUFFICIENCY in manhattan.args


def test_g2_real_list_of_five_is_sufficient() -> None:
    candidates = [f"c{i}" for i in range(5)]
    assert G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": candidates}
    )


def test_g2_small_exhaustive_space_needs_a_nonempty_list_and_domain_evidence() -> None:
    for size in (1, 2, 3, 4):
        context = {
            "candidates": [f"c{i}" for i in range(size)],
            "small_space": True,
            "domain_evidence_ref": "experiments/2026-10-12_small-space/index.md",
        }
        assert G2_FSM.is_valid_transition(
            "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", context
        ), size


def test_g2_small_space_without_domain_evidence_is_not_selectable() -> None:
    # small_space=True is not a free bypass: without the evidence reference the space is unproven.
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": ["a", "b"], "small_space": True}
    )
    # and the flag without a list at all is not a space either.
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"small_space": True, "domain_evidence_ref": "x"}
    )


def test_g2_empty_candidate_list_is_not_selectable() -> None:
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": []}
    )
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES",
        "CLUSTER_MEDOIDS",
        {"candidates": [], "small_space": True, "domain_evidence_ref": "x"},
    )


def test_g2_asserted_count_cannot_replace_the_real_list() -> None:
    # A candidate_count that lies about the list must not admit the transition (the audit's
    # bypass: the number the FSM read was never the number the list held).
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": ["a"], "candidate_count": 5}
    )
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": ["a", "b"], "candidate_count": 5}
    )
    # the real count still admits: five actual candidates, no asserted number present.
    assert G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": [f"c{i}" for i in range(5)]}
    )


def test_g2_has_no_duplicate_transition_endpoints() -> None:
    seen = set()
    for transition in G2_FSM.transitions:
        key = (transition.from_state, transition.to_state)
        assert key not in seen, key
        seen.add(key)


# ------------------------------------------------- G9 close-vs-SUCCESS (K05)


def test_g9_success_requires_acceptance_oracle_pass_and_zero_risks(evidence_context) -> None:
    # K10 adds a fourth prerequisite; satisfy it to discriminate each old leg.
    good = evidence_context
    assert G9_FSM.is_valid_transition("CHECK_RISKS", "EMIT_SUCCESS", good)
    # any single missing leg refuses SUCCESS.
    assert not G9_FSM.is_valid_transition(
        "CHECK_RISKS", "EMIT_SUCCESS", {**good, "critical_risks": 1}
    )
    assert not G9_FSM.is_valid_transition(
        "CHECK_RISKS", "EMIT_SUCCESS", {**good, "oracle": "FAIL"}
    )
    assert not G9_FSM.is_valid_transition(
        "CHECK_RISKS", "EMIT_SUCCESS", {**good, "acceptance_covered": False}
    )


def test_g9_recorded_non_pass_with_reason_and_residual_closes_without_success() -> None:
    context = {
        "oracle": "FAIL",
        "stop_reason": "run budget exhausted",
        "residual_defined": True,
        "lawful_non_success_terminal": "BLOCKED",
    }
    assert G9_FSM.is_valid_transition("CHECK_ORACLE", "EVALUATE_STOP", context)
    assert G9_FSM.is_valid_transition("EVALUATE_STOP", "EMIT_CLOSURE", context)
    # the same run never reaches SUCCESS.
    assert not G9_FSM.is_valid_transition("CHECK_RISKS", "EMIT_SUCCESS", context)


def test_g9_non_pass_without_reason_or_residual_cannot_close() -> None:
    bare = {"oracle": "FAIL"}
    assert G9_FSM.is_valid_transition("CHECK_ORACLE", "EVALUATE_STOP", bare)
    assert not G9_FSM.is_valid_transition("EVALUATE_STOP", "EMIT_CLOSURE", bare)
    no_residual = {"oracle": "FAIL", "stop_reason": "budget", "lawful_non_success_terminal": "BLOCKED"}
    assert not G9_FSM.is_valid_transition("EVALUATE_STOP", "EMIT_CLOSURE", no_residual)


def test_g9_success_is_refused_on_a_recorded_fail() -> None:
    # SUCCESS is only reachable through the oracle-PASS gate; a FAIL cannot take that branch.
    assert not G9_FSM.is_valid_transition("CHECK_ORACLE", "CHECK_RISKS", {"oracle": "FAIL"})
    assert not G9_FSM.is_valid_transition(
        "CHECK_RISKS", "EMIT_SUCCESS", {"acceptance_covered": True, "oracle": "FAIL", "critical_risks": 0}
    )


def test_g9_presence_of_a_recorded_verdict_is_exists_not_has() -> None:
    # HAS(False) is not «a verdict was recorded»: a falsy-but-present verdict still counts as
    # recorded (EXISTS), so a lawful stop is not silently dropped.
    assert G9_FSM.is_valid_transition("CHECK_ORACLE", "EVALUATE_STOP", {"oracle": False})
    assert G9_FSM.is_valid_transition("CHECK_ORACLE", "EVALUATE_STOP", {"oracle": ""})
    assert not G9_FSM.is_valid_transition("CHECK_ORACLE", "EVALUATE_STOP", {})


def test_g9_success_and_closure_are_distinct_accepting_states() -> None:
    assert "EMIT_SUCCESS" in G9_FSM.accepting_states
    assert "EMIT_CLOSURE" in G9_FSM.accepting_states
    assert "EMIT_SUCCESS" != "EMIT_CLOSURE"


def test_g9_has_no_duplicate_transition_endpoints() -> None:
    # A duplicate (from, to) pair is not an OR: is_valid_transition returns the FIRST match.
    seen = set()
    for transition in G9_FSM.transitions:
        key = (transition.from_state, transition.to_state)
        assert key not in seen, key
        seen.add(key)


def test_g9_lawful_stop_is_reachable_with_uncovered_acceptance() -> None:
    context = {
        "VERIFIED_OUTCOME": {"acceptance_id": "FAIL"},
        "acceptance_covered": False,
        "oracle": "FAIL",
        "stop_reason": "budget exhausted",
        "residual_defined": True,
        "lawful_non_success_terminal": "BLOCKED",
    }
    for before, after in (
        ("AWAIT_VERIFICATION", "CHECK_ACCEPTANCE"),
        ("CHECK_ACCEPTANCE", "EVALUATE_STOP"),
        ("EVALUATE_STOP", "EMIT_CLOSURE"),
    ):
        assert G9_FSM.is_valid_transition(before, after, context), (before, after)


def test_g9_success_is_not_a_non_success_terminal() -> None:
    for terminal in ("SUCCESS", True, "invented", ""):
        assert not G9_FSM.is_valid_transition(
            "EVALUATE_STOP", "EMIT_CLOSURE",
            {"stop_reason": "budget", "residual_defined": True,
             "lawful_non_success_terminal": terminal},
        )


def test_candidate_payload_is_a_sequence_not_an_asserted_number() -> None:
    for candidates in (5, "abcde", {"a": 1}, True):
        assert not G2_FSM.is_valid_transition(
            "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS",
            {"candidates": candidates, "small_space": True, "domain_evidence_ref": "x"},
        )
