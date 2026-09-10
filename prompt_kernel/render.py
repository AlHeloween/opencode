from __future__ import annotations

import hashlib

from .addons import GATE_ADDONS, addon_lines_by_gate, validate_addons
from .compatibility import CONTRACT_PINNED_RULES
from .model import Gate, Kernel, Protocol, Rule, SemanticVectorContract, SourceRoutingContract
from .validate import REFERENCE, validate_kernel


def _list(values: tuple[str, ...], refs: bool = False) -> str:
    return "[" + ", ".join(f"@{value}" if refs else value for value in values) + "]"


def _render_named_rule(rule: Rule) -> list[str]:
    return [f"#### @{rule.id}", rule.text, ""]


def _named_rule_ids(kernel: Kernel) -> set[str]:
    """A rule earns a name only when something references it; shared law stays named."""
    named = {rule.id for rule in kernel.shared_rules}
    named.update(rule_id for gate in kernel.gates for rule_id in gate.shared_rules)
    named.update(CONTRACT_PINNED_RULES)
    texts = [rule.text for rule in kernel.shared_rules]
    for gate in kernel.gates:
        texts.extend(rule.text for rule in gate.local_rules)
    for protocol in kernel.protocols:
        texts.extend(rule.text for rule in protocol.local_rules)
    texts.extend(kernel.terms.values())
    for text in texts:
        named.update(REFERENCE.findall(text))
    rule_ids = {rule.id for rule in kernel.shared_rules}
    rule_ids.update(rule.id for gate in kernel.gates for rule in gate.local_rules)
    rule_ids.update(rule.id for protocol in kernel.protocols for rule in protocol.local_rules)
    return named & rule_ids


def _render_rules_block(
    owner_id: str,
    rules: tuple[Rule, ...],
    addon_lines: tuple[str, ...],
    named: set[str],
) -> list[str]:
    lines = [f"<{owner_id}_RULES>"]
    for rule in rules:
        if rule.id in named:
            lines.extend(_render_named_rule(rule))
        else:
            lines.append(f"- {rule.text}")
    lines.extend(f"- {line}" for line in addon_lines)
    lines.append(f"</{owner_id}_RULES>")
    lines.append("")
    return lines


def _render_gate(kernel: Kernel, gate: Gate, addon_lines: tuple[str, ...], named: set[str]) -> list[str]:
    lines = [
        f"### {gate.id} {gate.name}",
        f"objective: {gate.objective}",
        f"identity: {_list(gate.identities)}",
        f"requires: {_list(gate.requires)}",
        f"shared_rules: {_list(gate.shared_rules, refs=True)}",
    ]
    lines.extend(_render_rules_block(gate.id, gate.local_rules, addon_lines, named))
    lines.append(f"outputs: {_list(gate.outputs)}")
    lines.append(f"routes: WORKFLOW.{gate.id}")
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


def _render_protocol(protocol: Protocol, named: set[str]) -> list[str]:
    lines = [
        f"### {protocol.id}",
        f"objective: {protocol.objective}",
        f"authority: {protocol.authority}; cannot authorize mutation or promote claims",
        f"observed_at: {_list(protocol.observed_at)}",
        f"returns_to: {protocol.returns_to}",
    ]
    lines.extend(_render_rules_block(protocol.id, protocol.local_rules, (), named))
    return lines


def render_kernel(kernel: Kernel | None = None, addons: tuple | None = None) -> str:
    if kernel is None:
        from .source import KERNEL

        kernel = KERNEL
    if addons is None:
        addons = GATE_ADDONS
    errors = validate_kernel(kernel)
    if errors:
        raise ValueError("invalid kernel:\n- " + "\n- ".join(errors))
    addon_errors = validate_addons(addons)
    if addon_errors:
        raise ValueError("invalid gate addons:\n- " + "\n- ".join(addon_errors))
    addon_map = addon_lines_by_gate(addons)
    named = _named_rule_ids(kernel)

    lines = [
        # First line MUST be >= 19 bytes: Bun compile's asset sniffer turns .txt
        # with a shorter first line into a BunFS file-asset (path stub) instead
        # of inlining the text — proven by byte-probe bisect (18->fail, 19->ok).
        "## 0. WORKFLOW — gated execution protocol",
        "",
        "gates:",
    ]
    for gate in kernel.gates:
        lines.append(f"- {gate.id}: {gate.name}")
    for terminal in kernel.terminals:
        lines.append(f"- {terminal}: terminal")
    lines.extend([
        "forward_move:",
    ])
    forward_edges = [e for e in kernel.edges if e.kind == "forward"]
    for edge in forward_edges:
        lines.append(f"- {edge.source} -> {edge.target} : {edge.condition}")
    concern_edges = [e for e in kernel.edges if e.kind == "side"]
    for edge in concern_edges:
        lines.append(f"CONCERN: {edge.source} -> {edge.target} : {edge.condition}")
    lines.extend([
        "back_move:",
    ])
    back_edges = [e for e in kernel.edges if e.kind == "back"]
    for edge in back_edges:
        lines.append(f"- {edge.source} -> {edge.target} : {edge.condition}")
    lines.extend([
        "terminal:",
    ])
    terminal_edges = [e for e in kernel.edges if e.kind == "terminal"]
    for edge in terminal_edges:
        lines.append(f"- {edge.source} -> {edge.target}; when: {edge.condition}")
    lines.append("side_protocols:")
    for protocol in kernel.protocols:
        lines.append(f"- {protocol.id}: observe {_list(protocol.observed_at)} -> {protocol.returns_to}; authority={protocol.authority}")

    lines.extend([
        "",
        "## 1. ABI_AND_VOCABULARY",
        "",
        f"precedence: {' > '.join(kernel.precedence)}",
        "reference_grammar: an at-prefixed uppercase identifier refers to the single declared node, state, term, rule, protocol, action class, identity, contract, or terminal of that name.",
        "control_flow_rule: gated_workflow is the success path; every deviation must use a declared move, concern or terminal.",
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
        lines.extend(_render_named_rule(rule))

    lines.extend(["## 3. GATE_REFINEMENT", ""])
    for gate in kernel.gates:
        lines.extend(_render_gate(kernel, gate, addon_map.get(gate.id, ()), named))

    lines.extend(["## 4. CROSS_CUTTING_PROTOCOLS", ""])
    for protocol in kernel.protocols:
        lines.extend(_render_protocol(protocol, named))

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


def render_review(kernel: Kernel | None = None, addons: tuple | None = None) -> str:
    if kernel is None:
        from .source import KERNEL

        kernel = KERNEL
    return "---\ndescription: map-first reasoning kernel candidate\nalwaysApply: true\n---\n\n" + render_kernel(kernel, addons)


def kernel_digest(kernel: Kernel | None = None, addons: tuple | None = None) -> str:
    if kernel is None:
        from .source import KERNEL

        kernel = KERNEL
    return hashlib.sha256(render_kernel(kernel, addons).encode("utf-8")).hexdigest()
