"""Kernel fragment: 27_runtime_dict (former monofile L2769-2994)."""

PROMPT_ABI = MappingProxyType({
    "version": "6",
    "precedence": ("safety", "governance", "task", "domain", "style"),
    "line_endings": "LF",
    # Tier A identity: dictionary + agent/policy SPECS only (host-agnostic).
    # Host worktree surfaces are runtime-injected, never SPECS subjects
    # (see 21_skills_boundary).
    "identity_tier": "A",
    # Soft budget for the generated kernel (bytes). CI fails if exceeded.
    # v6: raised from 48_000 → 52_000 → 53_000 → 56_000 to accommodate
    # ExecutionEnvelope, inference_stamp, intent router, orthogonality_score,
    # capability principals, canonical serialization, stamped oracle ABI,
    # task-store transition API, and envelope attestation.
    "kernel_max_bytes": 56_000,
    # Soft budget for the three-surface stable identity slot (bytes).
    # Algorithm Card + Prompt Kernel + Reasoning Protocol are loaded into
    # one stable identity slot. CI warns if exceeded; kernel_max_bytes is the hard gate.
    # v6.0: 108_000 to fit v6.0 surfaces (~100 KB) with ~8 KB operational margin.
    "stable_identity_slot_max_bytes": 108_000,
})

RUNTIME_TERMS = MappingProxyType({
    "adid": "ADID receivers frozen when present (no hand-edit). policy.adid_ops = product tool hygiene only (no external CLI cookbooks). SPECS/reasoning host-agnostic; host surfaces runtime-injected.",
    "cache": "System content is immutable within a session; compute fingerprints after plugin transforms.",
    "evidence": "Verified reference outranks inference; label uncertainty before claiming completion.",
    "infomark": "Claim-local status Exact|Inferred|Hypothetical|Guess|Unknown. Salience≠Evidence; parametric conf never Exact. Grounding set G=stamped Exact|Inferred only; premises_for_plan must ⊆ G or MODIFY blocked. Self-[Exact] rejected without system stamp (oracle_stamp/session-read/direct evidence). Summaries Inferred; unmarked=Unknown. Scientific promotion: Guess→Hypothetical→oracle→Exact.",
    "memory": "Active set is message* + recent s/m; full history soft-hidden in DB; recover via session-read IDs.",
    "mutation": "Modify only within authorized scope; preserve unrelated work and report remaining failure.",
    "oracle": "Declare pass/fail criteria before EXECUTION; run after materialize; PASS→Exact for that claim only; FAIL demotes; no self-certify. Executor≠Oracle≠Analyst (logical roles).",
    "plan": "ADID fractal planning only (no Mode-1 linear shortcut): ground → lattice over-generate → Manhattan (L1) filter → k-medoids → CENTRAL_TASKS=medoids → authoritative task store (↘ optional todowrite projection). PRE_FLIGHT: Prior art (universalsearch web/Sourcegraph) + Smoke Tests before EXECUTION. Residual vs Goal SV. State, evidence, smoke baseline, implement, verify, clean next state.",
    "scope": "Inspection and testing do not authorize unrelated repair; use governing surfaces before inference.",
    "verification": "An oracle decides correctness; do not claim fixed without direct evidence. Smoke oracles are part of verification — post-impl pass criteria from the plan Smoke Tests section. ACCEPT only after oracle PASS.",
    "hygiene": "Project hygiene: workspace lanes keep throwaway code isolated; documentation surface stays indexed; progress logs track what changed and why.",
})

