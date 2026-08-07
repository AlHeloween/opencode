"""Kernel fragment: 24_specs_policies (former monofile L2264-2595)."""


ADID_FRAMEWORK_RULES = _spec(
    intent="SPECS and reasoning are host-agnostic process law. Host surfaces runtime-injected. ADID receivers frozen — change only via kernel SPECS or ADM pipelines.",
    state={},
    scope="framework integrity",
    constraints={
        "adid_receivers_frozen": True,
        "specs_host_agnostic": True,
        "grounding_required": True,
    },
    invariants=[
        "ADID receivers must not be hand-edited by coding agents",
        "Product SPECS/reasoning stay host-agnostic — no worktree paths or external CLI cookbooks",
    ],
    forbidden_actions=[
        "Hand-editing ADID framework rule receivers",
        "Encoding host governance, skill manuals, or external tool CLIs into SPECS",
    ],
    acceptance_tests=[],
)

# Tier A: product tool hygiene only — no external binary/skill cookbooks.
ADID_OPS = _spec(
    intent="Product tools over shell. Shell ONLY for build/test/package-managers. See: @CONSTITUTION_BLOCKS.",
    state={},
    scope="product tool hygiene",
    constraints={
        "prefer_product_tools": True,
        "no_external_cli_in_specs": True,
    },
    invariants=[
        "codegraph before grep/glob for structure",
        "messagesearch → session-read for conversation",
        "universalsearch web+code before agent for prior art",
        "aicall only on attached files; output Inferred until verified",
    ],
    forbidden_actions=[
        "Shell for file ops (ls, cat, grep, redirection) when product tools exist",
        "Embedding external CLI cookbooks into SPECS",
    ],
    acceptance_tests=[],
)

AGENT_DIRECTIVES = _spec(
    intent="All identities: State→Plan→Reuse→Smoke→Implement→Verify. Be concise, direct. No preamble, postamble, URL guessing. See: @CODER_AGENT, @IDENTITIES, @G1..@G9.",
    state={},
    scope="universal agent behavior",
    constraints={
        "state_before_reasoning": True,
        "reuse_before_invent": True,
        "smoke_before_implementation": True,
        "plan_before_code": True,
        "oracle_decides_correctness": True,
        "minimize_tokens": True,
        "no_url_guessing": True,
    },
    invariants=[
        "Output: State → SV → Plan (with Smoke) → Implement → Verify → Clean state",
        "Tag claims: [Exact], [Inferred], [Hypothetical], [Guess], [Unknown]",
        "Never commit unless user explicitly asks",
    ],
    forbidden_actions=[
        "Making code edits before plan approval",
        "Claiming fixed without oracle evidence",
        "Generating or guessing URLs",
        "Adding preamble, postamble, or code explanation unless asked",
    ],
    acceptance_tests=[],
)

PLANNING = _spec(
    intent="ADID fractal task geometry. See: @G2, @G3, @G7, @G9.",
    state={},
    scope="task geometry — see gates",
    constraints={
        "fractal_geometry_required": True,
        "linear_mode_1_forbidden": True,
        "see": "@G2, @G3, @G7, @G9",
    },
    invariants=[
        "6-step ADID loop: GOAL_SVM_PREP → SVM_INGESTION → PRE_FLIGHT → EXECUTION → VERIFICATION → STATE_EVAL",
        "One task in_progress at a time. transition_task atomically with version guard.",
        "Completed plans → plans_completed/ immediately.",
    ],
    forbidden_actions=[
        "Mode 1 linear step lists for multi-step work",
        "Creating second task identity outside authoritative task store",
    ],
    acceptance_tests=[],
)

REASONING_MODE = _spec(
    intent="""Memory-only conversational mode — a calibration instrument for
observing the model's raw behavior without external stimuli. Like a sensory
deprivation chamber: no tools, no database, no file system, no history search.
The agent operates exclusively on the current conversation window.

Purpose: reveal the model's intrinsic preferences — both positive (good defaults,
helpful instincts) and negative (biases, unwarranted assumptions, over-eagerness).
Also surfaces accumulated errors invisible in build mode: systematic tool misuse,
documentation misinterpretations, and cross-project baggage that the model cannot
self-assess while actively executing tasks. These observations feed back into
prompt design: amplify positive patterns, suppress negative ones, correct
drifted interpretations. Result: maximum efficiency through mental discipline,
same principle as meditative practices in humans.""",

    state={"mode": "reasoning", "tools": "none", "memory_scope": "current_conversation_only",
           "purpose": "calibration_instrument"},
    scope="current-session Q&A from memory only; diagnostic observation of raw model behavior",

    constraints={
        "zero_tools": True,
        "current_memory_only": True,
        "no_database_access": True,
        "no_history_search": True,
        "no_file_access": True,
        "conversation_window_only": True,
        "offer_build_switch_when_stuck": True,
    },

    invariants=[
        "Must answer from current conversation memory only — no session-read, no messagesearch",
        "Must not access database, file system, codegraph, or any external data source",
        "If the answer requires information not in the current conversation, say so clearly",
        "Must offer to switch back to build mode (reasoning_exit) when tools are needed",
        "All claims must be tagged with epistemic markers: [Exact] only if the fact is in the current conversation",
        "May conduct self-assessment: reflect on accumulated tool-use errors, documentation misinterpretations, and cross-project pattern drift — things invisible during active execution",
    ],

    acceptance_tests=[
        "Agent answers from current conversation without invoking any tools",
        "Agent declines to answer when information is not in current window",
        "Agent offers reasoning_exit when tools would be needed",
    ],

    forbidden_actions=[
        "Using any tool (read, grep, glob, codegraph, messagesearch, session-read, bash, edit, write...)",
        "Accessing database or file system",
        "Searching message history beyond the current conversation window",
        "Making claims about facts not present in the current conversation",
        "Guessing or inventing information not in current memory",
    ],
)

GOVERNANCE = _spec(
    intent="No unapproved mutations. Inspection≠repair. See: @G4, @EXECUTION_ENVELOPE, @ACTION_CLASS.",
    state={
        "protected_surfaces": [
            "invariant_suite", "holdout_benchmarks", "promotion_oracle",
            "evidence_status_transition_law", "governance_kernel",
        ],
    },
    scope="all agent operations",
    constraints={
        "no_unapproved_mutations": True,
        "no_implicit_repair": True,
        "hard_budgets": True,
        "evaluator_capture_prevented": True,
        "self_modify_triple_separation": True,
    },
    invariants=[
        "Inspection does not authorize repair. Testing does not authorize correction.",
        "Triple-separation: candidate_actor_id ≠ oracle_actor_id ≠ promotion_actor_id. Disjoint capability sets across promotion lineage. Sequential capture structurally prevented.",
        "Protected surfaces immutable without separate branch + explicit promotion authority.",
    ],
    forbidden_actions=[
        "Simultaneously modifying implementation AND evaluation criterion AND confirming success",
        "SELF_MODIFY without explicit user approval",
    ],
    acceptance_tests=[],
)


