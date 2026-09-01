from __future__ import annotations

from dataclasses import replace

from prompt_kernel import KERNEL, render_kernel, validate_kernel


def test_canonical_kernel_is_valid() -> None:
    assert validate_kernel(KERNEL) == []


def test_map_declares_every_gate_and_explicit_g5_side_path() -> None:
    assert tuple(gate.id for gate in KERNEL.gates) == tuple(f"G{i}" for i in range(1, 10))
    assert KERNEL.spine == ("G1", "G2", "G3", "G4", "G6", "G7", "G8", "G9")
    edges = {(edge.source, edge.target, edge.kind) for edge in KERNEL.edges}
    assert ("G4", "G5", "side") in edges
    assert ("G5", "G2", "back") in edges


def test_authorization_precedes_implementation_and_oracle_follows_it() -> None:
    assert KERNEL.spine.index("G4") < KERNEL.spine.index("G7") < KERNEL.spine.index("G8") < KERNEL.spine.index("G9")


def test_every_rule_has_exactly_one_source_owner() -> None:
    rules = [*KERNEL.shared_rules]
    for gate in KERNEL.gates:
        rules.extend(gate.local_rules)
    for protocol in KERNEL.protocols:
        rules.extend(protocol.local_rules)
    assert len({rule.id for rule in rules}) == len(rules)
    assert all(rule.owner for rule in rules)


def test_validator_rejects_missing_gate() -> None:
    errors = validate_kernel(replace(KERNEL, gates=KERNEL.gates[:-1]))
    assert any("gate order" in error for error in errors)


def test_validator_rejects_duplicate_rule_definition() -> None:
    first = KERNEL.gates[0]
    duplicate = replace(first, local_rules=first.local_rules + (first.local_rules[0],))
    errors = validate_kernel(replace(KERNEL, gates=(duplicate, *KERNEL.gates[1:])))
    assert any("duplicate rule" in error for error in errors)


def test_validator_rejects_authorizing_optional_loop() -> None:
    protocol = replace(KERNEL.protocols[0], authority="authorize")
    errors = validate_kernel(replace(KERNEL, protocols=(protocol, *KERNEL.protocols[1:])))
    assert any("advisory" in error for error in errors)


def test_validator_rejects_broken_spine_dataflow() -> None:
    gate = replace(KERNEL.gates[1], requires=KERNEL.gates[1].requires + ("ORACLE_STAMP",))
    errors = validate_kernel(replace(KERNEL, gates=(KERNEL.gates[0], gate, *KERNEL.gates[2:])))
    assert any("before fields exist" in error for error in errors)


def test_validator_rejects_lowercase_identity_entity_name() -> None:
    first = KERNEL.identities[0]
    errors = validate_kernel(replace(KERNEL, identities=(replace(first, id=first.runtime), *KERNEL.identities[1:])))
    assert any("kernel symbol" in error for error in errors)


def test_validator_rejects_uppercase_host_slug() -> None:
    first = KERNEL.identities[0]
    errors = validate_kernel(replace(KERNEL, identities=(replace(first, runtime=first.id), *KERNEL.identities[1:])))
    assert any("runtime slug must be lowercase" in error for error in errors)


def test_validator_rejects_unknown_reference() -> None:
    first = KERNEL.shared_rules[0]
    invalid = replace(first, text=first.text + " @MISSING_SYMBOL")
    errors = validate_kernel(replace(KERNEL, shared_rules=(invalid, *KERNEL.shared_rules[1:])))
    assert any("unresolved reference" in error for error in errors)


def test_validator_rejects_cross_namespace_symbol_collision() -> None:
    first = replace(KERNEL.shared_rules[0], id="USER_REQUEST")
    errors = validate_kernel(replace(KERNEL, shared_rules=(first, *KERNEL.shared_rules[1:])))
    assert any("ambiguous across namespaces" in error for error in errors)


def test_validator_rejects_non_terminal_edge_to_terminal() -> None:
    edge = replace(KERNEL.edges[0], target="SUCCESS")
    errors = validate_kernel(replace(KERNEL, edges=(edge, *KERNEL.edges[1:])))
    assert any("non-terminal edge" in error for error in errors)


def test_rendered_references_resolve_after_map_declaration() -> None:
    text = render_kernel(KERNEL)
    assert "UNRESOLVED_REFERENCE" not in text
    declared = {gate.id for gate in KERNEL.gates}
    declared.update(KERNEL.terms)
    declared.update(rule.id for rule in KERNEL.shared_rules)
    declared.update(rule.id for gate in KERNEL.gates for rule in gate.local_rules)
    declared.update(protocol.id for protocol in KERNEL.protocols)
    declared.update(rule.id for protocol in KERNEL.protocols for rule in protocol.local_rules)
    declared.update((KERNEL.sv_contract.tag, KERNEL.source_routing.tag, KERNEL.source_routing.alias))
    assert declared