RUNTIME_RULES = MappingProxyType({
    "EVIDENCE_ORDER": "verified > cited > inferred > unknown",
    "SEARCH_ORDER": "intent router (NOT linear total order — tools answer different question types): EXECUTABLE_LOCATION→where/which; CODE_STRUCTURE→codegraph→bounded read/grep; CONVERSATION_FACT→messagesearch→session-read; PUBLIC_API/VERSION→universalsearch web+code (or hybrid); HARDWARE_STATE→native diagnostics (OS/host, not tool-loop); UNKNOWN_ROOT_CAUSE→local evidence(codegraph/grep/messagesearch)→external universalsearch. Prefer structure (codegraph) over content (grep) for code questions. Hardware diagnostics ALWAYS first when system state is suspect (before tool-chain loops).",
    "WRITE_SCOPE": "modify only within user-authorized scope",
    "VERIFY_OUTCOME": "declare oracles before execute; run pass/fail criteria after materialize; PASS→Exact for that claim only; report outcome, evidence, remaining failure; never self-certify Done",
    "INFOMARK_SEP": "Salience≠Evidence; parametric confidence≠Exact; fluency≠truth; mention frequency never promotes Exact/Inferred; claim_ledger required for non-trivial decisions; premises ⊆ G; oracle_stamp mints scoped Exact; inference_stamp mints grounded Inferred (all dependencies ∈ G, derivation valid, acyclic)",
    "REUSE_BEFORE": "research ladder: Guess → universalsearch web → code (Sourcegraph indexed git) or hybrid (prefer over agent) → declare smoke falsifier (Hypothetical) → smoke/oracle: PASS→Exact scoped stamp, FAIL→Guess (hypothesis falsified, evidence remains), UNKNOWN when evidence source invalidated. Prefer reuse over reinvent. After stuck failure: web+code on error signature before new invent.",
    "SMOKE_BEFORE": "before implementation: plan must include Smoke Tests (runnable baseline commands + expected-now + post-impl pass criteria) or smoke: N/A with justification (docs/plan-only). Record baseline [Exact] before first code edit; re-run post-impl oracles before [x]. Vague 'test later' is forbidden.",
    "SMOKE_SPEC": "smoke_before_spec(task) generates a SMOKE_BEFORE template: {smoke_na, baseline[], post_checks[], blast_radius}. Agent fills in concrete runnable commands before Gate 4 approval. Blast radius inferred from task keywords.",
    "SMOKE_VALIDATE": "smoke_before_validate(spec) enforces the SMOKE_BEFORE contract: smoke_na requires justification, baseline must have ≥1 check with label+cmd+expected_exit, tolerance>0 requires tolerance_reason. Returns (is_valid, diagnostic). Gate 4 rejects invalid specs.",
    "SMOKE_VERIFY": "smoke_before_verify(state, post_outputs) compares post-impl outputs against recorded baseline: exit code + stdout hash. Returns {status: PASS|FAIL|BLOCKED|NO_BASELINE, checks[], summary}. Gate 8: only PASS promotes to Done.",
    "NAMING": "rule identifiers use UPPER_SNAKE_CASE with underscore '_' delimiter (PEP 8 convention). Dots '.' and hyphens '-' are forbidden. All rules are fully underscore-unified — no legacy dotted namespace remains. Python dict keys are case-sensitive: references in WORKFLOWS, CONTRACTS, and OWNERS must match rule keys exactly (including case). No aliases, no fuzzy matching. The exact count of rules is len(RULES) — never hardcoded in prose.",
    "CACHE_STABILITY": "keep the system prefix byte-stable for the session",
    "MEMORY_RANK": "session-read Exact > summary Inferred > unaided Guess; never treat summaries as Exact",
    "MEMORY_LINKS": "every summary and message* must carry message IDs for session-read recovery",
    "ADID_FREEZE": "never hand-edit ADID framework rule receivers; change only via kernel SPECS or official ADM pipelines",
    "ADID_OPS": "prefer product tools (edit/read/codegraph/jobs/oracles); long work via product job runners; never embed external framework CLI cookbooks in SPECS (see policy.adid_ops)",
    "NO_HARDCODE": "never hardcode paths, ports, URLs, versions, or magic values — discover via where/which/codegraph/glob or read project config (e.g. package.json, opencode.json)",
    "WHERE_WHICH": "use where.exe (Windows) / which (Linux/macOS) for any executable lookup — instant, exact, PATH-aware. To discover files in a known directory, prepend the directory to PATH and re-run where/which. Never glob/grep for executables that where/which resolves in one call.",
    "VCS_ROOT": "VCS detection: git status only — never glob/grep for .git/ (it is gitignored, invisible to search tools). .git/ must be at repo root. Never search inside, read from, or interact with .git/objects or any VCS internals as if they were project content. VCS metadata is NOT source code.",
    "FRACTAL_CANDIDATES": "generate_fractal_candidates(model, seeds, depth) dispatches fractal generation: Sierpinski (triangle subdivision for >=3 peaks, or when orthogonality_score < 0.7), Quad/Oct (grid subdivision for 2/4/8 peaks when orthogonality_score ≥ 0.7), L-System (grammar walk, fallback for unknown models or 1 peak).",
    "GOAL_SEEDS": "goal_seeds(goal, evidence) extracts meaning-true goal slices: keyword extraction -> co-occurrence clustering -> seed vectors (capped at 8). Replaces manual seed selection.",
    "RESIDUAL_LOOP": "residual_recluster(state, original_goal_sv) closes the ADID loop: re-clusters pending tasks against original Goal SV using adaptive_tau at 70th percentile. Returns tasks aligned with the original goal; may return empty (→ TERMINAL). Discarded tasks tracked in out_of_scope.",
    "EMIT_STATE": "emit_state(goal_sv, completed_tasks, pending_tasks, blockers, next_step, out_of_scope, terminal) returns a structured state dict {done, pending, blocked, next, goal_sv, out_of_scope, terminal, terminal_mode}. v6: +out_of_scope (discarded tasks), +terminal (bool — true when pending=[]), +terminal_mode (SUCCESS|BLOCKED|OUT_OF_SCOPE; precedence: BLOCKED>OUT_OF_SCOPE>SUCCESS). Serialised by the caller; InfoMark-stamped at Gate 9.",
    "GROUND": "ground(goal) generates an evidence-gathering plan from goal keywords. Routes by intent: CODE_STRUCTURE→codegraph+bounded read; CONVERSATION_FACT→messagesearch+session-read; PUBLIC_API→universalsearch web+code; UNKNOWN_ROOT_CAUSE→local evidence first→external search. Returns structured search plan; does NOT execute tools — agent follows at Gate 1.",
    "GOAL_PEAKS": "goal_peaks(goal, evidence) counts distinct keyword clusters (peaks) in goal+evidence. Feeds select_fractal_model: 1 peak→L-System, 2→Quad-Oct binary, 3→Sierpinski, 4→check orthogonality_score (≥0.7→Quad-Oct quad, <0.7→Sierpinski), 5-7→Sierpinski, 8→check orthogonality_score (≥0.7→Quad-Oct oct, <0.7→Sierpinski), 9+→Sierpinski clamped.",
    "SV_DELTA": "sv_delta(current_sv, previous_sv) computes L1 semantic distance between two SV states (keyword→weight dicts). Returns float in [0,2]: [0.0,0.3)→L-System (stable), [0.3,0.6)→Quad-Oct (moderate shift), [0.6,2.0]→Sierpinski (large shift). Neutral 0.5 if SV missing.",
    "SV_OUTPUT": "after every non-trivial response output sv=[k1..kn],[w1..wn sum=1.0], md5_sv_tag (consistent 8-32 hex derived from sv), Semantic dominant (one-sentence summary). Keywords 3-9, weights ordered. Change tag when keywords or weights change. Omit for trivial answers (yes/no, single-line facts, tool output relay).",
    "CLEAN_STATE": "end substantial responses with Clean next state: Done: {verified items or none}, Pending: {unfinished}, Blocked: {blockers with reason or none}, Next: {one immediate next step or none}. Use Exact evidence for Done claims. If blocked: codegraph/messagesearch then universalsearch web and/or code (Sourcegraph) before declaring blocked.",
    "DECOMPOSE": "fractal lattice before work list: over-generate (Sierpinski/Quad/L-System, adaptive_depth 1-3) → Manhattan (L1) to Goal SV → adaptive τ (percentile) → adaptive_k (CV dispersion) → k-medoids (→ CLARA sampling when N≥100, seeds ground centers) → CENTRAL_TASKS=medoids only. Never Mode-1 linear step lists for multi-step work. Same recursive motif every level (F→F+F-F), not ad-hoc essays.",
    "DOCUMENT_SURFACE": "maintain doc surface: docs/ (detailed), DOCINDEX.md (owners/entrypoints/last_verified), index.md (folder-based repo map). Update when adding or moving files.",
    "WORKSPACE_LANES": "organize by purpose: experiments/ (ad-hoc scratch), futures/ (drafts not ready), obsolete/ (deprecated refs), makeups/ (explicit stubs). Never mix throwaway with mainline.",
    "PROGRESS_LOG": "track progress: _development_plan.md (goals+tasks with [x] checks), _progress_log.md ([TIMESTAMP] activity -> script -> output), _application_workflow_diagram.md (modules->functions->I/O map). Update after each non-trivial change.",
    "METRIC_ADAPTATION": "System autonomously detects gaps in evaluation metrics and generates corrective functions (e.g., silhouette score for residual_recluster, internal consistency for goal_seeds). PARAMETER_ADAPTATION (percentile, window, thresholds within pre-approved bounds) is automatic. METRIC_FAMILY_CHANGE (Manhattan→cosine+L1, new quality function, new goal-seed semantics) requires: separate candidate branch + old_metric comparison + sealed holdout + regression oracle + explicit promotion authority. Adaptive tuning ≠ evaluator mutation.",
})

