from __future__ import annotations

import re

from .model import Kernel, SourceRoutingContract, SemanticVectorContract


REFERENCE = re.compile(r"@([A-Z][A-Z0-9_]*)")
SYMBOL = re.compile(r"[A-Z][A-Z0-9_]*")
EXPECTED_GATES = tuple(f"G{i}" for i in range(1, 10))
EXPECTED_SPINE = ("G1", "G2", "G3", "G4", "G6", "G7", "G8", "G9")
EXPECTED_SV_DIGEST = ("md5", "prev-md5", "parent-goal-md5")
EXPECTED_EVIDENCE_STATUSES = ("Guess", "Hypothetical", "Inferred", "Exact", "Unknown")


def _duplicates(values: list[str]) -> list[str]:
    return sorted({value for value in values if values.count(value) > 1})


def validate_kernel(kernel: Kernel) -> list[str]:
    errors: list[str] = []
    gate_ids = tuple(gate.id for gate in kernel.gates)
    if gate_ids != EXPECTED_GATES:
        errors.append(f"gate order must be {EXPECTED_GATES}, got {gate_ids}")
    if kernel.spine != EXPECTED_SPINE:
        errors.append(f"canonical spine must be {EXPECTED_SPINE}, got {kernel.spine}")

    known_nodes = set(gate_ids) | set(kernel.terminals)
    for edge in kernel.edges:
        if edge.source not in known_nodes:
            errors.append(f"edge source is unknown: {edge.source}")
        if edge.target not in known_nodes:
            errors.append(f"edge target is unknown: {edge.target}")
        if edge.kind not in {"forward", "side", "back", "terminal"}:
            errors.append(f"edge kind is invalid: {edge.kind}")
        if edge.kind == "terminal" and edge.target not in set(kernel.terminals):
            errors.append(f"terminal edge must target a terminal: {edge.source} -> {edge.target}")
        if edge.kind != "terminal" and edge.target in set(kernel.terminals):
            errors.append(f"non-terminal edge cannot target a terminal: {edge.source} -> {edge.target}")

    expected_forward = set(zip(kernel.spine, kernel.spine[1:]))
    actual_forward = {(edge.source, edge.target) for edge in kernel.edges if edge.kind == "forward"}
    if actual_forward != expected_forward:
        errors.append(f"forward edges must serialize the canonical spine: {sorted(actual_forward)}")
    if not any(edge.source == "G4" and edge.target == "G5" and edge.kind == "side" for edge in kernel.edges):
        errors.append("G5 concern path must be explicit side edge G4 -> G5")
    if not any(edge.source == "G5" and edge.target == "G2" and edge.kind == "back" for edge in kernel.edges):
        errors.append("G5 concern path must return through explicit back edge G5 -> G2")

    shared_ids = {rule.id for rule in kernel.shared_rules}
    all_rules = [*kernel.shared_rules]
    for gate in kernel.gates:
        all_rules.extend(gate.local_rules)
        if any(rule.owner != gate.id for rule in gate.local_rules):
            errors.append(f"gate {gate.id} has a local rule owned elsewhere")
        for rule_id in gate.shared_rules:
            if rule_id not in shared_ids:
                errors.append(f"gate {gate.id} references unknown shared rule {rule_id}")
    for protocol in kernel.protocols:
        all_rules.extend(protocol.local_rules)
        if protocol.authority != "advisory":
            errors.append(f"optional protocol {protocol.id} must remain advisory")
        if any(rule.owner != protocol.id for rule in protocol.local_rules):
            errors.append(f"protocol {protocol.id} has a local rule owned elsewhere")
        for gate_id in protocol.observed_at:
            if gate_id not in set(gate_ids):
                errors.append(f"protocol {protocol.id} observes unknown gate {gate_id}")
        if protocol.returns_to not in set(gate_ids) | {"SAME_GATE"}:
            errors.append(f"protocol {protocol.id} returns to unknown node {protocol.returns_to}")
    if any(rule.owner != "KERNEL" for rule in kernel.shared_rules):
        errors.append("shared rules must be owned by KERNEL")
    for duplicate in _duplicates([rule.id for rule in all_rules]):
        errors.append(f"duplicate rule definition: {duplicate}")

    state_fields = set(kernel.state_fields)
    for field in kernel.initial_state:
        if field not in state_fields:
            errors.append(f"initial state field is unknown: {field}")
    for gate in kernel.gates:
        for field in (*gate.requires, *gate.outputs):
            if field not in state_fields:
                errors.append(f"gate {gate.id} references unknown state field {field}")

    available = set(kernel.initial_state)
    gates = {gate.id: gate for gate in kernel.gates}
    for gate_id in kernel.spine:
        gate = gates.get(gate_id)
        if gate is None:
            continue
        missing = sorted(set(gate.requires) - available)
        if missing:
            errors.append(f"spine dataflow reaches {gate_id} before fields exist: {missing}")
        available.update(gate.outputs)

    identities = {identity.id for identity in kernel.identities}
    for identity in kernel.identities:
        if not SYMBOL.fullmatch(identity.id):
            errors.append(f"identity id must be a kernel symbol: {identity.id}")
        if not identity.runtime or identity.runtime != identity.runtime.lower():
            errors.append(f"identity {identity.id} runtime slug must be lowercase: {identity.runtime}")
    for duplicate in _duplicates([identity.runtime for identity in kernel.identities]):
        errors.append(f"duplicate identity runtime slug: {duplicate}")
    for gate in kernel.gates:
        for identity in gate.identities:
            if identity not in identities:
                errors.append(f"gate {gate.id} references unknown identity {identity}")
    for identity in kernel.identities:
        for gate_id in identity.gates:
            if gate_id not in set(gate_ids):
                errors.append(f"identity {identity.id} references unknown gate {gate_id}")

    errors.extend(_validate_sv_contract(kernel.sv_contract))
    errors.extend(_validate_source_routing(kernel.source_routing))

    namespaces = {
        "gate": set(gate_ids),
        "anchor": {gate.anchor for gate in kernel.gates},
        "term": set(kernel.terms),
        "state": state_fields,
        "action": set(kernel.action_classes),
        "rule": {rule.id for rule in all_rules},
        "protocol": {protocol.id for protocol in kernel.protocols},
        "identity": identities,
        "terminal": set(kernel.terminals),
        "contract": {
            kernel.sv_contract.tag,
            kernel.source_routing.tag,
            kernel.source_routing.alias,
        },
    }
    owners: dict[str, list[str]] = {}
    for namespace, names in namespaces.items():
        for name in names:
            owners.setdefault(name, []).append(namespace)
    for name, categories in sorted(owners.items()):
        if len(categories) > 1:
            errors.append(f"symbol {name} is ambiguous across namespaces: {categories}")
    symbols = set(owners)
    texts = [rule.text for rule in all_rules]
    texts.extend(kernel.terms.values())
    texts.extend(gate.objective for gate in kernel.gates)
    texts.extend(protocol.objective for protocol in kernel.protocols)
    for reference in sorted({match for text in texts for match in REFERENCE.findall(text)}):
        if reference not in symbols:
            errors.append(f"unresolved reference: @{reference}")

    if [rule.id for rule in kernel.shared_rules].count("ROOT_OF_TRUTH") != 1:
        errors.append("ROOT_OF_TRUTH must have exactly one canonical definition")
    if not kernel.utf8_budget or kernel.utf8_budget > 65_000:
        errors.append("UTF-8 budget must be explicit and no greater than 65000 bytes")
    from .dedup import find_unapproved_semantic_overlaps

    errors.extend(f"unapproved semantic overlap: {overlap}" for overlap in find_unapproved_semantic_overlaps(kernel))
    return sorted(set(errors))


