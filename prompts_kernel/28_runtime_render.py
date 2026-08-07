"""Kernel fragment: 28_runtime_render (former monofile L2995-3254)."""


def render_runtime_kernel(tier: str = "A") -> str:
    """Render the deterministic model-facing Pythonic keyword dictionary.

    tier:
      A — identity prefix (dictionary + agent/policy SPECS). Default for runtime.
      full — include command SPECS too (debug / offline docs only).
    """
    lines: list[str] = []
    for name, values in (
        ("PROMPT_ABI", PROMPT_ABI),
        ("TERMS", RUNTIME_TERMS),
        ("RULES", RUNTIME_RULES),
    ):
        cats = RUNTIME_RULE_CATEGORIES if name == "RULES" else None
        lines.extend(_render_runtime_mapping(name, values, cats))
        lines.append("")
    lines.append(render_all_specs(tier=tier))
    text = "\n".join(lines)
    max_bytes = 59_000  # kernel budget — CI gate
    if tier == "A" and len(text.encode("utf-8")) > max_bytes:
        raise ValueError(
            f"Tier A identity kernel is {len(text.encode('utf-8'))} bytes "
            f"(budget {max_bytes}). Slim SPECS or dictionary before shipping.",
        )
    return text


def runtime_kernel_digest(tier: str = "A") -> str:
    """Return the stable SHA256 digest of the generated runtime kernel."""
    return hashlib.sha256(render_runtime_kernel(tier=tier).encode("utf-8")).hexdigest()


def normalize_runtime_rule(value: str) -> str:
    """Normalize rule text for deterministic duplicate detection."""
    return " ".join("".join(char if char.isalnum() else " " for char in value.casefold()).split())


def find_normalized_runtime_rule_duplicates(
    rules: Mapping[str, str], aliases: Mapping[str, str],
) -> list[tuple[str, tuple[str, ...]]]:
    """Return duplicate rule groups that lack explicit aliases to one canonical ID."""
    grouped: dict[str, list[str]] = {}
    for rule_id, value in rules.items():
        grouped.setdefault(normalize_runtime_rule(value), []).append(rule_id)

    duplicates: list[tuple[str, tuple[str, ...]]] = []
    for normalized, rule_ids in grouped.items():
        if len(rule_ids) < 2:
            continue
        canonical_ids = [rule_id for rule_id in rule_ids if rule_id not in aliases]
        if len(canonical_ids) != 1:
            duplicates.append((normalized, tuple(sorted(rule_ids))))
            continue
        canonical = canonical_ids[0]
        if all(rule_id == canonical or aliases.get(rule_id) == canonical for rule_id in rule_ids):
            continue
        duplicates.append((normalized, tuple(sorted(rule_ids))))
    return sorted(duplicates)


def validate_runtime_references(
    terms: Mapping[str, str],
    rules: Mapping[str, str],
    contracts: Mapping[str, tuple[str, ...]],
    packs: Mapping[str, tuple[str, ...]],
) -> list[str]:
    """Return deterministic errors for unresolved runtime declarations."""
    errors: list[str] = []
    declarations = set(terms) | set(rules)
    if len(declarations) != len(terms) + len(rules):
        errors.append("term and rule identifiers must be disjoint")

    referenced_declarations: set[str] = set()
    for contract, references in contracts.items():
        seen: set[str] = set()
        for reference in references:
            if reference in seen:
                errors.append(f"contract {contract!r} references {reference!r} more than once")
            seen.add(reference)
            if reference not in declarations:
                errors.append(f"contract {contract!r} references unknown rule {reference!r}")
                continue
            referenced_declarations.add(reference)

    for pack, references in packs.items():
        seen: set[str] = set()
        for reference in references:
            if reference in seen:
                errors.append(f"pack {pack!r} references {reference!r} more than once")
            seen.add(reference)
            if reference not in declarations and reference not in contracts and reference not in packs:
                errors.append(f"pack {pack!r} references unknown declaration, contract, or pack {reference!r}")
                continue
            if reference in declarations:
                referenced_declarations.add(reference)
            if reference == pack:
                errors.append(f"pack {pack!r} cannot reference itself")

    return sorted(errors)


def validate_runtime_contracts(
    contracts: Mapping[str, tuple[str, ...]],
    contract_ids: Mapping[str, str],
    spec_names: set[str],
    terms: Mapping[str, str],
    rules: Mapping[str, str],
) -> list[str]:
    """Return deterministic errors for runtime contract ownership and references."""
    errors: list[str] = []
    declarations = set(terms) | set(rules)
    if set(contract_ids) != spec_names:
        errors.append("every canonical spec must have exactly one runtime contract ID")
    if len(set(contract_ids.values())) != len(contract_ids):
        errors.append("runtime contract IDs must be unique")
    if set(contract_ids.values()) != set(contracts):
        errors.append("runtime contracts must match canonical spec contract IDs")

    for contract, references in contracts.items():
        seen: set[str] = set()
        for reference in references:
            if reference in seen:
                errors.append(f"contract {contract!r} references {reference!r} more than once")
            seen.add(reference)
            if reference not in declarations:
                errors.append(f"contract {contract!r} references unknown declaration {reference!r}")
    return sorted(errors)


