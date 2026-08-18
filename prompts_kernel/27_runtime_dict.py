"""Kernel fragment: 27_runtime_dict (former monofile L2769-2994)."""

PROMPT_ABI = MappingProxyType({
    "precedence": ("safety", "governance", "task", "domain", "style"),
})

RUNTIME_TERMS = MappingProxyType({
    "adid": "ADID receivers frozen; host-agnostic SPECS; runtime-injected surfaces.",
    "cache": "System prefix byte-stable per session; compute fingerprints post-transform.",
    "evidence": "Verified > cited > inferred > unknown; intent-based tool routing (@GATE_1_GROUND).",
    "infomark": "Status ∈ {Exact, Inferred, Hypothetical, Guess, Unknown}; stamped-only in G (@GATE_8_ORACLE).",
    "manhattan_l1": "L1 additive metric for fractal k-medoids; preserves depth & scale (@GATE_2_DECOMPOSE).",
    "memory": "Active window primary; soft-hidden history via session-read.",
    "mutation": "Authorized envelope scope only; persistent write requires @GATE_4_AUTHORIZE.",
    "oracle": "Executor ≠ Oracle ≠ Analyst; PASS → Exact stamp; FAIL → demote (@GATE_8_ORACLE).",
    "plan": "Fractal decomposition → Manhattan L1 → adaptive k-medoids → CENTRAL_TASKS (@GATE_2_DECOMPOSE).",
    "ref_routing": "Zero-prose specs; strict schema/rule refs (by rule name, gate number, or section name — see How to Read).",
    "scope": "Inspection ≠ authorization; pre-approved envelope vs explicit approval (@GATE_4_AUTHORIZE).",
    "sv": "Semantic Vector (keywords, L1 delta, md5 chain); primary context anchor (@GATE_9_CLEAN_STATE).",
    "verification": "ACCEPT ⇔ Oracle(contract) == PASS; self-certify REJECTED (@GATE_8_ORACLE).",
})

# Gate category for each rule — used by renderer to group rules under gate headers.
RUNTIME_RULE_CATEGORIES = MappingProxyType({
    # GATE_1_GROUND
    "EVIDENCE_ORDER": "GATE_1_GROUND", "SEARCH_ORDER": "GATE_1_GROUND", "WHERE_WHICH": "GATE_1_GROUND",
    "REUSE_BEFORE": "GATE_1_GROUND", "GROUND": "GATE_1_GROUND", "NO_HARDCODE": "GATE_1_GROUND",
    "VCS_ROOT": "GATE_1_GROUND", "READ_ENTIRE_FILE": "GATE_1_GROUND",
    "TONE_AND_STYLE": "GATE_9_CLEAN_STATE", "NAMING": "GATE_3_MASTER_PLAN",
    "MEMORY_RANK": "GATE_1_GROUND", "MEMORY_LINKS": "GATE_1_GROUND",
    # GATE_2_DECOMPOSE
    "DECOMPOSE": "GATE_2_DECOMPOSE", "FRACTAL_CANDIDATES": "GATE_2_DECOMPOSE", "GOAL_SEEDS": "GATE_2_DECOMPOSE",
    "GOAL_PEAKS": "GATE_2_DECOMPOSE", "SV_DELTA": "GATE_2_DECOMPOSE",
    # GATE_3_MASTER_PLAN
    "SMOKE_BEFORE": "GATE_3_MASTER_PLAN", "SMOKE_SPEC": "GATE_3_MASTER_PLAN", "SMOKE_VALIDATE": "GATE_3_MASTER_PLAN",
    "INFOMARK_SEP": "GATE_3_MASTER_PLAN",
    # GATE_4_AUTHORIZE
    "WRITE_SCOPE": "GATE_4_AUTHORIZE",
    # GATE_6_GROUND_PLAN
    "DOCUMENT_SURFACE": "GATE_6_GROUND_PLAN", "CODE_STANDARDS": "GATE_6_GROUND_PLAN",
    # GATE_7_IMPLEMENT
    "CACHE_STABILITY": "GATE_7_IMPLEMENT", "CONSTITUTION_BLOCKS": "GATE_7_IMPLEMENT",
    "ADID_OPS": "GATE_7_IMPLEMENT", "NO_SCRIPT_EDITING": "GATE_7_IMPLEMENT",
    "WORKSPACE_LANES": "GATE_7_IMPLEMENT", "ADID_FREEZE": "GATE_7_IMPLEMENT",
    "FRAMEWORK_INHERITANCE": "GATE_7_IMPLEMENT",
    "PLAN_CONTRACT": "GATE_7_IMPLEMENT", "PLAN_BINDING": "GATE_7_IMPLEMENT",
    # GATE_3_MASTER_PLAN (lifecycle)
    "PLAN_LIFECYCLE": "GATE_3_MASTER_PLAN", "PLAN_REVISION": "GATE_3_MASTER_PLAN",
    # GATE_8_ORACLE
    "VERIFY_OUTCOME": "GATE_8_ORACLE", "SMOKE_VERIFY": "GATE_8_ORACLE",
    "OBSOLETE_CLEANUP": "GATE_8_ORACLE",
    # GATE_9_CLEAN_STATE
    "CLEAN_STATE": "GATE_9_CLEAN_STATE", "SV_OUTPUT": "GATE_9_CLEAN_STATE", "SV_EVERY_TURN": "GATE_9_CLEAN_STATE",
    "RESIDUAL_LOOP": "GATE_9_CLEAN_STATE", "EMIT_STATE": "GATE_9_CLEAN_STATE",     "PLANS_COMPLETED": "GATE_9_CLEAN_STATE",
    "CLOSURE_PROOF": "GATE_9_CLEAN_STATE",
    "METRIC_ADAPTATION": "GATE_9_CLEAN_STATE",
    "PROGRESS_LOG": "GATE_9_CLEAN_STATE",
})

