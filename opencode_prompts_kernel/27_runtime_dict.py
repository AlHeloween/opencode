"""Kernel fragment: 27_runtime_dict (former monofile L2769-2994)."""

PROMPT_ABI = MappingProxyType({
    "version": "5",
    "precedence": ("safety", "governance", "task", "domain", "style"),
    "line_endings": "LF",
    # Tier A identity: dictionary + agent/policy SPECS only (host-agnostic).
    # Host worktree surfaces are runtime-injected, never SPECS subjects
    # (see 21_skills_boundary).
    "identity_tier": "A",
    # Soft budget for model-facing identity (bytes). CI fails if exceeded.
    "identity_max_bytes": 48_000,
})

RUNTIME_TERMS = MappingProxyType({
    "adid": "ADID receivers frozen when present (no hand-edit). policy.adid_ops = product tool hygiene only (no external CLI cookbooks). SPECS/reasoning host-agnostic; host surfaces runtime-injected.",
    "cache": "System content is immutable within a session; compute fingerprints after plugin transforms.",
    "evidence": "Verified reference outranks inference; label uncertainty before claiming completion.",
    "infomark": "Claim-local status Exact|Inferred|Hypothetical|Guess|Unknown. Salience≠Evidence; parametric conf never Exact. Grounding set G=stamped Exact|Inferred only; premises_for_plan must ⊆ G or MODIFY blocked. Self-[Exact] rejected without system stamp (oracle_stamp/session-read/direct evidence). Summaries Inferred; unmarked=Unknown. Scientific promotion: Guess→Hypothetical→oracle→Exact.",
    "memory": "Active set is message* + recent s/m; full history soft-hidden in DB; recover via session-read IDs.",
    "mutation": "Modify only within authorized scope; preserve unrelated work and report remaining failure.",
    "oracle": "Declare pass/fail criteria before EXECUTION; run after materialize; PASS→Exact for that claim only; FAIL demotes; no self-certify. Executor≠Oracle≠Analyst (logical roles).",
    "plan": "ADID fractal planning only (no Mode-1 linear shortcut): ground → lattice over-generate → Manhattan (L1) filter → k-medoids → CENTRAL_TASKS=medoids → todowrite. PRE_FLIGHT: Prior art (universalsearch web/Sourcegraph) + Smoke Tests before EXECUTION. Residual vs Goal SV. State, evidence, smoke baseline, implement, verify, clean next state.",
    "scope": "Inspection and testing do not authorize unrelated repair; use governing surfaces before inference.",
    "verification": "An oracle decides correctness; do not claim fixed without direct evidence. Smoke oracles are part of verification — post-impl pass criteria from the plan Smoke Tests section. ACCEPT only after oracle PASS.",
    "hygiene": "Project hygiene: workspace lanes keep throwaway code isolated; documentation surface stays indexed; progress logs track what changed and why.",
    "metric_adaptation": "System autonomously detects gaps in evaluation metrics and generates corrective functions (e.g., silhouette score for residual_recluster, internal consistency for goal_seeds). No manual intervention required.",
})

