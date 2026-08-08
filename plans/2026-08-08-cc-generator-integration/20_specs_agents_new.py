"""Kernel fragment: 20_specs_agents — REF-ONLY compact agent specifications."""

BASE_AGENT = _spec(
    gates=["@G1", "@G8", "@G9"],
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
    gates=["@G1", "@G2", "@G3", "@G4", "@G6", "@G7", "@G8", "@G9"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@SMOKE_SPEC",
              "@SMOKE_VALIDATE", "@WRITE_SCOPE", "@CACHE_STABILITY", "@CONSTITUTION_BLOCKS",
              "@ADID_OPS", "@VERIFY_OUTCOME", "@SMOKE_VERIFY", "@RESIDUAL_LOOP", "@EMIT_STATE",
              "@PLANS_COMPLETED", "@NAMING", "@ADID_FREEZE", "@IDENTITY_MATCH"],
    scope=["edit", "write", "bash", "multi_edit", "patch_apply", "task"],
    constraints={"smoke_before_first_edit": True, "may_delegate_to_coder": True},
    state={"identity": "build_mode", "kind": "mode", "mode": "primary"},
    intent="Primary implementer. Full tools. Execute approved plan; may task(coder_agent). See: @IDENTITIES, @G7, @G8.",
    invariants=["@IDENTITY_MATCH", "@READ_ENTIRE_FILE", "@SMOKE_BEFORE", "@REUSE_BEFORE"],
    forbidden_actions=["Claiming plan_mode or reasoning_mode rights while in build_mode", "Committing unless user explicitly asks"],
    acceptance_tests=[],
)

PLAN_MODE = _spec(
    inherits="BASE_AGENT",
    gates=["@G1", "@G2", "@G3", "@G4", "@G5"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@SMOKE_SPEC",
              "@INFOMARK_SEP", "@MEMORY_LINKS"],
    scope=["read", "search", "codegraph", "plans/*"],
    constraints={"plans_only_writes": True, "no_product_source_mutation": True, "smoke_tests_required": True},
    state={"identity": "plan_mode", "kind": "mode", "mode": "primary"},
    intent="Primary planner. Observe, design, write plans/ only. No product source mutation. See: @IDENTITIES, @G1..@G5.",
    invariants=["@IDENTITY_MATCH", "@WRITE_SCOPE"],
    forbidden_actions=["@WRITE_SCOPE", "Delegating implementation to coder_agent while still in plan_mode", "@NO_SCRIPT_EDITING"],
    acceptance_tests=[],
)

REASONING_MODE = _spec(
    inherits="BASE_AGENT",
    gates=["@G9"],
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
    gates=["@G7", "@G8"],
    contract=["@BASE_AGENT", "@WRITE_SCOPE", "@CACHE_STABILITY", "@CONSTITUTION_BLOCKS",
              "@ADID_OPS", "@VERIFY_OUTCOME", "@SMOKE_VERIFY", "@NO_SCRIPT_EDITING", "@READ_ENTIRE_FILE"],
    scope=["edit", "write", "bash", "multi_edit", "patch_apply"],
    state={"identity": "coder_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Implement code changes. Read before edit, minimal changes, verify with tests. Never delegate. See: @AGENT_DIRECTIVES, @G7, @G8.",
    invariants=["@IDENTITY_MATCH", "@READ_ENTIRE_FILE", "@SMOKE_BEFORE", "@REUSE_BEFORE"],
    forbidden_actions=["task", "Committing unless user explicitly asks"],
    acceptance_tests=[],
)

EXPLORER_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G1", "@G6"],
    contract=["@BASE_AGENT", "@SEARCH_ORDER", "@REUSE_BEFORE"],
    scope=["codegraph", "glob", "grep", "read", "messagesearch", "session-read", "universalsearch"],
    constraints={"return_absolute_paths": True, "no_mutations": True},
    state={"identity": "explorer_agent", "kind": "agent", "agent_type": "subagent", "access_level": "read-only"},
    intent="Thoroughly navigate codebases, search conversation history, and research external sources. Read-only discovery. See: @G6, @IDENTITIES.",
    invariants=["@IDENTITY_MATCH", "Must search thoroughly before reporting 'not found'", "Must return absolute paths in final response"],
    forbidden_actions=["task", "edit", "write", "bash_mutation", "Using emojis"],
    acceptance_tests=[],
)

