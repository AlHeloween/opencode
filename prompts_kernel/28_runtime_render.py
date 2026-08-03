"""Kernel fragment: 28_runtime_render (former monofile L2995-3254)."""

def render_runtime_kernel(tier: str = "A") -> str:
    """Render the deterministic model-facing Pythonic keyword dictionary.

    tier:
      A — identity prefix (dictionary + agent/policy SPECS). Default for runtime.
      full — include command SPECS too (debug / offline docs only).
    """
    lines = [
        "# Generated from prompts_kernel.py; do not edit directly.",
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
    max_bytes = int(PROMPT_ABI.get("kernel_max_bytes", 48_000))
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
    workflows: Mapping[str, tuple[str, ...]] | None = None,
) -> list[str]:
    """Return deterministic errors for runtime contract ownership and references."""
    errors: list[str] = []
    declarations = set(terms) | set(rules)
    if workflows is not None:
        declarations |= set(workflows)
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
    v6: no trivial exceptions. Full spine for all tasks. Kernel-managed task store.
    """
    lines = [
        "# ALGORITHM_CARD — task geometry (routes, not essay)",
        "# Canonical implementation: prompts_kernel.run_task_geometry",
        "# Kernel symbols: ground, goal_seeds, goal_peaks, sv_delta,",
        "#   select_fractal_model, generate_fractal_candidates,",
        "#   adaptive_tau, adaptive_k, adaptive_depth (v6: evidence_coverage),",
        "#   k_medoids_modifications (→ CLARA when N≥100),",
        "#   select_medoids_tasks (internal geometry — agent uses read_task_store),",
        "#   read_task_store, transition_task (v6.0: executable task store API),",
        "#   lsystem_rewrite, residual_recluster (v6: returns (residual, discarded)),",
        "#   execute_medoid (v6.0: returns MATERIALIZED|BLOCKED|EXECUTION_FAILED),",
        "#   verify_oracles (v6.0: immutable result — returns {passed, failed, blocked}),",
        "#   emit_state (v6: +out_of_scope, +terminal, +terminal_mode),",
        "#   delta_l1, PLANNING (fractal_only)",
        "# Spine invariant for ALL tasks — no trivial exceptions. One-character typo",
        "#   still: ground → scope → oracle → edit → verify → state.",
        "# GROUNDED PATH (v6): speed from evidence density (codegraph indexed + history Exact),",
        "#   not task size. Well-mapped territory → shallower lattice via adaptive_depth.",
        "# Task store (v6): kernel auto-materializes medoids via run_task_geometry().",
        "#   Orchestrator reads + transitions; todowrite is one interface to the store.",
        "# NO Mode 1 / linear shortcut — soft step lists without lattice+k-medoids forbidden.",
        "",
        "```python",
        "# Bound symbols — every name resolves to a kernel function (read kernel if unsure)",
        "from prompts_kernel import (",
        "    run_task_geometry,           # FULL PIPELINE: ground→seeds→fractal→filter→state",
        "                                 #   v6.0: returns task_store_id, version, goal_sv",
        "    read_task_store,             # v6.0: read medoids from authoritative store",
        "                                 #   (select_medoids_tasks is internal to geometry)",
        "    transition_task,             # v6.0: atomic status transition with version guard",
        "                                 #   returns {committed, task: {id, version, status},",
        "                                 #            store_version} — NOT True|False",
        "    execute_medoid,              # v6.0: returns MATERIALIZED|BLOCKED|EXECUTION_FAILED",
        "                                 #   (materialization — NOT Done; only Oracle promotes)",
        "    verify_oracles,              # v6.0: returns immutable {passed, failed, blocked}",
        "                                 #   (no in-place mutation — replayable contract)",
        "    emit_state,                  # structured state: {done, pending, blocked, next,",
        "                                 #   goal_sv, out_of_scope, terminal, terminal_mode}",
        "    residual_recluster,          # ADID loop closure: pending vs original Goal SV",
        "                                 #   v6: returns (residual, discarded); may both be []",
        "    PLANNING,                    # policy.planning SPEC — fractal_only",
        ")",
        "",
        "# === STEP 1–5: KERNEL PIPELINE (one call) ===",
        "# The kernel computes fractal geometry AND auto-materializes medoids",
        "# into the authoritative task store (v6.0). Agent does NOT re-derive.",
        "result = run_task_geometry(goal, evidence_texts=[...])",
        "# result = {",
        "#   task_store_id, task_store_version,         # v6.0: authoritative store handle",
        "#   goal_sv,                                    # v6.0: Goal SV for emit_state",
        "#   seeds_n, peaks, model, depth,               # fractal configuration",
        "#   candidates_n, filtered_n, tau, k_recommended, # filter + cluster params",
        "#   distances_min, distances_median, distances_max, # L1 spread",
        "#   residual_n, evidence_plan_searches, status,     # diagnostics",
        "# }",
        "goal_sv = result.goal_sv",
        "store_id = result.task_store_id",
        "store_version = result.task_store_version",
        "",
        "# === STEP 6–7: execute loop — atomic claim + materialize (v6.0) ===",
        "# REUSE_BEFORE: search prior art before inventing.",
        "# SMOKE_BEFORE: baseline oracles BEFORE first edit (record [Exact]).",
        "# v6.0: while-loop with version tracking — every outcome committed to store.",
        "#       transition_task returns {committed, task: {id, version, status}, store_version}.",
        "#       Only committed transitions are acted upon; uncommitted = version race → reload.",
        "#       Executor returns materialization status — NOT Done (only Oracle promotes).",
        "#       EXECUTION_FAILED bounded by envelope attempts_max.",
        "#       store_version propagated after EVERY transition (including Oracle).",
        "# After execution: build provisional state from fresh store snapshot, not local lists.",
        "materialized, execution_failed, blocked = [], [], []",
        "while True:",
        "    central_tasks = read_task_store(",
        "        store_id=store_id,",
        "        expected_store_version=store_version,",
        "        status=\"pending\",",
        "    )",
        "    if not central_tasks:",
        "        break",
        "",
        "    task = central_tasks[0]  # one in_progress (PLANNING invariant)",
        "",
        "    claim = transition_task(",
        "        store_id=store_id,",
        "        task_id=task.id,",
        "        expected_task_version=task.version,",
        "        from_status=\"pending\",",
        "        to_status=\"in_progress\",",
        "    )",
        "    if not claim.committed:",
        "        store_version = claim.store_version",
        "        continue",
        "    task_version = claim.task.version",
        "    store_version = claim.store_version  # v6.0: propagate after claim",
        "",
        "    status, output = execute_medoid(task)",
        "",
        "    if status == 'MATERIALIZED':",
        "        tr = transition_task(",
        "            store_id=store_id,",
        "            task_id=task.id,",
        "            expected_task_version=task_version,",
        "            from_status=\"in_progress\",",
        "            to_status=\"materialized\",",
        "        )",
        "        if tr.committed:",
        "            materialized.append(tr.task)",
        "            store_version = tr.store_version",
        "        else:",
        "            execution_failed.append(task)",
        "",
        "    elif status == 'BLOCKED':",
        "        tr = transition_task(",
        "            store_id=store_id,",
        "            task_id=task.id,",
        "            expected_task_version=task_version,",
        "            from_status=\"in_progress\",",
        "            to_status=\"blocked\",",
        "            reason=output,",
        "        )",
        "        if tr.committed:",
        "            blocked.append({'task': tr.task, 'reason': output})",
        "            store_version = tr.store_version",
        "",
        "    else:  # EXECUTION_FAILED — bounded retry",
        "        attempts = task.attempts + 1",
        "        max_attempts = envelope.approval_payload.attempts_max",
        "        target = \"blocked\" if attempts >= max_attempts else \"pending\"",
        "        tr = transition_task(",
        "            store_id=store_id,",
        "            task_id=task.id,",
        "            expected_task_version=task_version,",
        "            from_status=\"in_progress\",",
        "            to_status=target,",
        "            attempts=attempts,",
        "            failure=output,",
        "        )",
        "        if tr.committed:",
        "            if target == \"blocked\":",
        "                blocked.append({'task': tr.task, 'reason': f'failed {attempts}/{max_attempts} attempts'})",
        "            store_version = tr.store_version",
        "",
        "# Build provisional state from fresh authoritative store snapshot (v6.0):",
        "snapshot = read_task_store_latest(store_id=store_id)",
        "pending   = [t for t in snapshot if t.status == 'pending']",
        "blocked   = [t for t in snapshot if t.status == 'blocked']",
        "",
        "# === STEP 8: verify — Oracle promotes to Done (v6.0) ===",
        "verification = verify_oracles(materialized_tasks=materialized)",
        "completed, pending, blockers = [], [], []",
        "for task in verification.passed:",
        "    tr = transition_task(",
        "        store_id=store_id,",
        "        task_id=task.id,",
        "        expected_task_version=task.version,",
        "        from_status=\"materialized\",",
        "        to_status=\"done\",",
        "        oracle_stamp=verification.get_stamp(task.id),",
        "    )",
        "    if tr.committed:",
        "        completed.append(tr.task)",
        "        store_version = tr.store_version  # v6.0: propagate after every transition",
        "",
        "for task in verification.failed:",
        "    tr = transition_task(",
        "        store_id=store_id,",
        "        task_id=task.id,",
        "        expected_task_version=task.version,",
        "        from_status=\"materialized\",",
        "        to_status=\"pending\",",
        "        oracle_result=\"FAIL\",",
        "    )",
        "    if tr.committed:",
        "        pending.append(tr.task)",
        "        store_version = tr.store_version",
        "",
        "for task in verification.blocked:",
        "    tr = transition_task(",
        "        store_id=store_id,",
        "        task_id=task.id,",
        "        expected_task_version=task.version,",
        "        from_status=\"materialized\",",
        "        to_status=\"blocked\",",
        "        reason=\"oracle unavailable\",",
        "    )",
        "    if tr.committed:",
        "        blockers.append({'task': tr.task, 'reason': 'oracle unavailable'})",
        "        store_version = tr.store_version",
        "",
        "# Non-materialized (already in store from STEP 7):",
        "pending   = pending + [t for t in snapshot if t.status == 'pending']",
        "blockers  = blockers + [{'task': t, 'reason': 'blocked in execution'} for t in snapshot if t.status == 'blocked']",
        "",
        "# === STEP 9: residual first, then final state from authoritative store (v6.0) ===",
        "# Build provisional state from store snapshot, compute residual, COMMIT discarded tasks.",
        "provisional = emit_state(",
        "    goal_sv=goal_sv,",
        "    completed_tasks=completed,",
        "    pending_tasks=pending,",
        "    blockers=blockers,",
        "    next_step=None,",
        "    out_of_scope=[],",
        "    terminal=False,",
        ")",
        "residual, discarded = residual_recluster(provisional, original_goal_sv=goal_sv)",
        "",
        "# Commit discarded tasks: pending → out_of_scope",
        "for task in discarded:",
        "    tr = transition_task(",
        "        store_id=store_id,",
        "        task_id=task.id,",
        "        expected_task_version=task.version,",
        "        from_status=\"pending\",",
        "        to_status=\"out_of_scope\",",
        "        reason=\"did not pass Goal-SV residual threshold\",",
        "    )",
        "    if tr.committed:",
        "        store_version = tr.store_version  # v6.0: propagate after discard",
        "",
        "# Read authoritative final snapshot WITHOUT version guard (read-only):",
        "final_snapshot = read_task_store_latest(store_id=store_id)",
        "# Derive clean_state from authoritative store, not local lists:",
        "done_tasks      = [t for t in final_snapshot if t.status == 'done']",
        "pending_tasks   = [t for t in final_snapshot if t.status == 'pending']",
        "blocked_tasks   = [t for t in final_snapshot if t.status == 'blocked']",
        "discarded_tasks = [t for t in final_snapshot if t.status == 'out_of_scope']",
        "active_tasks    = [t for t in final_snapshot if t.status in ('in_progress', 'materialized')]",
        "",
        "# Terminal check (v6.0): blocked while any task is in_progress or materialized.",
        "# Gate 9 emission forbidden while active tasks exist.",
        "if active_tasks:",
        "    # Reconcile: stalled active tasks → blocked (lease expired or orphaned)",
        "    for task in active_tasks:",
        "        transition_task(",
        "            store_id=store_id,",
        "            task_id=task.id,",
        "            expected_task_version=task.version,",
        "            from_status=task.status,",
        "            to_status=\"blocked\",",
        "            reason=\"reconciled — active task with no worker\",",
        "        )",
        "    # Re-read after reconciliation",
        "    final_snapshot = read_task_store_latest(store_id=store_id)",
        "    pending_tasks  = [t for t in final_snapshot if t.status == 'pending']",
        "    blocked_tasks  = [t for t in final_snapshot if t.status == 'blocked']",
        "    active_tasks   = [t for t in final_snapshot if t.status in ('in_progress', 'materialized')]",
        "",
        "# Final emit_state — from authoritative store (v6.0):",
        "state = emit_state(",
        "    goal_sv=goal_sv,",
        "    completed_tasks=done_tasks,",
        "    pending_tasks=pending_tasks,",
        "    blockers=blocked_tasks,",
        "    next_step=pending_tasks[0] if pending_tasks else None,",
        "    out_of_scope=discarded_tasks,",
        "    terminal=bool(not pending_tasks and not active_tasks),",
        ")",
        "# Terminal modes (v6.0):",
        "#   terminal=True, terminal_mode=SUCCESS      — pending=[], active=[], blocked=[]",
        "#   terminal=True, terminal_mode=BLOCKED      — pending=[], active=[], blocked≠[]",
        "#   terminal=True, terminal_mode=OUT_OF_SCOPE — pending=[], active=[], out_of_scope≠[]",
        "#   terminal=False                            — pending or active non-empty, continue",
        "# Precedence: BLOCKED > OUT_OF_SCOPE > SUCCESS.",
        "# Invariant: Gate 9 emission forbidden while any task is in_progress or materialized.",
        "# Never re-fractal the whole universe; no Mode-1 fallthrough.",
        "```",
        "",
        "# Spine invariant: no trivial exceptions. Every task — even one character —",
        "# follows the full sequence. Speed from evidence density, not task size.",
        "# v6: ExecutionEnvelope pre-approves MODIFY_CANDIDATE within scope+budget.",
        "# PROMOTE_STABLE and SELF_MODIFY always require explicit user approval.",
    ]
    return "\n".join(lines) + "\n"


def write_algorithm_card(destination: str | Path) -> None:
    """Write algorithm_card.txt with LF endings."""
    Path(destination).write_text(render_algorithm_card(), encoding="utf-8", newline="\n")


