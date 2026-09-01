from __future__ import annotations

import hashlib

from .model import Gate, Kernel, Protocol, Rule, SemanticVectorContract, SourceRoutingContract
from .validate import validate_kernel


def _list(values: tuple[str, ...], refs: bool = False) -> str:
    return "[" + ", ".join(f"@{value}" if refs else value for value in values) + "]"


def _render_rule(rule: Rule) -> list[str]:
    return [f"#### @{rule.id}", f"rule: {rule.text}", ""]


def _render_gate(kernel: Kernel, gate: Gate) -> list[str]:
    lines = [
        f"### {gate.id} {gate.name}",
        f"objective: {gate.objective}",
        f"identity: {_list(gate.identities)}",
        f"requires: {_list(gate.requires)}",
        f"shared_rules: {_list(gate.shared_rules, refs=True)}",
        "local_definitions:",
    ]
    for rule in gate.local_rules:
        lines.extend(_render_rule(rule))
    lines.append(f"outputs: {_list(gate.outputs)}")
    lines.append(f"routes: KERNEL_MAP.{gate.id}")
    lines.append("")
    return lines


def _render_sv_contract(contract: SemanticVectorContract) -> list[str]:
    return [
        f"1.2 @{contract.tag}:",
        "```yaml",
        "Keywords: topic1 0.35, topic2 0.25, topic3 0.20, topic4 0.12, topic5 0.08",
        "Semantic dominant: One-line focus of this vector.",
        "md5: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
        f"prev-md5: {contract.first_prev_md5}",
        f"parent-goal-md5: {contract.first_prev_md5}",
        "```",
        f"- Keywords: {contract.keyword_min}-{contract.keyword_max} unique terms; weights>0; sum={contract.weight_sum}; highest first",
        "- Semantic dominant: one sentence of this vector's focus",
        "- md5: 32 hex of canonical keywords+weights+dominant",
        f"- prev-md5: previous md5 or {contract.first_prev_md5}",
        f"- parent-goal-md5: child vector to parent goal; {contract.first_prev_md5} if none",
        f"- trivial: {contract.trivial_emission}",
        "- invariant: a semantic vector is an attention fingerprint, never a claim status",
        "",
    ]


def _render_source_routing(contract: SourceRoutingContract) -> list[str]:
    lines = [
        f"1.3 @{contract.tag}:",
        f"alias: @{contract.alias}",
        "statuses: @INFORMATION_STATUS",
        "ladder:",
    ]
    for condition, status in contract.ladder:
        lines.append(f"- {condition} -> {status}")
    lines.append(f"generic_web: {contract.generic_web_rule}")
    lines.append("classes:")
    for name, text in contract.classes.items():
        lines.append(f"- {name}: {text}")
    lines.append("routes:")
    grouped: dict[str, list] = {name: [] for name in contract.classes}
    for route in contract.routes:
        grouped.setdefault(route.constraint_class, []).append(route)
    for class_name, routes in grouped.items():
        if not routes:
            continue
        lines.append(f"{class_name}:")
        for route in routes:
            lines.append(
                f"- {route.discipline}: primary={','.join(route.primary)}; secondary={','.join(route.secondary)}"
            )
    lines.append("")
    return lines


def _render_protocol(protocol: Protocol) -> list[str]:
    lines = [
        f"### {protocol.id}",
        f"objective: {protocol.objective}",
        f"authority: {protocol.authority}; cannot authorize mutation or promote claims",
        f"observed_at: {_list(protocol.observed_at)}",
        f"returns_to: {protocol.returns_to}",
        "local_definitions:",
    ]
    for rule in protocol.local_rules:
        lines.extend(_render_rule(rule))
    return lines


def render_kernel(kernel: Kernel | None = None) -> str:
    if kernel is None:
        from .source import KERNEL

        kernel = KERNEL
    errors = validate_kernel(kernel)
    if errors:
        raise ValueError("invalid kernel:\n- " + "\n- ".join(errors))

    lines = [
        "## 0. KERNEL_MAP",
        "",
        f"kernel: {kernel.name}",
        f"version: {kernel.version}",
        "entry: G1",
        "nodes:",
    ]
    for gate in kernel.gates:
        lines.append(f"- {gate.id}: {gate.name}")
    for terminal in kernel.terminals:
        lines.append(f"- {terminal}: terminal")
    lines.extend([
        f"canonical_spine: {' -> '.join(kernel.spine)}",
        "declared_edges:",
    ])
    for edge in kernel.edges:
        lines.append(f"- {edge.kind}: {edge.source} -> {edge.target}; when: {edge.condition}")
    lines.append("side_protocols:")
    for protocol in kernel.protocols:
        lines.append(f"- {protocol.id}: observe {_list(protocol.observed_at)} -> {protocol.returns_to}; authority={protocol.authority}")

    lines.extend([
        "",
        "## 1. ABI_AND_VOCABULARY",
        "",
        f"precedence: {' > '.join(kernel.precedence)}",
        "reference_grammar: an at-prefixed uppercase identifier refers to the single declared node, state, term, rule, protocol, action class, identity, contract, or terminal of that name.",
        "control_flow_rule: canonical_spine is the success path; every deviation must use a declared side, back, or terminal edge.",
        "terms:",
    ])
    for name, description in kernel.terms.items():
        lines.append(f"- {name}: {description}")
    lines.extend([
        "1.1 @INFOMARK",
        "Guess -> (web hit) Hypothetical -> (authority|code) Inferred -> (smoke/PoC PASS) Exact",
        "failed proof -> Unknown; simulation never equals reality",
        "promotion: @INFORMATION_STATUS",
        "",
    ])
    lines.extend(_render_sv_contract(kernel.sv_contract))
    lines.extend(_render_source_routing(kernel.source_routing))
    lines.append("1.4 state_contract:")
    for name, description in kernel.state_fields.items():
        lines.append(f"- {name}: {description}")
    lines.append("1.5 action_classes:")
    for name, description in kernel.action_classes.items():
        lines.append(f"- {name}: {description}")

    lines.extend(["", "## 2. SHARED_RULES", ""])
    for rule in kernel.shared_rules:
        lines.extend(_render_rule(rule))

    lines.extend(["## 3. GATE_REFINEMENT", ""])
    for gate in kernel.gates:
        lines.extend(_render_gate(kernel, gate))

    lines.extend(["## 4. CROSS_CUTTING_PROTOCOLS", ""])
    for protocol in kernel.protocols:
        lines.extend(_render_protocol(protocol))

    lines.extend([
        "## 5. IDENTITY_CONTRACTS",
        "",
        "authority: runtime ACL and G4 envelope remain authoritative for every identity. Uncertain identity → getmode.",
        "",
    ])
    for identity in kernel.identities:
        lines.extend([
            f"### {identity.id}",
            f"kind: {identity.kind}",
            f"scope: {identity.scope}",
            f"gates: {_list(identity.gates)}",
            f"may_mutate: {'true' if identity.may_mutate else 'false'}",
            "",
        ])
    return "\n".join(lines).rstrip() + "\n"


def render_review(kernel: Kernel | None = None) -> str:
    if kernel is None:
        from .source import KERNEL

        kernel = KERNEL
    return "---\ndescription: map-first reasoning kernel candidate\nalwaysApply: true\n---\n\n" + render_kernel(kernel)


def kernel_digest(kernel: Kernel | None = None) -> str:
    if kernel is None:
        from .source import KERNEL

        kernel = KERNEL
    return hashlib.sha256(render_kernel(kernel).encode("utf-8")).hexdigest()
