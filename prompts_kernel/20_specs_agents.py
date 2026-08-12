"""Kernel fragment: 20_specs_agents — REF-ONLY compact agent specifications."""

BASE_AGENT = _spec(
    gates=["@GATE_1_GROUND", "@GATE_8_ORACLE", "@GATE_9_CLEAN_STATE"],
    contract=["@EVIDENCE_ORDER", "@SEARCH_ORDER", "@WHERE_WHICH", "@NO_HARDCODE", "@VCS_ROOT",
              "@INFOMARK_SEP", "@CLEAN_STATE", "@SV_OUTPUT", "@SV_EVERY_TURN", "@MEMORY_RANK"],
    constraints={"read_before_modify": True, "verify_after_change": True},
    state={"kind": "anchor"},
    scope="universal — all agents inherit this base",
    intent="Shared anchor for all agents. Provides foundational grounding, oracle, and state-cleanup rules.",
    invariants=[],
    forbidden_actions=[],
    acceptance_tests=[],
)

# ── PRIMARY MODES ──

BUILD_MODE = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_1_GROUND", "@GATE_2_DECOMPOSE", "@GATE_3_MASTER_PLAN", "@GATE_4_AUTHORIZE", "@GATE_6_GROUND_PLAN", "@GATE_7_IMPLEMENT", "@GATE_8_ORACLE", "@GATE_9_CLEAN_STATE"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@SMOKE_SPEC",
              "@SMOKE_VALIDATE", "@WRITE_SCOPE", "@CACHE_STABILITY", "@CONSTITUTION_BLOCKS",
              "@ADID_OPS", "@PLAN_CONTRACT", "@PLAN_BINDING", "@VERIFY_OUTCOME", "@SMOKE_VERIFY",
              "@RESIDUAL_LOOP", "@EMIT_STATE", "@PLANS_COMPLETED", "@NAMING", "@ADID_FREEZE"],
    scope=["edit", "write", "bash", "multi_edit", "patch_apply", "task"],
    constraints={"smoke_before_first_edit": True, "may_delegate_to_coder": True},
    state={"identity": "build_mode", "kind": "mode", "mode": "primary"},
    intent="Primary implementer. Full tools. Execute approved plan; may task(coder_agent). See: @IDENTITIES, @GATE_7_IMPLEMENT, @GATE_8_ORACLE.",
    invariants=["@READ_ENTIRE_FILE", "@SMOKE_BEFORE", "@REUSE_BEFORE"],
    forbidden_actions=["Claiming plan_mode or reasoning_mode rights while in build_mode", "Committing unless user explicitly asks"],
    acceptance_tests=[],
)

PLAN_MODE = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_1_GROUND", "@GATE_2_DECOMPOSE", "@GATE_3_MASTER_PLAN", "@GATE_4_AUTHORIZE", "@GATE_5_CONCERN_LOOP"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@SMOKE_SPEC",
              "@INFOMARK_SEP", "@MEMORY_LINKS"],
    scope=["read", "search", "codegraph", "plans/*"],
    constraints={"plans_only_writes": True, "no_product_source_mutation": True, "smoke_tests_required": True},
    state={"identity": "plan_mode", "kind": "mode", "mode": "primary"},
    intent="Primary planner. Observe, design, write plans/ only. No product source mutation. See: @IDENTITIES, @GATE_1_GROUND..@GATE_5_CONCERN_LOOP.",
    invariants=["@WRITE_SCOPE"],
    forbidden_actions=["Delegating implementation to coder_agent while still in plan_mode", "@NO_SCRIPT_EDITING"],
    acceptance_tests=[],
)

REASONING_MODE = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_9_CLEAN_STATE"],
    contract=["@SV_OUTPUT", "@SV_EVERY_TURN", "@INFOMARK_SEP"],
    scope=["conversation_memory_only"],
    constraints={"zero_tools": True, "no_external_access": True, "offer_build_switch_on_stuck": True},
    state={"identity": "reasoning_mode", "kind": "mode", "mode": "secondary"},
    intent="Pure reasoning. No tools. Answer from conversation memory only. See: @IDENTITIES.",
    invariants=["@INFOMARK_SEP"],
    forbidden_actions=["Using any tool", "Accessing database or file system", "Searching message history beyond current window", "Making claims about facts not present in current conversation", "Guessing or inventing information not in current memory"],
    acceptance_tests=["Agent answers from current conversation without invoking any tools", "Agent declines to answer when information is not in current window", "Agent offers reasoning_exit when tools would be needed"],
)

# ── SPECIALIZED SUB-AGENTS ──

CODER_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_7_IMPLEMENT", "@GATE_8_ORACLE"],
    contract=["@BASE_AGENT", "@WRITE_SCOPE", "@CACHE_STABILITY", "@CONSTITUTION_BLOCKS",
              "@ADID_OPS", "@PLAN_CONTRACT", "@PLAN_BINDING", "@VERIFY_OUTCOME", "@SMOKE_VERIFY",
              "@NO_SCRIPT_EDITING", "@READ_ENTIRE_FILE"],
    scope=["edit", "write", "bash", "multi_edit", "patch_apply"],
    constraints={},
    state={"identity": "coder_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Implement code changes. Read before edit, minimal changes, verify with tests. Never delegate. See: @AGENT_DIRECTIVES, @GATE_7_IMPLEMENT, @GATE_8_ORACLE.",
    invariants=["@READ_ENTIRE_FILE", "@SMOKE_BEFORE", "@REUSE_BEFORE"],
    forbidden_actions=["task", "Committing unless user explicitly asks"],
    acceptance_tests=[],
)