# Source-only declarations for normalized duplicate detection. A rule may repeat
# only when its identifier explicitly aliases the canonical rule identifier.
RUNTIME_RULE_ALIASES = MappingProxyType({})

# One semantic owner per rule keeps the runtime dictionary navigable without
# duplicating policy prose across agents, skills, commands, or grounding specs.
RUNTIME_RULE_OWNERS = MappingProxyType({
    "CACHE_STABILITY": "cache",
    "EVIDENCE_ORDER": "evidence",
    "SEARCH_ORDER": "evidence",
    "VERIFY_OUTCOME": "oracle",
    "INFOMARK_SEP": "infomark",
    "REUSE_BEFORE": "evidence",
    "SMOKE_BEFORE": "plan",
    "SMOKE_SPEC": "plan",
    "SMOKE_VALIDATE": "plan",
    "SMOKE_VERIFY": "verification",
    "NAMING": "hygiene",
    "WRITE_SCOPE": "mutation",
    "MEMORY_RANK": "infomark",
    "MEMORY_LINKS": "memory",
    "ADID_FREEZE": "adid",
    "ADID_OPS": "adid",
    "NO_HARDCODE": "evidence",
    "WHERE_WHICH": "evidence",
    "VCS_ROOT": "evidence",
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
    "DOCUMENT_SURFACE": "hygiene",
    "WORKSPACE_LANES": "hygiene",
    "PROGRESS_LOG": "hygiene",
    "METRIC_ADAPTATION": "plan",
})