def _validate_sv_contract(contract: SemanticVectorContract) -> list[str]:
    errors: list[str] = []
    if contract.tag != "SV_FORMAT":
        errors.append("sv_contract tag must be SV_FORMAT")
    if contract.keyword_min != 3 or contract.keyword_max != 9:
        errors.append("sv_contract must require 3-9 unique keywords")
    if abs(contract.weight_sum - 1.0) > 1e-9:
        errors.append("sv_contract weights must sum to 1.0")
    if contract.digest_fields != EXPECTED_SV_DIGEST:
        errors.append("sv_contract digest chain must be md5, prev-md5, parent-goal-md5")
    if contract.first_prev_md5 != "0" * 32:
        errors.append("sv_contract first prev-md5 must be 32 zeros")
    if "acknowledged" not in contract.trivial_emission:
        errors.append("sv_contract must define a trivial emission")
    return errors


def _validate_source_routing(contract: SourceRoutingContract) -> list[str]:
    from .source import LEGACY_DOMAIN_DISCIPLINES

    errors: list[str] = []
    if contract.tag != "SOURCE_ROUTING":
        errors.append("source_routing tag must be SOURCE_ROUTING")
    if contract.alias != "DOMAIN_SOURCES":
        errors.append("source_routing alias must remain DOMAIN_SOURCES")
    statuses = tuple(status for _, status in contract.ladder)
    if statuses != EXPECTED_EVIDENCE_STATUSES:
        errors.append(f"source_routing ladder must cover {EXPECTED_EVIDENCE_STATUSES}, got {statuses}")
    if "Inferred" not in contract.generic_web_rule or "source_stamp" not in contract.generic_web_rule:
        errors.append("generic web must not reach Inferred without source_stamp")
    disciplines = [route.discipline for route in contract.routes]
    for duplicate in _duplicates(disciplines):
        errors.append(f"duplicate source-routing discipline: {duplicate}")
    missing_legacy = [name for name in LEGACY_DOMAIN_DISCIPLINES if name not in set(disciplines)]
    if missing_legacy:
        errors.append(f"source_routing missing legacy disciplines: {missing_legacy}")
    for route in contract.routes:
        if not route.primary:
            errors.append(f"{route.discipline} has no primary authority route")
        if route.constraint_class not in contract.classes:
            errors.append(f"{route.discipline} references unknown constraint class {route.constraint_class}")
    for class_name in contract.classes:
        if not any(route.constraint_class == class_name for route in contract.routes):
            errors.append(f"constraint class {class_name} has no routes")
    return errors
