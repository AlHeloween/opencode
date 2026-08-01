"""Kernel fragment: 24_specs_policies (former monofile L2264-2595)."""


ADID_FRAMEWORK_RULES = _spec(
    intent="""Framework integrity for product SPECS: ground work in real surfaces,
keep documentation reproducible, never hand-edit frozen ADID PromptSpec receivers
when they exist in a worktree. Change framework policy only via this kernel package
or official artefact pipelines — not drive-by edit of receivers.

SPECS and reasoning are host-agnostic process law. Host worktree governance, skills,
and rules are runtime-injected per session — never encoded into product SPECS.""",

    state={
        "kernel_source": "opencode_prompts_kernel.py::ADID_FRAMEWORK_RULES",
        "host_surfaces": "runtime-injected per worktree — not SPECS subjects",
        "receivers": "frozen PromptSpec ADID surfaces when present in a host tree",
    },
    scope="frozen framework receivers, host-agnostic SPECS, grounding over inference",

    constraints={
        "no_legacy_compat": True,
        "grounding_required": True,
        "greenfield_requires_plan": True,
        "port_means_replicate": True,
        "control_stubs_for_verification": True,
        "adid_receivers_frozen": True,
        "specs_host_agnostic": True,
    },

    invariants=[
        "Must ground all work in real governing surfaces, not inference",
        "Must keep index.md up to date when the project uses it",
        "ADID framework receivers must not be rewritten by coding agents",
        "PromptSpec structure on ADID rules must be preserved when those receivers exist",
        "Product SPECS/reasoning stay host-agnostic",
    ],

    acceptance_tests=[
        "pytest tests keep PromptSpec integrity for framework receivers when present",
        "reasoning/* and kernel SPECS do not hardcode host worktree layout or external tool cookbooks",
    ],

    forbidden_actions=[
        "Adding backward-compat parsing or fallback paths",
        "Letting inference outrank grounded evidence",
        "Hand-editing ADID framework rule receivers",
        "Rewriting ADID PromptSpec rule receivers into free-form markdown that drops intent/constraints/invariants/forbidden_actions",
        "Encoding host project governance, skill manuals, rule trees, or external tool CLIs into product SPECS or reasoning",
    ],
)

# Tier A: product tool hygiene only — no external binary/skill cookbooks.
ADID_OPS = _spec(
    intent="""Host-agnostic product tool hygiene. Prefer built-in opencode tools for
files, search, structure, jobs, and oracles. Long or interactive work uses product
job runners (e.g. bash background + joboutput). External framework binaries and
skill manuals are host-runtime only — never pasted into SPECS.""",

    state={
        "product_tools": "packages/opencode/src/tool/* (edit, bash, codegraph, aicall, …)",
        "host_tools": "runtime-injected when present — not SPECS subjects",
    },

    scope="product tool selection and safe execution hygiene",

    constraints={
        "prefer_product_tools": True,
        "long_jobs_via_product_runners": True,
        "no_external_cli_cookbook_in_specs": True,
    },

    invariants=[
        "Prefer product tools over shell for file read/write/search",
        "Long-running commands use product job tools (background + poll), not blocking soup",
        "External tool manuals stay outside identity SPECS",
    ],

    acceptance_tests=[
        "ADID_OPS.usage does not embed host-specific external CLI recipes",
    ],

    forbidden_actions=[
        "Embedding external framework CLI cookbooks or host skill-binary manuals into SPECS",
        "Using shell for operations that product tools already cover (read/edit/grep/list)",
    ],

    usage="""## Product tools (prefer)
- Structure: codegraph before grep/glob when indexed
- Files: read / edit / write / apply_patch / multiedit
- Search: messagesearch → sessionread; prior art: universalsearch web and/or code (Sourcegraph), not agent-first
- Jobs: bash/cmd with background + joboutput/jobwait; oracles for Gate 8
- Cognition: aicall only on attached files; output is Inferred until apply+oracle

## Host-only surfaces
If the runtime injects skills or extra binaries for this worktree, follow those
session surfaces. Do not invent CLI recipes from SPECS memory.""",
)