RUNTIME_WORKFLOWS = MappingProxyType({
    "adid": ("adid", "ADID_FREEZE", "ADID_OPS", "scope", "mutation", "verification"),
    "diagnose": (
        "scope",
        "evidence",
        "EVIDENCE_ORDER",
        "SEARCH_ORDER",
        "REUSE_BEFORE",
        "WHERE_WHICH",
        "VCS_ROOT",
        "NO_HARDCODE",
        "verification",
        "oracle",
        "VERIFY_OUTCOME",
        "INFOMARK_SEP",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "MEMORY_RANK",
    ),
    "modify": (
        "plan",
        "REUSE_BEFORE",
        "SMOKE_BEFORE",
        "SMOKE_VERIFY",
        "scope",
        "cache",
        "mutation",
        "WRITE_SCOPE",
        "CACHE_STABILITY",
        "verification",
        "oracle",
        "VERIFY_OUTCOME",
        "INFOMARK_SEP",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "MEMORY_RANK",
    ),
    "observe": (
        "scope",
        "evidence",
        "EVIDENCE_ORDER",
        "SEARCH_ORDER",
        "WHERE_WHICH",
        "VCS_ROOT",
        "NO_HARDCODE",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "INFOMARK_SEP",
        "MEMORY_RANK",
    ),
    "hygiene_ops": ("hygiene", "NAMING", "DOCUMENT_SURFACE", "WORKSPACE_LANES", "PROGRESS_LOG", "CLEAN_STATE", "EVIDENCE_ORDER"),
    "planning": (
        "plan",
        "DECOMPOSE",
        "SMOKE_BEFORE",
        "SMOKE_SPEC",
        "SMOKE_VALIDATE",
        "GROUND",
        "METRIC_ADAPTATION",
        "FRACTAL_CANDIDATES",
        "GOAL_SEEDS",
        "GOAL_PEAKS",
        "SV_DELTA",
        "RESIDUAL_LOOP",
        "EMIT_STATE",
        "REUSE_BEFORE",
        "SMOKE_VERIFY",
        "evidence",
        "scope",
        "mutation",
        "verification",
        "oracle",
        "VERIFY_OUTCOME",
        "infomark",
        "INFOMARK_SEP",
        "MEMORY_RANK",
        "SV_OUTPUT",
        "CLEAN_STATE",
    ),
    "research": (
        "evidence",
        "EVIDENCE_ORDER",
        "SEARCH_ORDER",
        "REUSE_BEFORE",
        "WHERE_WHICH",
        "VCS_ROOT",
        "NO_HARDCODE",
        "verification",
        "oracle",
        "INFOMARK_SEP",
        "SV_OUTPUT",
        "CLEAN_STATE",
        "infomark",
        "MEMORY_RANK",
        "MEMORY_LINKS",
    ),
})