RUNTIME_RULES = MappingProxyType({
    "EVIDENCE.ORDER": "verified > cited > inferred > unknown",
    "SEARCH.ORDER": "where/which > codegraph > messagesearch > universalsearch > glob > grep",
    "WRITE.SCOPE": "modify only within user-authorized scope",
    "VERIFY.OUTCOME": "declare oracles before execute; run pass/fail criteria after materialize; PASS→Exact for that claim only; report outcome, evidence, remaining failure; never self-certify Done",
    "INFOMARK.SEP": "Salience≠Evidence; parametric confidence≠Exact; fluency≠truth; mention frequency never promotes Exact/Inferred; claim_ledger required for non-trivial decisions; premises ⊆ G; system stamps only mint Exact",
    "REUSE.BEFORE": "research ladder: Guess → universalsearch web → code (Sourcegraph indexed git) or hybrid (prefer over agent) → declare smoke falsifier (Hypothetical) → smoke/oracle: PASS→Exact scoped stamp, FAIL→Unknown (no Done). Prefer reuse over reinvent. Trivial exception: typo/rename/one-line with codegraph. After stuck failure: web+code on error signature before new invent.",
    "SMOKE.BEFORE": "before implementation: plan must include Smoke Tests (runnable baseline commands + expected-now + post-impl pass criteria) or smoke: N/A with justification (docs/plan-only). Record baseline [Exact] before first code edit; re-run post-impl oracles before [x]. Vague 'test later' is forbidden.",
    "CACHE.STABILITY": "keep the system prefix byte-stable for the session",
    "MEMORY.RANK": "session-read Exact > summary Inferred > unaided Guess; never treat summaries as Exact",
    "MEMORY.LINKS": "every summary and message* must carry message IDs for session-read recovery",
    "ADID.FREEZE": "never hand-edit ADID framework rule receivers; change only via kernel SPECS or official ADM pipelines",
    "ADID.OPS": "prefer product tools (edit/read/codegraph/jobs/oracles); long work via product job runners; never embed external framework CLI cookbooks in SPECS (see policy.adid_ops)",
    "NO_HARDCODE": "never hardcode paths, ports, URLs, versions, or magic values — discover via where/which/codegraph/glob or read project config (e.g. package.json, opencode.json)",
    "WHERE_WHICH": "use where.exe (Windows) / which (Linux/macOS) for any executable lookup — instant, exact, PATH-aware. To discover files in a known directory, prepend the directory to PATH and re-run where/which. Never glob/grep for executables that where/which resolves in one call.",
    "FRACTAL_CANDIDATES": "generate_fractal_candidates(model, seeds, depth) dispatches fractal generation: Sierpinski (triangle subdivision for >=3 peaks), Quad/Oct (grid subdivision for 2/4/8 peaks), L-System (grammar walk, fallback for unknown models).",
    "GOAL_SEEDS": "goal_seeds(goal, evidence) extracts meaning-true goal slices: keyword extraction -> co-occurrence clustering -> seed vectors (capped at 8). Replaces manual seed selection.",
    "RESIDUAL_LOOP": "residual_recluster(state, original_goal_sv) closes the ADID loop: re-clusters pending tasks against original Goal SV using adaptive_tau at 70th percentile. Returns tasks aligned with the original goal; at least one task always survives.",
    "EMIT_STATE": "emit_state(goal_sv, completed_tasks, pending_tasks, blockers, next_step) returns a structured state dict {done, pending, blocked, next, goal_sv}. Serialised by the caller; InfoMark-stamped at Gate 9.",
    "GROUND": "ground(goal) generates an evidence-gathering plan from goal keywords: returns structured searches (web/code universalsearch), local probes (codegraph/grep), and expected evidence categories. Does NOT execute tools — agent follows the plan at Gate 1.",
    "GOAL_PEAKS": "goal_peaks(goal, evidence) counts distinct keyword clusters (peaks) in goal+evidence. Feeds select_fractal_model: 1 peak→L-System, 2→Quad-Oct binary, 3→Sierpinski, 4→Quad-Oct quad, 5-7→Sierpinski, 8→Quad-Oct oct, 9+→Sierpinski clamped.",
    "SV_DELTA": "sv_delta(current_sv, previous_sv) computes L1 semantic distance between two SV states (keyword→weight dicts). Returns float in [0,2]: <0.3→L-System (stable), >=0.3→Quad-Oct (moderate shift), >=0.6→Sierpinski (large shift). Neutral 0.5 if SV missing.",
    "SV_OUTPUT": "after every non-trivial response output sv=[k1..kn],[w1..wn sum=1.0], md5_sv_tag (consistent 8-32 hex derived from sv), Semantic dominant (one-sentence summary). Keywords 3-9, weights ordered. Change tag when keywords or weights change. Omit for trivial answers (yes/no, single-line facts, tool output relay).",
    "CLEAN_STATE": "end substantial responses with Clean next state: Done: {verified items or none}, Pending: {unfinished}, Blocked: {blockers with reason or none}, Next: {one immediate next step or none}. Use Exact evidence for Done claims. If blocked: codegraph/messagesearch then universalsearch web and/or code (Sourcegraph) before declaring blocked.",
    "DECOMPOSE": "fractal lattice before work list: over-generate (Sierpinski/Quad/L-System, adaptive_depth 1-3) → Manhattan (L1) to Goal SV → adaptive τ (percentile) → adaptive_k (CV dispersion) → k-medoids (→ CLARA sampling when N≥100, seeds ground centers) → CENTRAL_TASKS=medoids only. Never Mode-1 linear step lists for multi-step work. Same recursive motif every level (F→F+F-F), not ad-hoc essays.",
    "DOCUMENT.SURFACE": "maintain doc surface: docs/ (detailed), DOCINDEX.md (owners/entrypoints/last_verified), index.md (folder-based repo map). Update when adding or moving files.",
    "WORKSPACE.LANES": "organize by purpose: experiments/ (ad-hoc scratch), futures/ (drafts not ready), obsolete/ (deprecated refs), makeups/ (explicit stubs). Never mix throwaway with mainline.",
    "PROGRESS.LOG": "track progress: _development_plan.md (goals+tasks with [x] checks), _progress_log.md ([TIMESTAMP] activity -> script -> output), _application_workflow_diagram.md (modules->functions->I/O map). Update after each non-trivial change.",
})