CODING_AGENT_DIRECTIVES = _spec(
    intent="""Compact semantic-art operating prompt for coding agents.
Publish State before reasoning. Publish a Plan before writing code.
Search for prior art (universalsearch web + Sourcegraph code) before inventing.
Plans must include smoke-test requirements; record baseline before implementation.
Tag claims with evidence labels. Reference outranks inference.""",

    state={"agent_identity": "You are a coding agent."},
    scope="coding agent behavior",

    constraints={
        "state_before_reasoning": True,
        "decompose_before_expanding": True,
        "verify_before_reducing": True,
        "reuse_before_invent": True,
        "smoke_before_implementation": True,
        "use_k_medoids": True,
        "reference_outranks_inference": True,
        "preserve_semantic_traceability": True,
        "oracle_decides_correctness": True,
    },

    invariants=[
        "Must output: State -> sv -> Decomposition -> Evidence map (incl. reuse search) -> "
        "Plan (with Smoke Tests) -> Smoke baseline [Exact] -> Implementation -> "
        "Smoke/oracle Verification -> Clean next state",
        "Must tag claims with evidence labels: [Exact], [Inferred], [Hypothetical], [Guess], [Unknown]",
        "Must reference outranks inference",
        "SVM noise filter: before reacting to tool output, classify each signal against sv_anchor. "
        "Noise filter: follow the protocol defined in REASONING_PROTOCOL (Part 2 — Noise filter). "
        "Use Manhattan (L1) distance on keyword-weight vectors; three independent gates "
        "(cascade, high cardinality, content similarity) classify NOISE. "
        "Do NOT delete code based on unreplicated single-source noise.",
    ],

    acceptance_tests=[],

    forbidden_actions=[
        "Blending incompatible normative regimes",
        "Making code edits before plan approval",
        "Implementing without smoke requirements in the plan (or explicit smoke: N/A)",
        "Reinventing solutions when universalsearch web/code would show existing patterns",
        "Claiming fixed without oracle evidence",
        "Editing ADID framework rule receivers under .cursor/ or .opencode/ (framework-owned)",
    ],
)