def validate_runtime_rule_owners(
    rules: Mapping[str, str], owners: Mapping[str, str], terms: Mapping[str, str],
) -> list[str]:
    """Return deterministic errors when rule ownership is incomplete or invalid."""
    errors: list[str] = []
    if set(owners) != set(rules):
        errors.append("every runtime rule must have exactly one owner")
    for rule, owner in owners.items():
        if owner not in terms:
            errors.append(f"rule {rule!r} has unknown term owner {owner!r}")
    return sorted(errors)


def validate_runtime_pack_hierarchy(packs: Mapping[str, tuple[str, ...]]) -> list[str]:
    """Return deterministic errors for cycles in parented runtime packs."""
    errors: set[str] = set()

    def visit(pack: str, path: tuple[str, ...]) -> None:
        for reference in packs[pack]:
            if reference not in packs:
                continue
            if reference in path:
                errors.add(f"pack hierarchy cycle: {' -> '.join(path + (reference,))}")
                continue
            visit(reference, path + (reference,))

    for pack in packs:
        visit(pack, (pack,))
    return sorted(errors)


def find_duplicate_mapping_keys(source: str) -> list[tuple[int, str]]:
    """Return literal duplicate string keys from Python dictionary expressions."""
    duplicates: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Dict):
            continue
        seen: set[str] = set()
        for key in node.keys:
            if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
                continue
            if key.value in seen:
                duplicates.append((key.lineno, key.value))
            seen.add(key.value)
    return duplicates


def write_runtime_kernel(destination: str | Path, tier: str = "A") -> None:
    """Write deterministic runtime identity output with LF endings (default Tier A)."""
    Path(destination).write_text(render_runtime_kernel(tier=tier), encoding="utf-8", newline="\n")


# ======================================================================
# SELF-TEST
# ======================================================================

_ALL_SPECS = {
    "CODER": CODER, "EXPLORER": EXPLORER, "ORCHESTRATOR": ORCHESTRATOR,
    "GENERAL": GENERAL, "RESEARCHER": RESEARCHER, "MEDIA": MEDIA,
    "TITLE": TITLE, "SUMMARY": SUMMARY,
    "COMMIT": COMMIT, "LEARN": LEARN, "CHANGELOG": CHANGELOG,
    "ISSUES": ISSUES, "TRANSLATE": TRANSLATE, "RMSLOP": RMSLOP,
    "AI_DEPS": AI_DEPS, "SPELLCHECK": SPELLCHECK,
    "DUPLICATE_PR": DUPLICATE_PR, "TRIAGE": TRIAGE,
    "ADID_FRAMEWORK_RULES": ADID_FRAMEWORK_RULES,
    "ADID_OPS": ADID_OPS,
    "AGENT_DIRECTIVES": AGENT_DIRECTIVES,
    "GOVERNANCE": GOVERNANCE,
    "DEFAULT_PROMPT": DEFAULT_PROMPT,
    "GROUNDING_RULES": GROUNDING_RULES,
    "PLANNING": PLANNING,
    "REASONING_MODE": REASONING_MODE,
}

def render_all_specs(tier: str = "A") -> str:
    """    Render _spec() blocks as compact text.

    Tier A (identity): agents + policies only.
    Tier full: also commands (available as command surfaces; not default identity).
    """
    lines: list[str] = []

    agents = {k: v for k, v in _ALL_SPECS.items() if k in _TIER_A_AGENTS}
    commands = {k: v for k, v in _ALL_SPECS.items() if k in _TIER_B_COMMANDS}
    policies = {k: v for k, v in _ALL_SPECS.items() if k in _TIER_A_POLICIES}
    # Any leftover specs still render under policies in full tier
    known = _TIER_A_AGENTS | _TIER_B_COMMANDS | _TIER_A_POLICIES
    extras = {k: v for k, v in _ALL_SPECS.items() if k not in known}
    if extras and tier == "full":
        policies = {**policies, **extras}

    sections: list[tuple[str, dict]] = [
        ("Agent Specs", agents),
        ("Policy Specs", policies),
    ]
    if tier == "full":
        sections.extend([
            ("Command Specs (Tier B)", commands),
        ])
    else:
        lines.append("# Tier B (commands) live on command surfaces — not identity.")
        lines.append("")

    for section, group in sections:
        if not group:
            continue
        lines.append(f"## {section}")
        lines.append("")
        for name in sorted(group):
            lines.extend(_render_spec_block(name, group[name]))

    return "\n".join(lines)