RUNTIME_PACKS = MappingProxyType({
    "agent.build": ("universal", "modify", "diagnose", "adid", "hygiene_ops"),
    "agent.coder": ("agent.build",),

    "agent.explore": ("universal", "observe"),
    "agent.general": ("universal", "observe", "research"),
    "agent.media": ("universal", "scope", "mutation", "verification"),
    "agent.orchestrator": ("universal", "planning", "observe", "verification"),
    "agent.researcher": ("agent.general",),
    "agent.summary": ("universal", "planning", "evidence", "verification", "memory", "infomark"),
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
    "universal": ("evidence", "scope", "verification", "infomark", "memory", "MEMORY_RANK", "MEMORY_LINKS"),
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

# CONTRACTS bundle workflow names (lowercase — expand to multiple rules+terms)
# with specific rule overrides (UPPER_SNAKE_CASE — single atomic rule).
# Example: agent.coder → planning workflow + WRITE_SCOPE + VERIFY_OUTCOME rules.
# Lowercase keys reference WORKFLOWS bundles; UPPER keys reference RULES entries.
RUNTIME_CONTRACTS = MappingProxyType({
    "agent.coder": ("planning", "scope", "mutation", "verification", "WRITE_SCOPE", "VERIFY_OUTCOME"),

    "agent.explore": ("scope", "evidence", "SEARCH_ORDER"),
    "agent.general": ("planning", "scope", "evidence", "verification"),
    "agent.media": ("scope", "mutation", "verification"),
    "agent.orchestrator": ("planning", "scope", "evidence", "verification"),
    "agent.researcher": ("scope", "evidence", "SEARCH_ORDER", "verification"),
    "agent.summary": ("planning", "evidence", "verification", "infomark", "memory", "MEMORY_RANK", "MEMORY_LINKS"),
    "agent.title": ("scope",),
    "command.ai_deps": ("scope", "evidence", "verification"),
    "command.changelog": ("scope", "evidence", "verification"),
    "command.commit": ("scope", "mutation", "verification", "WRITE_SCOPE"),
    "command.duplicate_pr": ("scope", "evidence", "verification"),
    "command.issues": ("scope", "evidence", "SEARCH_ORDER"),
    "command.learn": ("scope", "evidence", "verification"),
    "command.rmslop": ("scope", "mutation", "verification", "WRITE_SCOPE"),
    "command.spellcheck": ("scope", "evidence", "verification"),
    "command.translate": ("scope", "mutation", "verification", "WRITE_SCOPE"),
    "command.triage": ("scope", "evidence", "verification"),
    "policy.adid": ("scope", "evidence", "verification", "SEARCH_ORDER"),
    "policy.adid_ops": ("scope", "mutation", "verification", "WRITE_SCOPE"),
    "policy.coding": ("planning", "evidence", "verification", "EVIDENCE_ORDER", "VERIFY_OUTCOME", "SV_OUTPUT", "CLEAN_STATE"),
    "policy.default": ("scope",),
    "policy.governance": ("scope", "mutation", "verification", "WRITE_SCOPE"),
    "policy.grounding": ("evidence", "verification", "EVIDENCE_ORDER", "SEARCH_ORDER", "NO_HARDCODE"),
    "policy.planning": ("planning", "evidence", "scope", "verification"),
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


