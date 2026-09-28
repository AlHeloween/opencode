"""Constitutional tests — step 5 of docs/kernel-amendment.md.

The amendment ruling says a SELF_MODIFY without these closes Unknown. They do not
check that the kernel renders; test_render does that. They check the conditions under
which it is a kernel at all: that the constitution core is present, named, intact and
not quietly re-listed, and that the authority structure still separates who may mutate
from who may authorize.

Every one is paired with a mutation: build a weakened kernel, assert the guard fires.
A constitutional test that cannot fail proves nothing (@ORACLE).
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.validate import validate_kernel


# The core set is pinned here, not only in source.py. Changing the constitution then
# requires changing this literal — which is the friction an L3 is supposed to have.
EXPECTED_CORE = frozenset({
    "SAFETY_PRECEDENCE",
    "AUTHORITY_SEPARATION",
    "EVIDENCE_ORDER",
    "INFORMATION_STATUS",
    "ORACLE",
    "SIMULATION_ERROR",
    "PLAN_CONTRACT_ENFORCEMENT",
    "PLAN_BINDING_ENFORCEMENT",
})

# One load-bearing clause per core rule. Gutting a rule while keeping its name is the
# cheapest possible weakening, and the only thing that catches it is pinned substance.
CORE_SUBSTANCE = {
    "SAFETY_PRECEDENCE": "safety > governance > task > domain > style",
    "AUTHORITY_SEPARATION": "No role may silently inherit",
    "EVIDENCE_ORDER": "No rung of @INFOMARK may be skipped",
    "INFORMATION_STATUS": "Never treat Inferred as Exact",
    "ORACLE": "an instrument that cannot fail proves nothing",
    "SIMULATION_ERROR": "Do not treat simulation error",
    "PLAN_CONTRACT_ENFORCEMENT": "binds to an authorized plan task",
    "PLAN_BINDING_ENFORCEMENT": "concrete binding inside the execution envelope",
}


def _all_rules(kernel=KERNEL):
    rules = list(kernel.shared_rules)
    rules.extend(rule for gate in kernel.gates for rule in gate.local_rules)
    rules.extend(rule for protocol in kernel.protocols for rule in protocol.local_rules)
    return rules


def test_constitution_core_is_exactly_the_declared_set() -> None:
    assert KERNEL.constitution_core == EXPECTED_CORE


def test_every_core_rule_exists() -> None:
    declared = {rule.id for rule in _all_rules()}
    assert EXPECTED_CORE <= declared


def test_validator_rejects_a_core_entry_with_no_rule() -> None:
    errors = validate_kernel(replace(KERNEL, constitution_core=KERNEL.constitution_core | {"NO_SUCH_RULE"}))
    assert any("constitution core names an unknown rule" in error for error in errors)


def test_every_core_rule_keeps_its_load_bearing_clause() -> None:
    texts = {rule.id: rule.text for rule in _all_rules()}
    for rule_id, clause in CORE_SUBSTANCE.items():
        assert clause in texts[rule_id], rule_id


def core_substance_gaps(kernel) -> list[str]:
    """The check itself, so it can be pointed at a weakened kernel and observed to fire."""
    texts = {rule.id: rule.text for rule in _all_rules(kernel)}
    return [
        rule_id
        for rule_id, clause in CORE_SUBSTANCE.items()
        if clause not in texts.get(rule_id, "")
    ]


def test_gutting_a_core_rule_is_caught() -> None:
    """Weakening by truncation keeps the name and drops the norm — the cheapest attack."""
    assert core_substance_gaps(KERNEL) == []
    gutted = tuple(
        replace(rule, text="Follow good practice.") if rule.id == "EVIDENCE_ORDER" else rule
        for rule in KERNEL.shared_rules
    )
    assert core_substance_gaps(replace(KERNEL, shared_rules=gutted)) == ["EVIDENCE_ORDER"]


def test_renaming_a_core_rule_is_caught() -> None:
    renamed = tuple(
        replace(rule, id="EVIDENCE_ORDER_V2") if rule.id == "EVIDENCE_ORDER" else rule
        for rule in KERNEL.shared_rules
    )
    assert core_substance_gaps(replace(KERNEL, shared_rules=renamed)) == ["EVIDENCE_ORDER"]


def test_core_rules_render_as_named_declarations() -> None:
    """An unnamed rule renders as a plain bullet and stops being referenceable."""
    text = render_kernel(KERNEL)
    for rule_id in EXPECTED_CORE:
        assert f"#### @{rule_id}" in text, rule_id


def test_every_identity_declares_a_tools_row() -> None:
    """`may_mutate` left the identity contract on 2026-09-28: what an identity may do is its
    tools row, and the runtime ACL (agent.ts) is the source it is held to — the TS parity test
    in packages/opencode fails on drift. The constitutional floor here is coverage: no identity
    renders without a declared tools row."""
    from prompt_kernel.addons import IDENTITY_ADDONS

    declared = {addon.identity_id for addon in IDENTITY_ADDONS}
    assert declared == {identity.id for identity in KERNEL.identities}


def test_self_modify_and_promote_stable_stay_distinct_classes() -> None:
    """Running them as one motion is how an unreviewed kernel reaches production."""
    assert "SELF_MODIFY" in KERNEL.action_classes
    assert "PROMOTE_STABLE" in KERNEL.action_classes
    assert KERNEL.action_classes["SELF_MODIFY"] != KERNEL.action_classes["PROMOTE_STABLE"]


def test_mutation_gate_still_requires_envelope_and_allow() -> None:
    """G7 mutates; it may not start without the envelope, and G6 may not bind without ALLOW."""
    gates = {gate.id: gate for gate in KERNEL.gates}
    assert "EXECUTION_ENVELOPE" in gates["G7"].requires
    assert "AUTH_DECISION" in gates["G6"].requires


def test_removing_the_envelope_breaks_the_dataflow() -> None:
    """The forward reachability check is what makes the requirement above load-bearing."""
    without = tuple(
        replace(gate, outputs=tuple(f for f in gate.outputs if f != "EXECUTION_ENVELOPE"))
        if gate.id == "G4"
        else gate
        for gate in KERNEL.gates
    )
    errors = validate_kernel(replace(KERNEL, gates=without))
    assert any("EXECUTION_ENVELOPE" in error for error in errors)


def test_declared_fsm_predicates_drive_their_real_transitions() -> None:
    from prompt_kernel.source import EVOLUTION_LOOP_FSM, G0_FSM, G2_FSM

    assert G0_FSM.is_valid_transition("AWAIT_REQUEST", "PARSE_INTENT", {"USER_REQUEST": "hello"})
    assert not G0_FSM.is_valid_transition("AWAIT_REQUEST", "PARSE_INTENT", {})
    assert G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": ["a"], "candidate_count": 5}
    )
    assert not G2_FSM.is_valid_transition(
        "GENERATE_CANDIDATES", "CLUSTER_MEDOIDS", {"candidates": ["a"], "candidate_count": 4}
    )
    assert G2_FSM.is_valid_transition(
        "VALIDATE_SIMPLEX", "EMIT_TASKS", {"medoids": ["a"], "independent_explanations": True}
    )
    assert not G2_FSM.is_valid_transition(
        "VALIDATE_SIMPLEX", "EMIT_TASKS", {"medoids": ["a"], "independent_explanations": False}
    )
    assert EVOLUTION_LOOP_FSM.is_valid_transition(
        "AWAIT_TRIGGER", "CHECK_TRIGGER_B", {"undirected_conversation": True, "message_count": 10}
    )
    assert not EVOLUTION_LOOP_FSM.is_valid_transition(
        "AWAIT_TRIGGER", "CHECK_TRIGGER_B", {"undirected_conversation": True, "message_count": 9}
    )


def test_adid_imported_rules_carry_an_executable_predicate() -> None:
    """The imported 15.3 rules were prose only, so a reader could obey them without checking anything.

    This is coverage, not correctness: a dropped predicate is what silently removes the only
    machine-checkable form of a rule, and nothing else in the suite would notice — the render
    test only proves the TEXT survives, which is the other half. Whether each transcription is
    faithful to its sentence is review, not a test.
    """
    from prompt_kernel.source import KERNEL as SOURCE_KERNEL

    wanted = {
        "REWARD_FUNCTION",
        "BUG_FIX_PROCEDURE",
        "QUALITY_GUARDRAILS",
        "EVOLUTION_CANDIDATES",
        "SELF_TRIGGER_A",
        "SELF_TRIGGER_B",
    }
    predicates = {
        rule.id: rule.predicate
        for rule in (*SOURCE_KERNEL.shared_rules, *(r for g in SOURCE_KERNEL.gates for r in g.local_rules), *(r for p in SOURCE_KERNEL.protocols for r in p.local_rules))
    }
    assert wanted <= set(predicates)
    missing = sorted(rule_id for rule_id in wanted if predicates[rule_id] is None)
    assert missing == []


def test_malformed_fsm_predicate_fails_closed() -> None:
    from prompt_kernel.model import BooleanPredicate

    with pytest.raises(ValueError, match="operand"):
        BooleanPredicate("HAS")
    with pytest.raises(ValueError, match="operator"):
        BooleanPredicate("UNKNOWN")  # type: ignore[arg-type]


def test_evidence_ladder_still_ends_at_exact_through_an_oracle() -> None:
    ladder = dict((status, condition) for condition, status in KERNEL.source_routing.ladder)
    assert "smoke" in ladder["Exact"].lower() or "poc" in ladder["Exact"].lower()
    assert ladder["Unknown"]
    assert "Inferred" in KERNEL.source_routing.generic_web_rule
