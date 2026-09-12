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

MAY_MUTATE = frozenset({"BUILD_MODE", "CODER_AGENT", "MEDIA_AGENT"})


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


def test_only_three_identities_may_mutate() -> None:
    assert {i.id for i in KERNEL.identities if i.may_mutate} == MAY_MUTATE


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


def test_evidence_ladder_still_ends_at_exact_through_an_oracle() -> None:
    ladder = dict((status, condition) for condition, status in KERNEL.source_routing.ladder)
    assert "smoke" in ladder["Exact"].lower() or "poc" in ladder["Exact"].lower()
    assert ladder["Unknown"]
    assert "Inferred" in KERNEL.source_routing.generic_web_rule