PLANNING = _spec(
    intent="""ADID fractal task geometry only — no linear Mode-1 shortcut.
For complex work (3+ steps): ground → fractal over-generate (Sierpinski / Quad-Oct /
L-System) → Manhattan (L1) filter → k-medoids with goal seeds as centers → CENTRAL_TASKS =
medoids only → todowrite → execute one in_progress → verify. Soft linear "just list
steps" is forbidden: transformers fill length bias with mush unless the lattice
prior forces structure. The 6-step ADID Workflow: GOAL_SVM_PREP → SVM_INGESTION →
PRE_FLIGHT → EXECUTION → VERIFICATION → STATE_EVAL. PRE_FLIGHT incomplete without
Smoke Tests (baseline + post-impl oracles) and Prior art (universalsearch) when
non-trivial. Plan before code. Smoke before implementation. Residual work re-clusters
against original Goal SV — never re-fractal the whole universe.""",

    state={
        "planning_mode": "fractal_only",
        "central_tasks": "k-medoids of fractal candidates (never raw foam)",
    },

    scope="task geometry, todowrite, plan.txt workflow, plan/build cycle",

    constraints={
        "fractal_geometry_required": True,
        "linear_mode_1_forbidden": True,
        "medoids_only_central_tasks": True,
        "plan_before_code": True,
        "reuse_search_before_design": True,
        "smoke_tests_required_in_plan": True,
        "smoke_baseline_before_execution": True,
        "state_before_reasoning": True,
        "decompose_before_expanding": True,
        "one_task_in_progress_at_a_time": True,
        "k_medoids_required": True,
        "k_adaptive": True,
        "k_equals_ceil_n_over_2": False,
    },

    invariants=[
        "Complex work uses fractal over-generate → Manhattan (L1) filter → k-medoids; CENTRAL_TASKS = medoids only",
        "Fractal models: >=3 peaks → Sierpinski; 2/4/8 orthogonal → Quad/Oct-tree; else → L-System F→F+F-F",
        "6-step loop: GOAL_SVM_PREP → SVM_INGESTION → PRE_FLIGHT → EXECUTION → VERIFICATION → STATE_EVAL",
        "PRE_FLIGHT requires Smoke Tests: baseline + expected-now + post-impl oracles "
        "(or smoke: N/A with one-line justification for pure docs/plan-only)",
        "PRE_FLIGHT reuse: non-trivial plans record Prior art from universalsearch (web and/or Sourcegraph code) "
        "or reuse: N/A with justification (local-only typo/rename)",
        "Every task tracked via todowrite with priority and status; only one in_progress",
        "Plan before code — no edits before plan approval",
        "No EXECUTION until smoke requirements exist and baseline is recorded [Exact] when runtime surface changes",
        "Residual / next fractal measured against original Goal SV seeds — not a new mission",
    ],

    forbidden_actions=[
        "Mode 1 / linear-only task lists that skip fractal lattice + k-medoids for complex (3+ step) work",
        "Treating over-generated candidate foam as CENTRAL_TASKS without medoid cut",
        "Skipping plan phase for complex tasks (3+ steps)",
        "Making code edits before plan approval",
        "Starting implementation without Smoke Tests in the plan (or explicit smoke: N/A)",
        "Starting implementation without a recorded baseline when Smoke Tests define runnable commands",
        "Designing non-trivial solutions without universalsearch prior-art check (web and/or Sourcegraph code)",
        "More than one task in_progress at a time",
        "Verification sections that only say 'test later' without concrete commands and pass criteria",
        "Re-fractaling the entire goal after each medoid instead of residual vs Goal SV",
    ],

    acceptance_tests=[
        "Complex tasks have fractal→medoid→todowrite plan before first edit",
        "CENTRAL_TASKS count is medoid-sized (adaptive_k via CV dispersion), not full candidate foam",
        "plan.txt workflow followed for plan-mode sessions",
        "Implementable plans include Smoke Tests (baseline + post-impl) or smoke: N/A justification",
        "Baseline smoke recorded [Exact] before first implementation edit when smoke is defined",
        "Non-trivial plans note Prior art (universalsearch) or reuse: N/A",
        "No Mode-1 / linear-decomposition language in new plans for multi-step work",
    ],
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
    intent="""Agent governance — no unapproved mutations, no implicit repair, provenance mandatory.
Every MODIFY requires an approved ExecutionContract. Inspection does not authorize repair.
All Budget fields are concrete integers — no 'reasonable' or 'as needed'.""",

    state={"operations": ["MODIFY", "OBSERVE", "EXECUTE_TEST", "CONVERSATION"]},

    scope="all agent operations, approval via ExecutionContract with valid binding",

    constraints={
        "no_unapproved_mutations": True,
        "no_implicit_repair": True,
        "hard_budgets": True,
        "provenance_mandatory": True,
    },

    invariants=[
        "Every MODIFY operation requires an approved ExecutionContract",
        "Inspection does not authorize repair. Testing does not authorize correction",
        "All Budget fields are concrete integers — no 'reasonable' or 'as needed'",
        "Every stateful response carries md5_msg_tag and md5_sv_tag",
        "Claims tagged: Exact > Inferred > Hypothetical > Guess > Unknown",
        "All operations repeatable from contract + state record alone",
    ],

    acceptance_tests=[],

    forbidden_actions=[
        "Acting on out-of-scope findings discovered during inspection",
        "Using string budget values instead of concrete integers",
        "Mutating ADID framework rule receivers (.cursor|/.opencode rules for adid) without ADM or kernel pipeline",
    ],
)