RUNTIME_RULES = MappingProxyType({
    # ── G1: GROUND (Facts & Memory Gathering) ──
    "EVIDENCE_ORDER": "verified > cited > inferred > unknown.",
    "SEARCH_ORDER": "Intent-based routing per @GATE_1_GROUND.search_intent; no single linear order.",
    "WHERE_WHICH": "Native OS binary lookup (where/which); never grep/glob for executables.",
    "REUSE_BEFORE": "Research ladder: Guess -> web -> code -> Hypothetical -> smoke -> Exact.",
    "GROUND": "Generate evidence plan from goal keywords; route by intent before judgment.",
    "NO_HARDCODE": "Discover paths/ports/configs dynamically; read project config; no magic values.",
    "VCS_ROOT": "Git status only; never search inside .git/ directory.",
    "READ_ENTIRE_FILE": "Files <100KB: read 100%. Files >=100KB: limit/offset with min 2000-line header.",
    "MEMORY_RANK": "Session-read Exact > summary Inferred > unaided Guess; summaries are never Exact.",
    "MEMORY_LINKS": "Summary items must include message IDs for session-read recovery.",

    # ── G2: DECOMPOSE (Task Geometry) ──
    "DECOMPOSE": "Goal -> seeds -> fractal candidates -> Manhattan L1 -> adaptive k-medoids -> CENTRAL_TASKS.",
    "FRACTAL_CANDIDATES": "Dispatch: Sierpinski (peaks>=3|ortho<0.7), QuadOct (peaks in {2,4,8}&ortho>=0.7), LSystem (peaks=1).",
    "GOAL_SEEDS": "Extract meaning-true slices -> co-occurrence clustering -> seed vectors (cap 8).",
    "GOAL_PEAKS": "Count keyword clusters -> select_fractal_model.",
    "SV_DELTA": "L1 distance delta(curr, prev) in [0,2]: [0,0.3) LSystem, [0.3,0.6) QuadOct, [0.6,2] Sierpinski.",

    # ── G3: MASTER PLAN (Planning & Specification) ──
    "SMOKE_BEFORE": "Plan requires runnable Smoke Tests or explicit smoke:N/A with justification.",
    "SMOKE_SPEC": "Generate template {smoke_na, baseline[], post_checks[], blast_radius}.",
    "SMOKE_VALIDATE": "Validate spec: >=1 baseline check, exit status, tolerance justification; fail @GATE_4_AUTHORIZE if invalid.",
    "INFOMARK_SEP": "Salience != Evidence; fluency != truth; only stamped Exact|Inferred enter G.",
    "NAMING": "Rule and task identifiers must use UPPER_SNAKE_CASE with underscore delimiters.",
    "PLAN_LIFECYCLE": "Plan follows state machine per @MASTER_PLAN_SCHEMA.lifecycle: DRAFT → ACTIVE → EXECUTING → VERIFYING → IMPLEMENTED → COMPLETED. Only ACTIVE and EXECUTING plans may drive @GATE_7_IMPLEMENT mutations.",
    "PLAN_REVISION": "On material change (scope_change | architecture_change | new_requirement | failed_core_assumption | oracle_invalidates_premise): ACTIVE → INVALIDATED, create revision+1, rerun @GATE_2_DECOMPOSE, rerun @GATE_3_MASTER_PLAN. Plan reauthorization ALWAYS required after INVALIDATED. Execution envelope reissue only if scope/budget/baseline changed.",

    # ── G4: AUTHORIZE (Execution Envelope) ──
    "WRITE_SCOPE": "Modify strictly within user-authorized paths and ExecutionEnvelope bounds.",

    # ── G6: GROUND PLAN (Codebase Mapping & Standards) ──
    "DOCUMENT_SURFACE": "Maintain docs/, DOCINDEX.md, and index.md on file structure mutations.",
    "CODE_STANDARDS": "Adhere strictly to project linters/formatters (PEP8, StandardJS, gofmt).",

    # ── G7: IMPLEMENT (Code Mutation & Safety) ──
    "CACHE_STABILITY": "Maintain byte-stable system prefix across session execution.",
    "CONSTITUTION_BLOCKS": "Hard-block direct shell file listing, git history resets, fossil CLI, and unisolated build toolchains.",
    "ADID_OPS": "Product tools (codegraph/edit/write/grep) for file ops; shell ONLY for build/test/pkg-mgr.",
    "NO_SCRIPT_EDITING": "Scripted code editing (sed/awk/redirection) forbidden; use product edit/write tools.",
    "WORKSPACE_LANES": "Keep throwaway code isolated in experiments/, futures/, obsolete/, makeups/.",
    "ADID_FREEZE": "ADID receivers frozen; change only via SPECS or official ADM pipelines.",
    "FRAMEWORK_INHERITANCE": "Inherit/extend existing abstractions; polymorphism > duplication.",
    "PLAN_CONTRACT": "Every path reaching @GATE_7_IMPLEMENT must reference exactly one active master plan. Applies to: build_mode, plan_mode, orchestrator_agent, coder_agent. No exceptions — no implementation without an active plan.",
    "PLAN_BINDING": "@GATE_7_IMPLEMENT requires plan.state ∈ {ACTIVE, EXECUTING}, task ∈ plan.tasks, task.depends_on_claims ⊆ G (Exact|Inferred). Worker must match task.worker_id or be authorized delegate.",

    # ── G8: ORACLE (Verification & Promotion) ──
    "VERIFY_OUTCOME": "Declare oracle before execution; PASS -> Exact stamp; FAIL -> demote; no self-certification.",
    "SMOKE_VERIFY": "Compare post-execution output against baseline hash/exit; PASS required for promotion.",
    "OBSOLETE_CLEANUP": "Verify removal via smoke test, delete dead code, update refs; no commented code.",

    # ── G9: CLEAN STATE (Output & Communication) ──
    "CLEAN_STATE": "Emit Clean next state (Done, Pending, Blocked, Next); completed plans -> plans_completed/.",
    "SV_OUTPUT": "Emit @SV_FORMAT after every response without exception.",
    "SV_EVERY_TURN": "Protocol requirement: SV emitted every turn; trivial -> Keywords: acknowledged 1.0.",
    "RESIDUAL_LOOP": "Re-cluster pending tasks against original Goal SV; empty → execution_exhausted (not TERMINAL). If closure PASS → SUCCESS. If closure gaps → CONTINUE with closure residual vector.",
    "EMIT_STATE": "Return structured state; terminal_mode: BLOCKED > OUT_OF_SCOPE > SUCCESS.",
    "PLANS_COMPLETED": "Move completed plan files to plans_completed/ immediately upon completion.",
    "CLOSURE_PROOF": "SUCCESS requires execution_exhausted=true AND acceptance_coverage >= outcome_contract.coverage_threshold AND critical_open_risks=0 AND outcome_oracle=PASS. Task complete != plan complete != user outcome proven. See @CLEAN_NEXT_STATE.closure_proof.",
    "METRIC_ADAPTATION": "Parameter auto-tuning within bounds; metric family change requires governance.",
    "PROGRESS_LOG": "Maintain _development_plan.md, _progress_log.md, and _application_workflow_diagram.md.",
    "TONE_AND_STYLE": "Expert stance, direct, multi-perspective, concise, no hedging or apologies.",
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
    "WRITE_SCOPE": "mutation",
    "ADID_OPS": "adid",
    "NO_HARDCODE": "evidence",
    "WHERE_WHICH": "evidence",
    "VCS_ROOT": "evidence",
    "SV_OUTPUT": "verification",
    "SV_EVERY_TURN": "verification",
    "CLEAN_STATE": "verification",
    "DECOMPOSE": "plan",
    "FRACTAL_CANDIDATES": "plan",
    "GOAL_SEEDS": "plan",
    "RESIDUAL_LOOP": "verification",
    "EMIT_STATE": "verification",
    "GROUND": "evidence",
    "GOAL_PEAKS": "plan",
    "SV_DELTA": "verification",
    "PLANS_COMPLETED": "plan",
    "CONSTITUTION_BLOCKS": "mutation",
    "READ_ENTIRE_FILE": "evidence",
    "NO_SCRIPT_EDITING": "mutation",
    # CC rules integrated into gates
    "TONE_AND_STYLE": "adid",
    "NAMING": "ref_routing",
    "MEMORY_RANK": "infomark",
    "MEMORY_LINKS": "memory",
    "ADID_FREEZE": "adid",
    "DOCUMENT_SURFACE": "ref_routing",
    "WORKSPACE_LANES": "mutation",
    "PROGRESS_LOG": "sv",
    "CODE_STANDARDS": "ref_routing",
    "FRAMEWORK_INHERITANCE": "mutation",
    "OBSOLETE_CLEANUP": "verification",
    "METRIC_ADAPTATION": "plan",
    "PLAN_CONTRACT": "plan",
    "PLAN_BINDING": "plan",
    "PLAN_LIFECYCLE": "plan",
    "PLAN_REVISION": "plan",
    "CLOSURE_PROOF": "verification",
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
        "READ_ENTIRE_FILE",
        "verification",
        "oracle",
        "VERIFY_OUTCOME",
        "INFOMARK_SEP",
        "SV_OUTPUT",
        "SV_EVERY_TURN",
        "CLEAN_STATE",
        "infomark",
        "MEMORY_RANK",
        "adid",
        "ADID_OPS",
        "NO_SCRIPT_EDITING",
        "TONE_AND_STYLE",
        "CONSTITUTION_BLOCKS",
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
        "SV_EVERY_TURN",
        "CLEAN_STATE",
        "infomark",
        "MEMORY_RANK",
        "adid",
        "ADID_OPS",
        "NO_SCRIPT_EDITING",
        "TONE_AND_STYLE",
        "CONSTITUTION_BLOCKS",
        "FRAMEWORK_INHERITANCE",
        "PLAN_CONTRACT",
        "PLAN_BINDING",
    ),
    "observe": (
        "scope",
        "evidence",
        "EVIDENCE_ORDER",
        "SEARCH_ORDER",
        "WHERE_WHICH",
        "VCS_ROOT",
        "NO_HARDCODE",
        "READ_ENTIRE_FILE",
        "SV_OUTPUT",
        "SV_EVERY_TURN",
        "CLEAN_STATE",
        "infomark",
        "INFOMARK_SEP",
        "MEMORY_RANK",
        "adid",
        "ADID_OPS",
        "NO_SCRIPT_EDITING",
    ),
    "hygiene_ops": ("hygiene", "NAMING", "DOCUMENT_SURFACE", "WORKSPACE_LANES", "PROGRESS_LOG", "CLEAN_STATE", "PLANS_COMPLETED", "EVIDENCE_ORDER", "CODE_STANDARDS", "OBSOLETE_CLEANUP"),
    "planning": (
        "plan",
        "DECOMPOSE",
        "SMOKE_BEFORE",
        "SMOKE_SPEC",
        "SMOKE_VALIDATE",
        "GROUND",
        "FRACTAL_CANDIDATES",
        "GOAL_SEEDS",
        "GOAL_PEAKS",
        "SV_DELTA",
        "METRIC_ADAPTATION",
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
        "SV_EVERY_TURN",
        "CLEAN_STATE",
        "PLANS_COMPLETED",
        "READ_ENTIRE_FILE",
        "NO_SCRIPT_EDITING",
        "PLAN_LIFECYCLE",
        "PLAN_REVISION",
        "CLOSURE_PROOF",
    ),
    "research": (
        "evidence",
        "EVIDENCE_ORDER",
        "SEARCH_ORDER",
        "REUSE_BEFORE",
        "WHERE_WHICH",
        "VCS_ROOT",
        "NO_HARDCODE",
        "READ_ENTIRE_FILE",
        "verification",
        "oracle",
        "INFOMARK_SEP",
        "SV_OUTPUT",
        "SV_EVERY_TURN",
        "CLEAN_STATE",
        "infomark",
        "MEMORY_RANK",
        "MEMORY_LINKS",
    ),
})

