"""Kernel fragment: 28_runtime_render (former monofile L2995-3254)."""

def render_runtime_kernel(tier: str = "A") -> str:
    """Render the deterministic model-facing Pythonic keyword dictionary.

    tier:
      A — identity prefix (dictionary + agent/policy SPECS). Default for runtime.
      full — include command SPECS too (debug / offline docs only).
    """
    lines = [
        "# Generated from opencode_prompts_kernel.py; do not edit directly.",
        "# Runtime prompt ABI: compact Pythonic declarations for model retrieval.",
        f"# identity_tier={tier}  (A=agents+policies; full=+commands)",
        "from types import MappingProxyType",
        "",
    ]
    for name, values in (
        ("PROMPT_ABI", PROMPT_ABI),
        ("TERMS", RUNTIME_TERMS),
        ("RULES", RUNTIME_RULES),
        ("WORKFLOWS", RUNTIME_WORKFLOWS),
        ("PACKS", RUNTIME_PACKS),
        ("CONTRACTS", RUNTIME_CONTRACTS),
    ):
        lines.extend(_render_runtime_mapping(name, values))
        lines.append("")
    lines.append(render_all_specs(tier=tier))
    text = "\n".join(lines)
    max_bytes = int(PROMPT_ABI.get("identity_max_bytes", 48_000))
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
    workflows: Mapping[str, tuple[str, ...]],
    packs: Mapping[str, tuple[str, ...]],
) -> list[str]:
    """Return deterministic errors for unresolved runtime declarations."""
    errors: list[str] = []
    declarations = set(terms) | set(rules)
    if len(declarations) != len(terms) + len(rules):
        errors.append("term and rule identifiers must be disjoint")

    referenced_declarations: set[str] = set()
    referenced_workflows: set[str] = set()
    for workflow, references in workflows.items():
        seen: set[str] = set()
        for reference in references:
            if reference in seen:
                errors.append(f"workflow {workflow!r} references {reference!r} more than once")
            seen.add(reference)
            if reference not in declarations:
                errors.append(f"workflow {workflow!r} references unknown declaration {reference!r}")
                continue
            referenced_declarations.add(reference)

    for pack, references in packs.items():
        seen: set[str] = set()
        for reference in references:
            if reference in seen:
                errors.append(f"pack {pack!r} references {reference!r} more than once")
            seen.add(reference)
            if reference not in declarations and reference not in workflows and reference not in packs:
                errors.append(f"pack {pack!r} references unknown declaration, workflow, or pack {reference!r}")
                continue
            if reference in declarations:
                referenced_declarations.add(reference)
            if reference in workflows:
                referenced_workflows.add(reference)
            if reference == pack:
                errors.append(f"pack {pack!r} cannot reference itself")

    for declaration in declarations:
        if declaration not in referenced_declarations:
            errors.append(f"declaration {declaration!r} is not reachable from a workflow or pack")
    for workflow in workflows:
        if workflow not in referenced_workflows:
            errors.append(f"workflow {workflow!r} is not reachable from a pack")
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
    "CODING_AGENT_DIRECTIVES": CODING_AGENT_DIRECTIVES,
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
    lines: list[str] = ["# SPECS", f"# tier={tier}", ""]

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
        lines.append(f"--- {section} ---")
        lines.append("")
        for name in sorted(group):
            lines.extend(_render_spec_block(name, group[name]))

    return "\n".join(lines)