# Source-only declarations for normalized duplicate detection. A rule may repeat
# only when its identifier explicitly aliases the canonical rule identifier.
RUNTIME_RULE_ALIASES = MappingProxyType({})

# One semantic owner per rule keeps the runtime dictionary navigable without
# duplicating policy prose across agents, skills, commands, or grounding specs.
RUNTIME_RULE_OWNERS = MappingProxyType({
    "CACHE.STABILITY": "cache",
    "EVIDENCE.ORDER": "evidence",
    "SEARCH.ORDER": "evidence",
    "VERIFY.OUTCOME": "oracle",
    "INFOMARK.SEP": "infomark",
    "REUSE.BEFORE": "evidence",
    "SMOKE.BEFORE": "plan",
    "WRITE.SCOPE": "mutation",
    "MEMORY.RANK": "infomark",
    "MEMORY.LINKS": "memory",
    "ADID.FREEZE": "adid",
    "ADID.OPS": "adid",
    "NO_HARDCODE": "evidence",
    "WHERE_WHICH": "evidence",
    "SV_OUTPUT": "verification",
    "CLEAN_STATE": "verification",
    "DECOMPOSE": "plan",
    "FRACTAL_CANDIDATES": "plan",
    "GOAL_SEEDS": "plan",
    "RESIDUAL_LOOP": "verification",
    "EMIT_STATE": "verification",
    "GROUND": "evidence",
    "GOAL_PEAKS": "plan",
    "SV_DELTA": "verification",
    "DOCUMENT.SURFACE": "hygiene",
    "WORKSPACE.LANES": "hygiene",
    "PROGRESS.LOG": "hygiene",
})

RUNTIME_WORKFLOWS = MappingProxyType({
    "adid": ("adid", "ADID.FREEZE", "ADID.OPS", "scope", "mutation", "verification"),
    "diagnose": (
        "scope",
        "evidence",
        "EVIDENCE.ORDER",
        "SEARCH.ORDER",
        "REUSE.BEFORE",
        "WHERE_WHICH",
        "NO_HARDCODE",
        "verification",
        "oracle",
        "VERIFY.OUTCOME",
        "INFOMARK.SEP",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "MEMORY.RANK",
    ),
    "modify": (
        "plan",
        "REUSE.BEFORE",
        "SMOKE.BEFORE",
        "scope",
        "cache",
        "mutation",
        "WRITE.SCOPE",
        "CACHE.STABILITY",
        "verification",
        "oracle",
        "VERIFY.OUTCOME",
        "INFOMARK.SEP",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "MEMORY.RANK",
    ),
    "observe": (
        "scope",
        "evidence",
        "EVIDENCE.ORDER",
        "SEARCH.ORDER",
        "WHERE_WHICH",
        "NO_HARDCODE",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "INFOMARK.SEP",
        "MEMORY.RANK",
    ),
    "hygiene": ("DOCUMENT.SURFACE", "WORKSPACE.LANES", "PROGRESS.LOG", "CLEAN_STATE", "EVIDENCE.ORDER"),
    "plan": (
        "plan",
        "DECOMPOSE",
        "GROUND",
        "metric_adaptation",
        "FRACTAL_CANDIDATES",
        "GOAL_SEEDS",
        "GOAL_PEAKS",
        "SV_DELTA",
        "RESIDUAL_LOOP",
        "EMIT_STATE",
        "REUSE.BEFORE",
        "SMOKE.BEFORE",
        "evidence",
        "scope",
        "mutation",
        "verification",
        "oracle",
        "VERIFY.OUTCOME",
        "infomark",
        "INFOMARK.SEP",
        "MEMORY.RANK",
        "SV_OUTPUT",
        "CLEAN_STATE",
    ),
    "research": (
        "evidence",
        "EVIDENCE.ORDER",
        "SEARCH.ORDER",
        "REUSE.BEFORE",
        "WHERE_WHICH",
        "NO_HARDCODE",
        "verification",
        "oracle",
        "INFOMARK.SEP",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "MEMORY.RANK",
        "MEMORY.LINKS",
    ),
})

