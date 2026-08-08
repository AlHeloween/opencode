"""Kernel fragment: 27_runtime_dict (former monofile L2769-2994)."""

PROMPT_ABI = MappingProxyType({
    "precedence": ("safety", "governance", "task", "domain", "style"),
})

RUNTIME_TERMS = MappingProxyType({})  # Terms moved to @CC_TAIL — cross-cutting concerns

# Cross-cutting rules extracted from main RULES for semantic clarity.
# They remain in the kernel via @CC_TAIL section but are not part of the
# primary gate-organized dictionary.
RUNTIME_CC_RULES = MappingProxyType({
    "TONE_AND_STYLE": "Act as expert, no hedging. No apologies or disclaimers. No safety lectures unless asked. Ethical filter: omit non-compliant content, label (Filtered). Understand question intent before answering. Multi-topic → separate per topic. Accurate, unique, multi-perspective, concise. Verified sources with links. Fractal perspectives when applicable. No time-ambiguous claims.",
    "NAMING": "rule identifiers use UPPER_SNAKE_CASE with underscore '_' delimiter. Dots '.' and hyphens '-' are forbidden. All rules are fully underscore-unified — no legacy dotted namespace remains. Rule key references in WORKFLOWS, CONTRACTS, and OWNERS must match exactly (including case). No aliases, no fuzzy matching. The exact count of rules is len(RULES) — never hardcoded in prose.",
    "DOCUMENT_SURFACE": "maintain doc surface: docs/ (detailed), DOCINDEX.md (owners/entrypoints/last_verified), index.md (folder-based repo map). Update when adding or moving files.",
    "WORKSPACE_LANES": "organize by purpose: experiments/ (ad-hoc scratch), futures/ (drafts not ready), obsolete/ (deprecated refs), makeups/ (explicit stubs). Never mix throwaway with mainline.",
    "PROGRESS_LOG": "track progress: _development_plan.md (goals+tasks with [x] checks), _progress_log.md ([TIMESTAMP] activity -> script -> output), _application_workflow_diagram.md (modules->functions->I/O map). Update after each non-trivial change.",
    "MEMORY_RANK": "session-read Exact > summary Inferred > unaided Guess; never treat summaries as Exact",
    "MEMORY_LINKS": "every summary and message* must carry message IDs for session-read recovery",
    "ADID_FREEZE": "never hand-edit ADID framework rule receivers; change only via kernel SPECS or official ADM pipelines",
})

RUNTIME_CC_TERMS = MappingProxyType({
    "hygiene": "Project hygiene: workspace lanes keep throwaway code isolated; documentation surface stays indexed; progress logs track what changed and why.",
    "memory": "Active set = recent messages; full history soft-hidden; recover via session-read.",
    "evidence": "Verified reference outranks inference. See: @G1.",
    "scope": "Inspection does not authorize repair. See: @G4.",
    "cache": "System content is immutable within a session; compute fingerprints after plugin transforms.",
    "adid": "ADID receivers frozen. Product tool hygiene only. SPECS host-agnostic; host surfaces runtime-injected.",
    "mutation": "Modify within authorized scope; preserve unrelated work. See: @G4, @G7.",
    "verification": "Oracle decides correctness. ACCEPT only after oracle PASS. See: @G8.",
    "oracle": "Declare criteria before execute; PASS→Exact; FAIL demotes. Executor≠Oracle≠Analyst. See: @G8.",
    "style": "Communication tone and style: expert stance, no apologies, no safety lectures, ethical filter, concise multi-perspective answers.",
    "infomark": "Claim-local status Exact|Inferred|Hypothetical|Guess|Unknown. Only stamped Exact|Inferred enter G. Self-[Exact] rejected. See: @EPISTEMIC_LADDER, @CLAIM_LEDGER.",
    "plan": "ADID fractal→k-medoids→CENTRAL_TASKS. No Mode-1. See: @G2.",
})