def render_algorithm_card() -> str:
    """Generate ALGORITHM_CARD — fractal task geometry pseudocode.

    Single source of truth: kernel symbols auto-listed.
    The card is a reminder of the pipeline, not a specification.
    """
    lines = [
        "# ALGORITHM_CARD — task geometry (routes, not essay)",
        "# Canonical code: opencode_prompts_kernel package",
        "#   PLANNING, DECOMPOSE, REUSE.BEFORE, SMOKE.BEFORE",
        "#   k_medoids_modifications, select_fractal_model",
        "#   select_medoids_tasks, lsystem_rewrite, run_task_geometry (pipeline)",
        "# Cut evaluation area: over-generate lattice → keep medoids only. Never evaluate infinity.",
        "# NO Mode 1 / linear shortcut — soft step lists without lattice+k-medoids are forbidden.",
        "",
        "```python",
        "# Bound symbols (read kernel if unsure — do not invent alternate pipelines)",
        "from opencode_prompts_kernel import (  # normative names; runtime is this process + tools",
        "    select_fractal_model,   # Sierpinski | Quad/Oct-tree | L-System",
        "    k_medoids_modifications,",
        "    select_medoids_tasks,   # clause-level cut; k = ceil(N/2)",
        "    lsystem_rewrite,        # F→F+F-F lattice grammar",
        "    PLANNING,               # policy.planning SPEC — fractal_only",
        ")",
        "",
        "def run_task_geometry(goal: str, signals: list) -> list[str]:",
        '    """Finite work set for complex work (3+ steps).',
        "",
        "    Hard rule: CENTRAL_TASKS = medoids only. Candidate foam is not the work list.",
        "    No linear Mode-1 path — always lattice → filter → medoids.",
        '    """',
        "",
        "    # 1. ground — Exact before invent (SEARCH.ORDER / REUSE.BEFORE)",
        "    evidence = ground(goal)  # tools: codegraph, messagesearch, universalsearch, …",
        "",
        "    # 2. seeds — meaning-true goal slices (not the full work list)",
        "    seeds = goal_seeds(goal, evidence)  # short Exact-aligned clauses; ground k-medoids",
        "",
        "    # 3. fractal over-generate — same recursive motif every level (no ad-hoc essay)",
        "    model = select_fractal_model(peaks=goal_peaks(goal, evidence), delta_v=sv_delta())",
        "    # >=3 peaks → Sierpinski; 2/4/8 orthogonal → Quad/Oct-tree; else L-System F→F+F-F",
        "    candidates = fractal_over_generate(model, seeds, depth=2)  # L2–L4 lattice, not monolith",
        "",
        "    # 4. L1 filter (Manhattan) — lattice-aware; cosine would walk through holes",
        "    candidates = l1_filter(candidates, goal_sv=goal, tau=0.5)",
        "",
        "    # 5. select_medoids — seeds as cluster centers; middle-ring only; foam dies",
        "    #    k = ceil(N/2); Manhattan (L1); k_medoids_modifications for file-level plans",
        "    central_tasks = select_medoids_tasks(candidates, seeds=seeds)  # FINITE set",
        "",
        "    # 6. todowrite — one in_progress; CENTRAL_TASKS = medoids",
        "    todowrite(central_tasks)  # tool: todowrite | TodoWrite",
        "",
        "    # 7. execute — one medoid; REUSE.BEFORE + SMOKE.BEFORE (baseline Exact first)",
        "    for task in central_tasks:  # one in_progress at a time (PLANNING invariant)",
        "        execute_medoid(task)",
        "",
        "    # 8. verify — post-impl smoke / oracle [Exact]",
        "    verify_oracles()",
        "",
        "    # 9. emit_state — SV + InfoMark; residual re-enters fractal vs original Goal SV only",
        "    return emit_state(goal_sv=goal)  # never re-fractal the whole universe; no Mode-1 fallthrough",
        "```",
        "",
        "# Trivial exception (1-line / rename / typo with codegraph evidence): skip full card; still tag Exact.",
        "# Complex tasks (3+ steps): run the card. Linear \"1) 2) 3)\" without medoid cut = policy violation.",
    ]
    return "\n".join(lines) + "\n"


def write_algorithm_card(destination: str | Path) -> None:
    """Write algorithm_card.txt with LF endings."""
    Path(destination).write_text(render_algorithm_card(), encoding="utf-8", newline="\n")