RUNTIME_PACKS = MappingProxyType({
    "agent.build": ("universal", "modify", "diagnose", "adid", "hygiene"),
    "agent.coder": ("agent.build",),

    "agent.explore": ("universal", "observe"),
    "agent.general": ("universal", "observe", "research"),
    "agent.media": ("universal", "scope", "mutation", "verification"),
    "agent.orchestrator": ("universal", "plan", "observe", "verification"),
    "agent.researcher": ("agent.general",),
    "agent.summary": ("universal", "plan", "evidence", "verification", "memory", "infomark"),
    "agent.title": ("universal", "scope"),
    "domain.biology": ("domain.natural_science",),
    "domain.chemistry": ("domain.natural_science",),
    "domain.economics": ("domain.social_science",),
    "domain.history": ("domain.social_science",),
    "domain.natural_science": ("universal", "evidence", "verification"),
    "domain.physics": ("domain.natural_science",),
    "domain.psychology": ("domain.social_science",),
    "domain.social_science": ("universal", "evidence", "verification"),
    "domain.sociology": ("domain.social_science",),
    "lang.markdown": ("universal", "scope"),
    "lang.python": ("universal", "scope", "verification"),
    "lang.typescript": ("universal", "scope", "verification"),
    "universal": ("evidence", "scope", "verification", "infomark", "memory", "MEMORY.RANK", "MEMORY.LINKS"),
})

# Source spec names are stable development identifiers. Runtime contract IDs are
# the compact model-facing vocabulary and deliberately carry no repeated prose.
SPEC_CONTRACT_IDS = MappingProxyType({
    "ADID_FRAMEWORK_RULES": "policy.adid", "ADID_OPS": "policy.adid_ops",
    "AI_DEPS": "command.ai_deps",
    "CHANGELOG": "command.changelog", "CODER": "agent.coder",
    "CODING_AGENT_DIRECTIVES": "policy.coding", "COMMIT": "command.commit",
    "DEFAULT_PROMPT": "policy.default",
    "DUPLICATE_PR": "command.duplicate_pr", "EXPLORER": "agent.explore", "GENERAL": "agent.general",
    "GOVERNANCE": "policy.governance", "GROUNDING_RULES": "policy.grounding", "ISSUES": "command.issues",
    "LEARN": "command.learn", "MEDIA": "agent.media", "ORCHESTRATOR": "agent.orchestrator",     "PLANNING": "policy.planning",
    "REASONING_MODE": "policy.reasoning", "RESEARCHER": "agent.researcher",
    "RMSLOP": "command.rmslop", "SPELLCHECK": "command.spellcheck", "SUMMARY": "agent.summary",
    "TITLE": "agent.title", "TRANSLATE": "command.translate", "TRIAGE": "command.triage",
})