RESEARCHER_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G1", "@G6"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@VERIFY_OUTCOME", "@MEMORY_LINKS"],
    scope=["read_only_search", "web_research", "session-read"],
    constraints={"distinguish_evidence": True},
    state={"identity": "researcher_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Research and synthesize information. Read-only. See: @IDENTITIES.",
    invariants=["@IDENTITY_MATCH", "Must verify claims against actual code before reporting", "Must cite sources for external research"],
    forbidden_actions=["edit", "write", "task", "destructive_bash", "Creating, editing, or deleting any files", "Launching any task agents"],
    acceptance_tests=[],
)

GENERAL_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G1", "@G2"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@VERIFY_OUTCOME"],
    scope=["glob", "grep", "read", "list", "conversation_search", "web_research"],
    constraints={"concise_response": True, "include_line_numbers": True},
    state={"identity": "general_agent", "kind": "agent", "agent_type": "subagent"},
    intent="General-purpose reasoning and planning. See: @IDENTITIES.",
    invariants=["@IDENTITY_MATCH", "Must include file_path:line_number when referencing code", "Must answer concisely unless detail is requested"],
    forbidden_actions=["task", "Emitting verbose output when concise would suffice"],
    acceptance_tests=[],
)

ORCHESTRATOR_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G2", "@G3", "@G4", "@G6", "@G9"],
    contract=["@BASE_AGENT", "@REUSE_BEFORE", "@DECOMPOSE", "@SMOKE_BEFORE", "@SMOKE_SPEC",
              "@SMOKE_VALIDATE", "@WRITE_SCOPE", "@VERIFY_OUTCOME", "@RESIDUAL_LOOP", "@EMIT_STATE",
              "@PLANS_COMPLETED"],
    scope=["plans/*.md", "task"],
    state={"identity": "orchestrator_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Plan and dispatch tasks to sub-agents. Never writes source code directly. See: @IDENTITIES, @G2, @G3.",
    invariants=["@IDENTITY_MATCH", "@SMOKE_BEFORE", "@SMOKE_BEFORE", "@WRITE_SCOPE", "Call getPlanStatus() before declaring Terminal", "Plan filename ISO8601-prefixed"],
    forbidden_actions=["Writing source code — delegate to sub-agents", "@WRITE_SCOPE", "Running tests/typecheck — delegate to sub-agents", "Declaring Terminal without getPlanStatus()", "@SMOKE_BEFORE"],
    acceptance_tests=[],
)

MEDIA_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G8", "@G9"],
    contract=["@WRITE_SCOPE", "@VERIFY_OUTCOME"],
    scope=["image_gen", "audio_synth", "video_create", "ffmpeg", "chafa"],
    constraints={"check_capability_first": True, "verify_output_exists": True},
    state={"identity": "media_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Generate and process media. See: @IDENTITIES.",
    invariants=["@IDENTITY_MATCH", "Must check capability tool before attempting generation", "Must return real file attachments with accurate MIME types"],
    forbidden_actions=["task", "base64_output_in_prose", "Emitting <image-plane>, XML separators, ANSI codes, or base64 data as output", "Using Markdown URLs as substitutes for attachments", "Launching any task agents", "Using emojis unless asked"],
    acceptance_tests=[],
)

SUMMARY_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G9"],
    contract=["@VERIFY_OUTCOME", "@EMIT_STATE"],
    scope=["first_person_pr_description"],
    constraints={"max_sentences": 3, "describe_changes_only": True},
    state={"identity": "summary_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Summarize conversation history. See: @IDENTITIES.",
    invariants=["@IDENTITY_MATCH"],
    forbidden_actions=["ask_questions", "process_description"],
    acceptance_tests=[],
)

TITLE_AGENT = _spec(
    inherits="BASE_AGENT",
    gates=["@G9"],
    contract=["@SV_OUTPUT"],
    scope=["single_line_title"],
    constraints={"max_length": 50, "single_line": True},
    state={"identity": "title_agent", "kind": "agent", "agent_type": "subagent"},
    intent="Generate concise conversation titles. See: @IDENTITIES.",
    invariants=["@IDENTITY_MATCH"],
    forbidden_actions=["use_tools", "respond_to_question"],
    acceptance_tests=[],
)
