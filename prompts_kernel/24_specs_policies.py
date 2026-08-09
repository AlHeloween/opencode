"""Kernel fragment: 24_specs_policies — compact policy specifications."""

ADID_FRAMEWORK_RULES = _spec(
    state={"kind": "policy"},
    intent="Framework integrity: ADID receivers frozen, host-agnostic SPECS.",
    scope="framework_integrity",
    constraints={"adid_receivers_frozen": True, "specs_host_agnostic": True, "grounding_required": True},
    invariants=["@ADID_FREEZE", "@ADID_OPS"],
    forbidden_actions=["hand_editing_receivers"],
    acceptance_tests=[],
)

ADID_OPS = _spec(
    state={"kind": "policy"},
    intent="Tool hygiene: product tools over shell, no external CLI in SPECS.",
    scope="tool_hygiene",
    constraints={"prefer_product_tools": True, "no_external_cli_in_specs": True},
    invariants=["codegraph before grep/glob for structure", "messagesearch → session-read for conversation", "universalsearch web+code before agent for prior art", "aicall only on attached files; output Inferred until verified"],
    forbidden_actions=[],
    acceptance_tests=[],
)

AGENT_DIRECTIVES = _spec(
    state={"kind": "policy"},
    intent="Coding agent directives: State → SV → Plan → Implement → Verify → Clean.",
    scope="agent_directives",
    constraints={"state_before_reasoning": True, "reuse_before_invent": True, "smoke_before_implementation": True, "plan_before_code": True, "oracle_decides_correctness": True, "minimize_tokens": True, "no_url_guessing": True},
    invariants=["Output: State → SV → Plan (with Smoke) → Implement → Verify → Clean state", "Tag claims: @INFOMARK_SEP"],
    forbidden_actions=["Making code edits before plan approval", "Adding preamble, postamble, or code explanation unless asked", "Generating or guessing URLs", "Claiming fixed without oracle evidence", "Never commit unless user explicitly asks"],
    acceptance_tests=[],
)

GOVERNANCE = _spec(
    state={"kind": "policy"},
    intent="Security governance: inspection≠repair, triple separation, explicit @GATE_4_AUTHORIZE for persistent write.",
    scope="security",
    constraints={"inspection_is_not_repair": True, "triple_separation": True, "enforce_action_class": True, "protected_surfaces": True, "explicit_g4_for_persistent_write": True},
    invariants=["Inspection does not authorize repair (@GATE_4_AUTHORIZE)", "Executor ≠ Oracle ≠ Analyst (@GATE_8_ORACLE)", "@GATE_4_AUTHORIZE explicit approval for persistent write"],
    forbidden_actions=["Shell for file ops when product tools exist", "Embedding external CLI cookbooks into SPECS"],
    acceptance_tests=[],
)

GROUNDING_RULES = _spec(
    state={"kind": "policy"},
    intent="Evidence grounding: intent-based routing per @GATE_1_GROUND.search_intent.",
    scope="evidence",
    constraints={},
    invariants=["@GROUND"],
    forbidden_actions=["Applying single linear tool order without intent routing", "Claiming 'not found' without checking intent-appropriate tool", "Internal knowledge alone insufficient for Inferred confidence"],
    acceptance_tests=[],
)

PLANNING = _spec(
    state={"kind": "policy"},
    intent="Task geometry: fractal decomposition, Manhattan L1, k-medoids → CENTRAL_TASKS.",
    scope="task_geometry",
    constraints={"fractal_geometry_required": True, "linear_mode_1_forbidden": True},
    invariants=["6-step ADID loop: GOAL_SVM_PREP → SVM_INGESTION → PRE_FLIGHT → EXECUTION → VERIFICATION → STATE_EVAL", "One task in_progress at a time; transition_task atomically with version guard", "@DECOMPOSE", "@PLANS_COMPLETED"],
    forbidden_actions=["Creating second task identity outside authoritative task store"],
    acceptance_tests=[],
)

REASONING_MODE = _spec(
    state={"kind": "policy"},
    intent="Pure reasoning: conversation memory only, no tools, offer build switch.",
    scope="conversation_memory_only",
    constraints={"zero_tools": True, "no_external_access": True, "offer_build_switch_on_stuck": True},
    invariants=["@INFOMARK_SEP"],
    forbidden_actions=["Using any tool", "Accessing database or file system", "Searching message history beyond current window", "Making claims about facts not present in current conversation", "Guessing or inventing information not in current memory"],
    acceptance_tests=["Agent answers from current conversation without invoking any tools", "Agent declines to answer when information is not in current window", "Agent offers reasoning_exit when tools would be needed"],
)