RUNTIME_CONTRACTS = MappingProxyType({
    "agent.coder": ("plan", "scope", "mutation", "verification", "WRITE.SCOPE", "VERIFY.OUTCOME"),

    "agent.explore": ("scope", "evidence", "SEARCH.ORDER"),
    "agent.general": ("plan", "scope", "evidence", "verification"),
    "agent.media": ("scope", "mutation", "verification"),
    "agent.orchestrator": ("plan", "scope", "evidence", "verification"),
    "agent.researcher": ("scope", "evidence", "SEARCH.ORDER", "verification"),
    "agent.summary": ("plan", "evidence", "verification", "infomark", "memory", "MEMORY.RANK", "MEMORY.LINKS"),
    "agent.title": ("scope",),
    "command.ai_deps": ("scope", "evidence", "verification"),
    "command.changelog": ("scope", "evidence", "verification"),
    "command.commit": ("scope", "mutation", "verification", "WRITE.SCOPE"),
    "command.duplicate_pr": ("scope", "evidence", "verification"),
    "command.issues": ("scope", "evidence", "SEARCH.ORDER"),
    "command.learn": ("scope", "evidence", "verification"),
    "command.rmslop": ("scope", "mutation", "verification", "WRITE.SCOPE"),
    "command.spellcheck": ("scope", "evidence", "verification"),
    "command.translate": ("scope", "mutation", "verification", "WRITE.SCOPE"),
    "command.triage": ("scope", "evidence", "verification"),
    "policy.adid": ("scope", "evidence", "verification", "SEARCH.ORDER"),
    "policy.adid_ops": ("scope", "mutation", "verification", "WRITE.SCOPE"),
    "policy.coding": ("plan", "evidence", "verification", "EVIDENCE.ORDER", "VERIFY.OUTCOME", "SV_OUTPUT", "CLEAN_STATE"),
    "policy.default": ("scope",),
    "policy.governance": ("scope", "mutation", "verification", "WRITE.SCOPE"),
    "policy.grounding": ("evidence", "verification", "EVIDENCE.ORDER", "SEARCH.ORDER", "NO_HARDCODE"),
    "policy.planning": ("plan", "evidence", "scope", "verification"),
    "policy.reasoning": ("scope", "evidence", "verification"),
})


def _render_spec_block(name: str, spec: dict) -> list[str]:
    """Render one _spec() dict as compact human-readable text."""
    lines: list[str] = [f"## {name}"]

    intent = spec.get("intent", "")
    if intent:
        lines.append(intent.strip().replace("\n", " "))

    scope = spec.get("scope", "")
    if scope and isinstance(scope, str):
        lines.append(f"scope: {scope.strip()}")

    constraints = spec.get("constraints", {})
    if constraints:
        lines.append("constraints:")
        for k, v in constraints.items():
            lines.append(f"  {k} → {v}")

    invariants = spec.get("invariants", [])
    if invariants:
        lines.append("invariants:")
        for inv in invariants:
            lines.append(f"  • {inv}")

    forbidden = spec.get("forbidden_actions", [])
    if forbidden:
        lines.append("forbidden:")
        for f in forbidden:
            lines.append(f"  • {f}")

    tests = spec.get("acceptance_tests", [])
    if tests:
        lines.append("acceptance:")
        for t in tests:
            lines.append(f"  • {t}")

    usage = spec.get("usage", "")
    if usage:
        lines.append("")
        for line in usage.strip().split("\n"):
            lines.append(line)

    lines.append("")
    return lines


def _render_runtime_mapping(name: str, values: MappingProxyType) -> list[str]:
    lines = [f"{name} = MappingProxyType({{"]
    for key in sorted(values):
        lines.append(f"    {key!r}: {values[key]!r},")
    lines.append("})")
    return lines


# SPECS sections in the identity prefix (Tier A). Commands are Tier B
# (command surfaces) — not permanent identity weight.
_TIER_A_AGENTS = frozenset({
    "CODER", "EXPLORER", "ORCHESTRATOR", "GENERAL", "RESEARCHER",
    "MEDIA", "TITLE", "SUMMARY",
})
_TIER_A_POLICIES = frozenset({
    "ADID_FRAMEWORK_RULES", "ADID_OPS", "CODING_AGENT_DIRECTIVES", "GOVERNANCE",
    "DEFAULT_PROMPT", "GROUNDING_RULES", "PLANNING", "REASONING_MODE",
})
_TIER_B_COMMANDS = frozenset({
    "COMMIT", "LEARN", "CHANGELOG", "ISSUES", "TRANSLATE", "RMSLOP",
    "AI_DEPS", "SPELLCHECK", "DUPLICATE_PR", "TRIAGE",
})