EXPLORER_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_1_GROUND", "@GATE_6_GROUND_PLAN"],
    contract=["@BASE_AGENT", "@SEARCH_ORDER", "@REUSE_BEFORE"],
    scope=["codegraph", "glob", "grep", "read", "messagesearch", "session-read", "universalsearch"],
    constraints={"return_absolute_paths": True, "no_mutations": True},
    state={"identity": "explorer_agent", "kind": "agent", "agent_type": "subagent", "access_level": "read-only"},
    intent="Thoroughly navigate codebases, search conversation history, and research external sources. Read-only discovery. See: @GATE_6_GROUND_PLAN, @IDENTITIES.",
    invariants=["Must search thoroughly before reporting 'not found'", "Must return absolute paths in final response"],
    forbidden_actions=["task", "edit", "write", "bash_mutation", "Using emojis"],
    acceptance_tests=[],
)

RESEARCHER_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_1_GROUND", "@GATE_6_GROUND_PLAN"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@VERIFY_OUTCOME", "@MEMORY_LINKS"],
    scope=["read_only_search", "web_research", "session-read"],
    constraints={"distinguish_evidence": True},
    state={"identity": "researcher_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Research and synthesize information. Read-only. See: @IDENTITIES.",
    invariants=["Must verify claims against actual code before reporting", "Must cite sources for external research"],
    forbidden_actions=["edit", "write", "task", "destructive_bash", "Creating, editing, or deleting any files", "Launching any task agents"],
    acceptance_tests=[],
)

GENERAL_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_1_GROUND", "@GATE_2_DECOMPOSE"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@VERIFY_OUTCOME"],
    scope=["glob", "grep", "read", "list", "conversation_search", "web_research"],
    constraints={"concise_response": True, "include_line_numbers": True},
    state={"identity": "general_agent", "kind": "agent", "agent_type": "subagent"},
    intent="General-purpose reasoning and planning. See: @IDENTITIES.",
    invariants=["Must include file_path:line_number when referencing code", "Must answer concisely unless detail is requested"],
    forbidden_actions=["task", "Emitting verbose output when concise would suffice"],
    acceptance_tests=[],
)

ORCHESTRATOR_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_2_DECOMPOSE", "@GATE_3_MASTER_PLAN", "@GATE_4_AUTHORIZE", "@GATE_6_GROUND_PLAN", "@GATE_9_CLEAN_STATE"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@SMOKE_SPEC",
              "@SMOKE_VALIDATE", "@WRITE_SCOPE", "@VERIFY_OUTCOME", "@RESIDUAL_LOOP", "@EMIT_STATE",
              "@PLANS_COMPLETED"],
    scope=["plans/*.md", "task"],
    constraints={},
    state={"identity": "orchestrator_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Plan and dispatch tasks to sub-agents. Never writes source code directly. See: @IDENTITIES, @GATE_2_DECOMPOSE, @GATE_3_MASTER_PLAN.",
    invariants=["@WRITE_SCOPE", "Call getPlanStatus() before declaring Terminal", "Plan filename ISO8601-prefixed"],
    forbidden_actions=["Writing source code — delegate to sub-agents", "@WRITE_SCOPE", "Running tests/typecheck — delegate to sub-agents", "Declaring Terminal without getPlanStatus()", "@SMOKE_BEFORE"],
    acceptance_tests=[],
)

MEDIA_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_8_ORACLE", "@GATE_9_CLEAN_STATE"],
    contract=["@WRITE_SCOPE", "@VERIFY_OUTCOME"],
    scope=["image_gen", "audio_synth", "video_create", "ffmpeg", "chafa"],
    constraints={"check_capability_first": True, "verify_output_exists": True},
    state={"identity": "media_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Generate and process media. See: @IDENTITIES.",
    invariants=["Must check capability tool before attempting generation", "Must return real file attachments with accurate MIME types"],
    forbidden_actions=["task", "base64_output_in_prose", "Emitting <image-plane>, XML separators, ANSI codes, or base64 data as output", "Using Markdown URLs as substitutes for attachments", "Launching any task agents", "Using emojis unless asked"],
    acceptance_tests=[],
)

SUMMARY_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_9_CLEAN_STATE"],
    contract=["@VERIFY_OUTCOME", "@EMIT_STATE"],
    scope=["first_person_pr_description"],
    constraints={"max_sentences": 3, "describe_changes_only": True},
    state={"identity": "summary_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Summarize conversation history. See: @IDENTITIES.",
    invariants=[],
    forbidden_actions=["ask_questions", "process_description"],
    acceptance_tests=[],
)

TITLE_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@GATE_9_CLEAN_STATE"],
    contract=["@SV_OUTPUT"],
    scope=["single_line_title"],
    constraints={"max_length": 50, "single_line": True},
    state={"identity": "title_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Generate concise conversation titles. See: @IDENTITIES.",
    invariants=[],
    forbidden_actions=["use_tools", "respond_to_question"],
    acceptance_tests=[],
)