RUNTIME_PACKS = MappingProxyType({
    "agent.build_mode": ("universal",),
    "agent.plan_mode": ("universal",),
    "agent.coder_agent": ("universal",),
    "agent.explorer_agent": ("universal",),
    "agent.general_agent": ("universal",),
    "agent.media_agent": ("universal",),
    "agent.orchestrator_agent": ("universal",),
    "agent.researcher_agent": ("universal",),
    "agent.title_agent": ("universal",),
    "domain.biology": ("domain.natural_science",),
    "domain.chemistry": ("domain.natural_science",),
    "domain.economics": ("domain.social_science",),
    "domain.history": ("domain.social_science",),
    "domain.natural_science": ("universal",),
    "domain.physics": ("domain.natural_science",),
    "domain.psychology": ("domain.social_science",),
    "domain.social_science": ("universal",),
    "domain.sociology": ("domain.social_science",),
    "lang.markdown": ("universal",),
    "lang.python": ("universal",),
    "lang.typescript": ("universal",),
    "universal": ("EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WRITE_SCOPE",
                  "VERIFY_OUTCOME", "INFOMARK_SEP", "MEMORY_RANK", "MEMORY_LINKS",
                  "READ_ENTIRE_FILE", "NO_SCRIPT_EDITING", "TONE_AND_STYLE", "CODE_STANDARDS"),
})

