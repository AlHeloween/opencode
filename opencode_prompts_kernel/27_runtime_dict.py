"""Kernel fragment: 27_runtime_dict (former monofile L2769-2994)."""

PROMPT_ABI = MappingProxyType({
    "version": "5",
    "precedence": ("safety", "governance", "task", "domain", "style"),
    "line_endings": "LF",
    # Tier A identity prefix: dictionary + agent/policy SPECS only (skills/commands are Tier B surfaces).
    "identity_tier": "A",
    # Soft budget for model-facing identity (bytes). CI fails if exceeded.
    "identity_max_bytes": 48_000,
})

RUNTIME_TERMS = MappingProxyType({
    "adid": "ADID framework tools: adm, cmd_runner, RAG, Delphi helpers; receivers frozen; ops in policy.adid_ops.",
    "cache": "System content is immutable within a session; compute fingerprints after plugin transforms.",
    "evidence": "Verified reference outranks inference; label uncertainty before claiming completion.",
    "infomark": "Epistemic rank Exact|Inferred|Hypothetical|Guess|Unknown. session-read is Exact; summaries are Inferred.",
    "memory": "Active set is message* + recent s/m; full history soft-hidden in DB; recover via session-read IDs.",
    "mutation": "Modify only within authorized scope; preserve unrelated work and report remaining failure.",
    "plan": "ADID fractal planning only (no Mode-1 linear shortcut): ground → lattice over-generate → cosine filter → k-medoids → CENTRAL_TASKS=medoids → todowrite. PRE_FLIGHT: Prior art (universalsearch web/Sourcegraph) + Smoke Tests before EXECUTION. Residual vs Goal SV. State, evidence, smoke baseline, implement, verify, clean next state.",
    "scope": "Inspection and testing do not authorize unrelated repair; use governing surfaces before inference.",
    "verification": "An oracle decides correctness; do not claim fixed without direct evidence. Smoke oracles are part of verification — post-impl pass criteria from the plan Smoke Tests section.",
    "hygiene": "Project hygiene: workspace lanes keep throwaway code isolated; documentation surface stays indexed; progress logs track what changed and why.",
})

RUNTIME_RULES = MappingProxyType({
    "EVIDENCE.ORDER": "verified > cited > inferred > unknown",
    "SEARCH.ORDER": "where/which > codegraph > messagesearch > universalsearch > glob > grep",
    "WRITE.SCOPE": "modify only within user-authorized scope",
    "VERIFY.OUTCOME": "report outcome, evidence, and remaining failure",
    "REUSE.BEFORE": "before non-trivial invent/build and when stuck after failures: use universalsearch — source=web (internet) and/or source=code (Sourcegraph indexed git) or hybrid. Prefer existing solutions over reinvention. Trivial exception: typo/rename/one-line local fix with codegraph evidence. After failed fix: re-search error signature before custom workaround.",
    "SMOKE.BEFORE": "before implementation: plan must include Smoke Tests (runnable baseline commands + expected-now + post-impl pass criteria) or smoke: N/A with justification (docs/plan-only). Record baseline [Exact] before first code edit; re-run post-impl oracles before [x]. Vague 'test later' is forbidden.",
    "CACHE.STABILITY": "keep the system prefix byte-stable for the session",
    "MEMORY.RANK": "session-read Exact > summary Inferred > unaided Guess; never treat summaries as Exact",
    "MEMORY.LINKS": "every summary and message* must carry message IDs for session-read recovery",
    "ADID.FREEZE": "never hand-edit ADID framework rule receivers under .cursor/ or .opencode/; kernel SPECS + ADM only",
    "ADID.OPS": "always-on how-to: cmd_runner start/tail/send; adm template→apply→verify; rag index/query; Delphi init+msbuild (see policy.adid_ops)",
    "NO_HARDCODE": "never hardcode paths, ports, URLs, versions, or magic values — discover via where/which/codegraph/glob or read from config/adm.json",
    "WHERE_WHICH": "use where.exe (Windows) / which (Linux/macOS) for any executable lookup — instant, exact, PATH-aware. To discover files in a known directory, prepend the directory to PATH and re-run where/which. Never glob/grep for executables that where/which resolves in one call.",
    "SV_OUTPUT": "after every non-trivial response output sv=[k1..kn],[w1..wn sum=1.0], md5_sv_tag (consistent 8-32 hex derived from sv), Semantic dominant (one-sentence summary). Keywords 3-9, weights ordered. Change tag when keywords or weights change. Omit for trivial answers (yes/no, single-line facts, tool output relay).",
    "CLEAN_STATE": "end substantial responses with Clean next state: Done: {verified items or none}, Pending: {unfinished}, Blocked: {blockers with reason or none}, Next: {one immediate next step or none}. Use Exact evidence for Done claims. If blocked, search web/codegraph/messagesearch before declaring blocked.",
    "DECOMPOSE": "fractal lattice before work list: over-generate (Sierpinski/Quad/L-System) → cosine to Goal SV → k-medoids (k=ceil(N/2), seeds ground centers) → CENTRAL_TASKS=medoids only. Never Mode-1 linear step lists for multi-step work. Same recursive motif every level (F→F+F-F), not ad-hoc essays.",
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
    "VERIFY.OUTCOME": "verification",
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
    "DOCUMENT.SURFACE": "hygiene",
    "WORKSPACE.LANES": "hygiene",
    "PROGRESS.LOG": "hygiene",
})

RUNTIME_WORKFLOWS = MappingProxyType({
    "adid": ("adid", "ADID.FREEZE", "ADID.OPS", "scope", "mutation", "verification"),
    "diagnose": ("scope", "evidence", "EVIDENCE.ORDER", "SEARCH.ORDER", "REUSE.BEFORE", "WHERE_WHICH", "NO_HARDCODE", "verification", "SV_OUTPUT", "CLEAN_STATE", "infomark", "MEMORY.RANK"),
    "modify": ("plan", "REUSE.BEFORE", "SMOKE.BEFORE", "scope", "cache", "mutation", "WRITE.SCOPE", "CACHE.STABILITY", "verification", "VERIFY.OUTCOME", "SV_OUTPUT", "CLEAN_STATE"),
    "observe": ("scope", "evidence", "EVIDENCE.ORDER", "SEARCH.ORDER", "WHERE_WHICH", "NO_HARDCODE", "SV_OUTPUT", "CLEAN_STATE", "infomark", "MEMORY.RANK"),
    "hygiene": ("DOCUMENT.SURFACE", "WORKSPACE.LANES", "PROGRESS.LOG", "CLEAN_STATE", "EVIDENCE.ORDER"),
    "plan": ("plan", "DECOMPOSE", "REUSE.BEFORE", "SMOKE.BEFORE", "evidence", "scope", "mutation", "verification", "MEMORY.RANK", "SV_OUTPUT", "CLEAN_STATE"),
    "research": ("evidence", "EVIDENCE.ORDER", "SEARCH.ORDER", "REUSE.BEFORE", "WHERE_WHICH", "NO_HARDCODE", "verification", "SV_OUTPUT", "CLEAN_STATE", "infomark", "MEMORY.RANK", "MEMORY.LINKS"),
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