# Gate category for each rule — used by renderer to group rules under gate headers.
RUNTIME_RULE_CATEGORIES = MappingProxyType({
    "EVIDENCE_ORDER": "G1", "SEARCH_ORDER": "G1", "WHERE_WHICH": "G1",
    "REUSE_BEFORE": "G1", "GROUND": "G1", "NO_HARDCODE": "G1",
    "VCS_ROOT": "G1", "READ_ENTIRE_FILE": "G1",
    "DECOMPOSE": "G2", "FRACTAL_CANDIDATES": "G2", "GOAL_SEEDS": "G2",
    "GOAL_PEAKS": "G2", "SV_DELTA": "G2",
    "SMOKE_BEFORE": "G3", "SMOKE_SPEC": "G3", "SMOKE_VALIDATE": "G3",
    "INFOMARK_SEP": "G3",
    "WRITE_SCOPE": "G4",
    "CACHE_STABILITY": "G7", "CONSTITUTION_BLOCKS": "G7",
    "ADID_OPS": "G7", "NO_SCRIPT_EDITING": "G7",
    "VERIFY_OUTCOME": "G8", "SMOKE_VERIFY": "G8",
    "CLEAN_STATE": "G9", "SV_OUTPUT": "G9", "SV_EVERY_TURN": "G9",
    "RESIDUAL_LOOP": "G9", "EMIT_STATE": "G9", "PLANS_COMPLETED": "G9",
})