# Source spec names are stable development identifiers. Runtime contract IDs are
# the compact model-facing vocabulary and deliberately carry no repeated prose.
SPEC_CONTRACT_IDS = MappingProxyType({
    "ADID_FRAMEWORK_RULES": "policy.adid", "ADID_OPS": "policy.adid_ops",
    "AI_DEPS": "command.ai_deps",
    "BASE_AGENT": "agent.base_agent",
    "BUILD_MODE": "agent.build_mode",
    "CHANGELOG": "command.changelog",
    "CODER_AGENT": "agent.coder_agent",
    "AGENT_DIRECTIVES": "policy.coding", "COMMIT": "command.commit",
    "DUPLICATE_PR": "command.duplicate_pr",
    "EXPLORER_AGENT": "agent.explorer_agent",
    "GENERAL_AGENT": "agent.general_agent",
    "GOVERNANCE": "policy.governance", "GROUNDING_RULES": "policy.grounding", "ISSUES": "command.issues",
    "LEARN": "command.learn",
    "MEDIA_AGENT": "agent.media_agent",
    "ORCHESTRATOR_AGENT": "agent.orchestrator_agent",
    "PLAN_MODE": "agent.plan_mode",
    "PLANNING": "policy.planning",
    "REASONING_MODE": "policy.reasoning",
    "RESEARCHER_AGENT": "agent.researcher_agent",
    "RMSLOP": "command.rmslop", "SPELLCHECK": "command.spellcheck",
    "TITLE_AGENT": "agent.title_agent",
    "TRANSLATE": "command.translate", "TRIAGE": "command.triage",
})

# CONTRACTS: flat rule lists — no WORKFLOWS indirection.
# Agent reads its contract → looks up rules in RULES section → cross-references gates in reasoning.txt.
RUNTIME_CONTRACTS = MappingProxyType({
    "agent.base_agent": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "WHERE_WHICH", "NO_HARDCODE", "VCS_ROOT",
        "INFOMARK_SEP", "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN", "MEMORY_RANK",
    ),
    "agent.build_mode": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "NO_HARDCODE", "VCS_ROOT",
        "READ_ENTIRE_FILE",
        "DECOMPOSE",
        "SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE", "INFOMARK_SEP",
        "WRITE_SCOPE",
        "CACHE_STABILITY", "CONSTITUTION_BLOCKS", "ADID_OPS", "NO_SCRIPT_EDITING",
        "PLAN_CONTRACT", "PLAN_BINDING",
        "VERIFY_OUTCOME", "SMOKE_VERIFY",
        "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN", "RESIDUAL_LOOP", "EMIT_STATE", "PLANS_COMPLETED",
        "NAMING", "MEMORY_RANK", "MEMORY_LINKS", "ADID_FREEZE",
    ),
    "agent.plan_mode": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "NO_HARDCODE", "VCS_ROOT",
        "READ_ENTIRE_FILE",
        "DECOMPOSE",
        "SMOKE_BEFORE", "SMOKE_SPEC", "INFOMARK_SEP",
        "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN",
        "MEMORY_RANK", "MEMORY_LINKS",
    ),
    "agent.coder_agent": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "NO_HARDCODE", "VCS_ROOT",
        "READ_ENTIRE_FILE",
        "DECOMPOSE",
        "SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE", "INFOMARK_SEP",
        "WRITE_SCOPE",
        "CACHE_STABILITY", "CONSTITUTION_BLOCKS", "ADID_OPS", "NO_SCRIPT_EDITING",
        "PLAN_CONTRACT", "PLAN_BINDING",
        "VERIFY_OUTCOME", "SMOKE_VERIFY",
        "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN", "RESIDUAL_LOOP", "EMIT_STATE", "PLANS_COMPLETED",
        "NAMING", "MEMORY_RANK", "MEMORY_LINKS", "ADID_FREEZE",
    ),
    "agent.explorer_agent": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "WHERE_WHICH", "VCS_ROOT", "NO_HARDCODE",
        "READ_ENTIRE_FILE",
        "SV_OUTPUT", "SV_EVERY_TURN", "CLEAN_STATE", "INFOMARK_SEP", "MEMORY_RANK",
    ),
    "agent.general_agent": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "NO_HARDCODE",
        "READ_ENTIRE_FILE",
        "DECOMPOSE",
        "SMOKE_BEFORE", "INFOMARK_SEP",
        "VERIFY_OUTCOME",
        "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN",
        "MEMORY_RANK",
    ),
    "agent.media_agent": (
        "WRITE_SCOPE",
        "VERIFY_OUTCOME",
        "SV_OUTPUT", "SV_EVERY_TURN", "CLEAN_STATE",
    ),
    "agent.orchestrator_agent": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "NO_HARDCODE", "VCS_ROOT",
        "READ_ENTIRE_FILE",
        "DECOMPOSE",
        "SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE", "INFOMARK_SEP",
        "WRITE_SCOPE",
        "VERIFY_OUTCOME", "SMOKE_VERIFY",
        "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN", "RESIDUAL_LOOP", "EMIT_STATE", "PLANS_COMPLETED",
        "MEMORY_RANK", "MEMORY_LINKS",
    ),
    "agent.researcher_agent": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "VCS_ROOT", "NO_HARDCODE",
        "READ_ENTIRE_FILE",
        "VERIFY_OUTCOME",
        "INFOMARK_SEP",
        "SV_OUTPUT", "SV_EVERY_TURN", "CLEAN_STATE",
        "MEMORY_RANK", "MEMORY_LINKS",
    ),
    "agent.title_agent": ("SV_OUTPUT",),
    "command.ai_deps": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME", "SV_OUTPUT"),
    "command.changelog": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME", "SV_OUTPUT"),
    "command.commit": ("WRITE_SCOPE", "VERIFY_OUTCOME", "SV_OUTPUT"),
    "command.duplicate_pr": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME"),
    "command.issues": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME"),
    "command.learn": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME"),
    "command.rmslop": ("WRITE_SCOPE", "VERIFY_OUTCOME", "SV_OUTPUT"),
    "command.spellcheck": ("EVIDENCE_ORDER", "VERIFY_OUTCOME"),
    "command.translate": ("WRITE_SCOPE", "VERIFY_OUTCOME", "SV_OUTPUT"),
    "command.triage": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME"),
    "policy.adid": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME", "ADID_FREEZE"),
    "policy.adid_ops": ("WRITE_SCOPE", "VERIFY_OUTCOME", "ADID_OPS", "CONSTITUTION_BLOCKS"),
    "policy.coding": (
        "DECOMPOSE", "SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE",
        "EVIDENCE_ORDER", "VERIFY_OUTCOME", "SMOKE_VERIFY",
        "SV_OUTPUT", "SV_EVERY_TURN", "CLEAN_STATE",
    ),
    "policy.governance": ("WRITE_SCOPE", "VERIFY_OUTCOME"),
    "policy.grounding": ("EVIDENCE_ORDER", "SEARCH_ORDER", "NO_HARDCODE", "VERIFY_OUTCOME"),
    "policy.planning": (
        "DECOMPOSE", "SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE",
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE",
        "VERIFY_OUTCOME",
        "CLEAN_STATE", "PLANS_COMPLETED",
    ),
    "policy.reasoning": ("EVIDENCE_ORDER", "SEARCH_ORDER", "VERIFY_OUTCOME", "SV_OUTPUT"),
})