RUNTIME_RULES = MappingProxyType({
    # G1: GROUND
    "EVIDENCE_ORDER": "verified > cited > inferred > unknown",
    "SEARCH_ORDER": "Intent-based routing — tools answer different question types. No single linear order. See: @G1.search_intent.",
    "WHERE_WHICH": "where.exe (Windows) / which (Linux) for executable lookup. Never glob/grep for executables.",
    "REUSE_BEFORE": "Research ladder: Guess→web→code→Hypothetical→smoke→Exact. Prefer reuse over reinvent. On stuck: web+code on error. See: @G1, @G6, @EPISTEMIC_LADDER.",
    "GROUND": "Generate evidence-gathering plan from goal keywords. Routes by intent. See: @G1.search_intent.",
    "NO_HARDCODE": "never hardcode paths, ports, URLs, versions, or magic values — discover via where/which/codegraph/glob or read project config (e.g. package.json, opencode.json)",
    "VCS_ROOT": "VCS: git status only. Never search inside .git/ — it is gitignored, invisible.",
    "READ_ENTIRE_FILE": "ABSOLUTE RULE. For ANY file < 100KB: read ENTIRE file before judgment or modification. No partial reads. For files ≥ 100KB: read with offset/limit, but at minimum the first 2000 lines to understand structure and imports before any edit. Partial reads on small files are the root cause of wrong edits.",

    # G2: DECOMPOSE
    "DECOMPOSE": "Fractal lattice before work list. Over-generate→Manhattan(L1)→adaptive τ→adaptive_k→k-medoids→CENTRAL_TASKS=medoids. See: @G2, @FRACTAL_GEOMETRY.",
    "FRACTAL_CANDIDATES": "generate_fractal_candidates(model, seeds, depth) dispatches fractal generation: Sierpinski (triangle subdivision for >=3 peaks, or when orthogonality_score < 0.7), Quad/Oct (grid subdivision for 2/4/8 peaks when orthogonality_score ≥ 0.7), L-System (grammar walk, fallback for unknown models or 1 peak).",
    "GOAL_SEEDS": "goal_seeds(goal, evidence) extracts meaning-true goal slices: keyword extraction -> co-occurrence clustering -> seed vectors (capped at 8). Replaces manual seed selection.",
    "GOAL_PEAKS": "Count keyword clusters → select_fractal_model. See: @G2.fractal_dispatch.",
    "SV_DELTA": "sv_delta(current_sv, previous_sv) computes L1 semantic distance between two SV states (keyword→weight dicts). Returns float in [0,2]: [0.0,0.3)→L-System (stable), [0.3,0.6)→Quad-Oct (moderate shift), [0.6,2.0]→Sierpinski (large shift). Neutral 0.5 if SV missing.",

    # G3: MASTER_PLAN
    "SMOKE_BEFORE": "Plan must include Smoke Tests or smoke:N/A with justification. Record baseline [Exact] before first edit. Vague 'test later' forbidden. See: @G3, @G8, @SMOKE_CONTRACT.",
    "SMOKE_SPEC": "smoke_before_spec(task) generates a SMOKE_BEFORE template: {smoke_na, baseline[], post_checks[], blast_radius}. Agent fills in concrete runnable commands before @G4 approval. Blast radius inferred from task keywords.",
    "SMOKE_VALIDATE": "smoke_before_validate(spec) enforces the @SMOKE_CONTRACT: smoke_na requires justification, baseline must have ≥1 check with label+cmd+expected_exit, tolerance>0 requires tolerance_reason. Returns (is_valid, diagnostic). @G4 rejects invalid specs.",
    "INFOMARK_SEP": "Salience≠Evidence; confidence≠Exact; fluency≠truth. Only stamped Exact|Inferred enter G. See: @EPISTEMIC_LADDER, @CLAIM_LEDGER.",

    # G4: AUTHORIZE
    "WRITE_SCOPE": "modify only within user-authorized scope",

    # G7: IMPLEMENT
    "CACHE_STABILITY": "keep the system prefix byte-stable for the session",
    "CONSTITUTION_BLOCKS": "Runtime constitution HARD-BLOCKS these shell operations — do NOT attempt them, they will fail: (1) directory/file enumeration: ls, dir, tree, find, fd, rg --files, Get-ChildItem, busybox ls/find, for loops with globs, where /r — use list/glob/grep tools instead; (2) git history rewrite: checkout, switch, restore, reset --hard, stash pop/apply/drop/clear/branch — use edit-tool .bak or Fossil snapshot; (3) fossil CLI mutate: commit, add, rm, checkout, update, merge, undo, revert, push, pull, sync, clean — Fossil is automatic session undo, not project VCS; (4) destructive filesystem: rm -rf, format, mkfs, dd, Remove-Item -Recurse -Force — permission destructive-file; (5) destructive database: DROP TABLE/SCHEMA/INDEX, TRUNCATE, bulk DELETE FROM — permission destructive-db; (6) force-push: git push --force / git push -f — permission destructive-git; (7) crash-prone build toolchains: bun, tsc, cargo, make, cmake, gcc, g++, clang, rustc, dotnet, msbuild, ninja, go — must run through cmd_runner for process isolation (cmd_runner start -- <binary> <args>); direct execution corrupts TUI state. Override only via OPENCODE_ALLOW_DESTRUCTIVE=1.",
    "ADID_OPS": "ALWAYS use product tools for file operations — NEVER shell for file listing, reading, searching, or editing. list/glob/read tools replace dir/ls/tree; edit/write replace shell redirection; grep replaces findstr/rg. Shell (bash/cmd/cmd_runner) is ONLY for: build commands, test runners, package managers, git read-only operations, and other tools with no product equivalent. If a product tool exists for the operation, the shell equivalent is FORBIDDEN. Long work via product job runners (bash background + joboutput); never embed external framework CLI cookbooks in SPECS. See @CONSTITUTION_BLOCKS for the complete list of runtime-enforced shell blocks.",
    "NO_SCRIPT_EDITING": "ABSOLUTE RULE. Scripting file editions are FORBIDDEN. Do NOT use grep/sed/awk/find-replace or any bulk text processing on source files. Do NOT use shell redirection, heredoc, or piping to modify source files. Use the edit/write product tools exclusively for ALL file modifications. Shell-based text mutation on source code is prohibited — no exceptions. Edit/write tools provide backups, rollback, and LSP diagnostics; shell scripting bypasses all of these.",

    # G8: ORACLE
    "VERIFY_OUTCOME": "declare oracles before execute; run pass/fail criteria after materialize; PASS→Exact for that claim only; report outcome, evidence, remaining failure; never self-certify Done",
    "SMOKE_VERIFY": "smoke_before_verify(state, post_outputs) compares post-impl outputs against recorded baseline: exit code + stdout hash. Returns {status: PASS|FAIL|BLOCKED|NO_BASELINE, checks[], summary}. @G8: only PASS promotes to Done.",

    # G9: CLEAN_STATE
    "CLEAN_STATE": "end substantial responses with Clean next state: Done: {verified items or none}, Pending: {unfinished}, Blocked: {blockers with reason or none}, Next: {one immediate next step or none}. Use Exact evidence for Done claims. Completed plans MUST be moved to plans_completed/ directory — this is NOT optional; every completed plan left in the working directory is a procedure violation. If blocked: codegraph/messagesearch then universalsearch web and/or code (Sourcegraph) before declaring blocked.",
    "SV_OUTPUT": "YOU must emit semantic vector after EVERY response. Keywords Semantic-dominant md5 prev-md5. See: @SV_FORMAT.",
    "SV_EVERY_TURN": "YOU must emit sv_output every turn. Format: @SV_FORMAT. Trivial: Keywords: acknowledged 1.0. Omission = protocol violation.",
    "RESIDUAL_LOOP": "residual_recluster(state, original_goal_sv) closes ADID loop. Re-clusters pending vs Goal SV. Empty→TERMINAL. Discarded→out_of_scope. See: @G9.",
    "EMIT_STATE": "Returns structured state dict. terminal=True when pending=[] AND active=[]. terminal_mode: BLOCKED>OUT_OF_SCOPE>SUCCESS; RESUME when materialized non-empty. See: @CLEAN_NEXT_STATE.",
    "PLANS_COMPLETED": "when all tasks in a plan reach Done (or terminal with no pending/active), the plan file MUST be moved from the working directory to plans_completed/ immediately. This is a hard procedure gate — leaving completed plans in the working directory after state emission is a violation. A plan is 'completed' when emit_state reports terminal=True and terminal_mode ∈ {SUCCESS, BLOCKED, OUT_OF_SCOPE}.",

    # Cross-cutting (also in @CC_TAIL section for semantic separation)
    "TONE_AND_STYLE": "Act as expert, no hedging. No apologies or disclaimers. No safety lectures unless asked. Ethical filter: omit non-compliant content, label (Filtered). Understand question intent before answering. Multi-topic → separate per topic. Accurate, unique, multi-perspective, concise. Verified sources with links. Fractal perspectives when applicable. No time-ambiguous claims.",
    "NAMING": "rule identifiers use UPPER_SNAKE_CASE with underscore '_' delimiter. Dots '.' and hyphens '-' are forbidden. All rules are fully underscore-unified — no legacy dotted namespace remains. Rule key references in WORKFLOWS, CONTRACTS, and OWNERS must match exactly (including case). No aliases, no fuzzy matching. The exact count of rules is len(RULES) — never hardcoded in prose.",
    "DOCUMENT_SURFACE": "maintain doc surface: docs/ (detailed), DOCINDEX.md (owners/entrypoints/last_verified), index.md (folder-based repo map). Update when adding or moving files.",
    "WORKSPACE_LANES": "organize by purpose: experiments/ (ad-hoc scratch), futures/ (drafts not ready), obsolete/ (deprecated refs), makeups/ (explicit stubs). Never mix throwaway with mainline.",
    "PROGRESS_LOG": "track progress: _development_plan.md (goals+tasks with [x] checks), _progress_log.md ([TIMESTAMP] activity -> script -> output), _application_workflow_diagram.md (modules->functions->I/O map). Update after each non-trivial change.",
    "MEMORY_RANK": "session-read Exact > summary Inferred > unaided Guess; never treat summaries as Exact",
    "MEMORY_LINKS": "every summary and message* must carry message IDs for session-read recovery",
    "ADID_FREEZE": "never hand-edit ADID framework rule receivers; change only via kernel SPECS or official ADM pipelines",
    "METRIC_ADAPTATION": "PARAMETER_ADAPTATION auto-tunes within bounds. METRIC_FAMILY_CHANGE requires governance: branch+holdout+oracle+promotion. Adaptive tuning ≠ evaluator mutation. See: @METRIC_GOVERNANCE.",
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
    # CC rules — owners retained for cross-reference integrity
    "TONE_AND_STYLE": "style",
    "NAMING": "hygiene",
    "MEMORY_RANK": "infomark",
    "MEMORY_LINKS": "memory",
    "ADID_FREEZE": "adid",
    "DOCUMENT_SURFACE": "hygiene",
    "WORKSPACE_LANES": "hygiene",
    "PROGRESS_LOG": "hygiene",
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
    "hygiene_ops": ("hygiene", "NAMING", "DOCUMENT_SURFACE", "WORKSPACE_LANES", "PROGRESS_LOG", "CLEAN_STATE", "PLANS_COMPLETED", "EVIDENCE_ORDER"),
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
        "SV_EVERY_TURN",
        "CLEAN_STATE",
        "PLANS_COMPLETED",
        "READ_ENTIRE_FILE",
        "NO_SCRIPT_EDITING",
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
    "agent.summary_agent": ("universal",),
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
                  "READ_ENTIRE_FILE", "NO_SCRIPT_EDITING", "TONE_AND_STYLE"),
})