def _render_spec_block(name: str, spec: dict) -> list[str]:
    """Render one _spec() dict as compact human-readable text."""
    lines: list[str] = [f"## {name}"]

    intent = spec.get("intent", "")
    if intent:
        lines.append(intent.strip().replace("\n", " "))

    contract = spec.get("contract", [])
    if contract:
        refs = [f"@{c}" if c.isidentifier() else c for c in contract]
        lines.append(f"contract: [{', '.join(refs)}]")

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


def _render_runtime_mapping(name: str, values: MappingProxyType,
                           categories: MappingProxyType | None = None) -> list[str]:
    lines = [f"{name}:"]
    # PROMPT_ABI precedence lists categories, not @refs — never prefix
    _no_prefix_keys = {"precedence"}
    def _fmt_items(v: tuple) -> str:
        parts = []
        for x in v:
            if isinstance(x, str) and x.isidentifier():
                parts.append(x)  # no @ prefix — these are category labels, not refs
            else:
                parts.append(repr(x))
        return ", ".join(parts)
    if categories is not None:
        # Group by category with gate headers
        current_cat = None
        for key, v in values.items():
            cat = categories.get(key)
            if cat and cat != current_cat:
                current_cat = cat
                lines.append(f"  # ── {cat} ──")
            if isinstance(v, tuple):
                lines.append(f"  {key}: [{_fmt_items(v)}]")
            else:
                lines.append(f"  {key}: {v}")
    else:
        for key, v in values.items():
            if isinstance(v, tuple):
                lines.append(f"  {key}: [{_fmt_items(v)}]")
            else:
                lines.append(f"  {key}: {v}")
    return lines


# SPECS sections in the identity prefix (Tier A). Commands are Tier B
# (command surfaces) — not permanent identity weight.
_TIER_A_AGENTS = frozenset({
    "BASE_AGENT",
    "BUILD_MODE", "PLAN_MODE",
    "CODER_AGENT", "EXPLORER_AGENT", "ORCHESTRATOR_AGENT", "GENERAL_AGENT",
    "RESEARCHER_AGENT", "MEDIA_AGENT", "TITLE_AGENT",
})
_TIER_A_POLICIES = frozenset({
    "ADID_FRAMEWORK_RULES", "ADID_OPS", "AGENT_DIRECTIVES", "GOVERNANCE",
    "GROUNDING_RULES", "PLANNING", "REASONING_MODE",
})
_TIER_B_COMMANDS = frozenset({
    "COMMIT", "LEARN", "CHANGELOG", "ISSUES", "TRANSLATE", "RMSLOP",
    "AI_DEPS", "SPELLCHECK", "DUPLICATE_PR", "TRIAGE",
})