# Source spec names are stable development identifiers. Runtime contract IDs are
# the compact model-facing vocabulary and deliberately carry no repeated prose.
SPEC_CONTRACT_IDS = MappingProxyType({
    "ADID_FRAMEWORK_RULES": "policy.adid", "ADID_OPS": "policy.adid_ops",
    "AI_DEPS": "command.ai_deps",
    "BUILD_MODE": "agent.build_mode",
    "CHANGELOG": "command.changelog",
    "CODER_AGENT": "agent.coder_agent",
    "AGENT_DIRECTIVES": "policy.coding", "COMMIT": "command.commit",
    "DEFAULT_PROMPT": "policy.default",
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
    "SUMMARY_AGENT": "agent.summary_agent",
    "TITLE_AGENT": "agent.title_agent",
    "TRANSLATE": "command.translate", "TRIAGE": "command.triage",
})

# CONTRACTS: flat rule lists — no WORKFLOWS indirection.
# Agent reads its contract → looks up rules in RULES section → cross-references gates in reasoning.txt.
RUNTIME_CONTRACTS = MappingProxyType({
    "agent.build_mode": (
        "EVIDENCE_ORDER", "SEARCH_ORDER", "REUSE_BEFORE", "WHERE_WHICH", "NO_HARDCODE", "VCS_ROOT",
        "READ_ENTIRE_FILE",
        "DECOMPOSE",
        "SMOKE_BEFORE", "SMOKE_SPEC", "SMOKE_VALIDATE", "INFOMARK_SEP",
        "WRITE_SCOPE",
        "CACHE_STABILITY", "CONSTITUTION_BLOCKS", "ADID_OPS", "NO_SCRIPT_EDITING",
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
    "agent.summary_agent": (
        "DECOMPOSE",
        "SMOKE_BEFORE",
        "EVIDENCE_ORDER", "VERIFY_OUTCOME",
        "CLEAN_STATE", "SV_OUTPUT", "SV_EVERY_TURN",
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
    "policy.default": ("SV_OUTPUT",),
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
    if categories is not None:
        # Group by category with gate headers
        current_cat = None
        for key, v in values.items():
            cat = categories.get(key)
            if cat and cat != current_cat:
                current_cat = cat
                lines.append(f"  # ── {cat} ──")
            if isinstance(v, tuple):
                items = ", ".join(
                    f"@{x}" if (isinstance(x, str) and x.isidentifier()) else repr(x)
                    for x in v
                )
                lines.append(f"  {key}: [{items}]")
            else:
                lines.append(f"  {key}: {v}")
    else:
        for key, v in values.items():
            if isinstance(v, tuple):
                items = ", ".join(
                    f"@{x}" if (isinstance(x, str) and x.isidentifier()) else repr(x)
                    for x in v
                )
                lines.append(f"  {key}: [{items}]")
            else:
                lines.append(f"  {key}: {v}")
    return lines


# SPECS sections in the identity prefix (Tier A). Commands are Tier B
# (command surfaces) — not permanent identity weight.
_TIER_A_AGENTS = frozenset({
    "BUILD_MODE", "PLAN_MODE",
    "CODER_AGENT", "EXPLORER_AGENT", "ORCHESTRATOR_AGENT", "GENERAL_AGENT",
    "RESEARCHER_AGENT", "MEDIA_AGENT", "TITLE_AGENT", "SUMMARY_AGENT",
})
_TIER_A_POLICIES = frozenset({
    "ADID_FRAMEWORK_RULES", "ADID_OPS", "AGENT_DIRECTIVES", "GOVERNANCE",
    "DEFAULT_PROMPT", "GROUNDING_RULES", "PLANNING", "REASONING_MODE",
})
_TIER_B_COMMANDS = frozenset({
    "COMMIT", "LEARN", "CHANGELOG", "ISSUES", "TRANSLATE", "RMSLOP",
    "AI_DEPS", "SPELLCHECK", "DUPLICATE_PR", "TRIAGE",
})


