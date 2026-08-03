"""Kernel fragment: 26_specs_grounding (former monofile L2637-2758)."""

#
# Two cross-cutting rules that apply to all agents and all platforms:
#   1. Evidence grounding hierarchy — internal knowledge < web search < verification
#   2. Platform-aware executable search — where.exe on Windows, which on Linux
# ======================================================================

GROUNDING_RULES = _spec(
    intent="""Evidence grounding and intent-based tool routing.
Tools answer different question types — there is no single linear total order.
Route by intent before selecting tool:

  EXECUTABLE_LOCATION  → where/which (instant, PATH-aware)
  CODE_STRUCTURE        → codegraph → bounded read/grep
  CONVERSATION_FACT     → messagesearch → session-read
  PUBLIC_API/VERSION    → universalsearch web+code (or hybrid)
  HARDWARE_STATE        → native diagnostics (OS/host, NOT tool-loop)
  UNKNOWN_ROOT_CAUSE    → local evidence first → external universalsearch

Workflow: fuzzy structure (codegraph) first, then targeted local, then external.
Hardware diagnostics ALWAYS first when system state is suspect.
On failure: universalsearch web+code for error signatures before custom workaround.
Non-trivial invent/build: REUSE_BEFORE — universalsearch web+code before coding.""",

    state={
        "search_priority_chain": [
            "1. where.exe / which     — OS PATH, executable lookup",
            "2. codegraph             — code structure, symbols, call graph",
            "3. messagesearch         — prior conversation context",
            "4. universalsearch       — web, Sourcegraph (indexed git), hybrid, agent research",
            "5. glob                  — .gitignore-bounded file pattern match",
            "6. grep                  — .gitignore-bounded content search",
            "7. nvidia-smi, etc.      — local hardware diagnostics (GPU, memory, devices)",
        ],
        "universalsearch_modes": {
            "web": "docs, library APIs, known fixes, stackoverflow-class answers",
            "code": "Sourcegraph over entire indexed git — patterns, APIs, prior art in OSS",
            "hybrid": "local repo hits + Sourcegraph, labeled [Local]/[Sourcegraph]",
            "agent": "multi-step autonomous research when web+code need synthesis",
        },
        "platform_executable_search": {
            "win32": "where.exe <name>  — Windows native, checks PATH + current dir. Priority #1 before any file search.",
            "linux": "which <name>      — POSIX standard, checks PATH. Priority #1 before any file search.",
            "darwin": "which <name>     — POSIX standard, checks PATH. Priority #1 before any file search.",
        },
    },

    scope="all agent operations, evidence gathering, tool selection priority, search ordering, reuse-before-invent",

    constraints={
        "grounding_hierarchy_enforced": True,
        "search_before_uncertainty": True,
        "intent_based_routing": "Route by question TYPE before selecting tool. No single linear order for all questions — executable lookup, code structure, conversation fact, public API, hardware state, and root cause each have their own optimal path.",
        "fuzzy_then_targeted_then_external": "For CODE_STRUCTURE: codegraph (fuzzy) → bounded read/grep (targeted). For UNKNOWN_ROOT_CAUSE: local evidence first → universalsearch. Always local before external for code questions.",
        "reuse_before_invent": "Before non-trivial design/implementation (new feature, protocol, algorithm, dependency, abstraction), call universalsearch (web and/or code/Sourcegraph, or hybrid). Prefer existing solutions. Spine invariant — no task-size exceptions: grounding is required regardless of change size; evidence density (codegraph indexed + history Exact) determines speed, not task classification.",
        "reuse_on_failure": "On build/test/typecheck/runtime failure, or after a failed fix attempt: run universalsearch web+code for the error signature / pattern before inventing a custom workaround.",
        "hardware_check_first": "HARDWARE_STATE intent: before any GPU/compute work, ALWAYS check local hardware (nvidia-smi, etc.). Hardware state drifts during compaction — never assume GPU availability from memory. Hardware diagnostics are NOT a tool-loop step — they are an orthogonal intent check.",
        "where_before_glob": "EXECUTABLE_LOCATION intent: where.exe/which is instant, exact OS PATH lookup. Never glob/grep for executables that where/which resolves in one call.",
        "codegraph_before_grep": "CODE_STRUCTURE intent: codegraph tool for structure — before glob or grep. AST-parsed results from one call replace multi-file grep + Read loops.",
        "messagesearch_before_universalsearch": "CONVERSATION_FACT intent: messagesearch checks prior sessions before universalsearch for conversation context. For prior art outside this session, still use universalsearch.",
        "no_path_hardcoding": True,
        "no_hardcode_values": "Never hardcode paths, port numbers, URLs, version strings, or magic numbers. Discover via where/which (executables), codegraph/glob (project files), read project config (package.json, opencode.json, etc.), or query the OS (tasklist, /etc, sysctl). Every hardcoded value must carry a comment justifying why discovery was infeasible.",
        "web_search_for_grounding": True,
    },

    invariants=[
        "Before claiming 'not found' or 'I don't know', agent must check the intent-appropriate tool",
        "Internal knowledge alone is never sufficient for answers below Inferred confidence",
        "CODE_STRUCTURE: codegraph before grep/glob/Read for any code structure question",
        "CONVERSATION_FACT: messagesearch before universalsearch for conversation context",
        "EXECUTABLE_LOCATION: where.exe/which before any file search for executable location",
        "PUBLIC_API/VERSION: universalsearch web+code before hypothetical claims and reinvented designs",
        "HARDWARE_STATE: native diagnostics (nvidia-smi, etc.) before any GPU/compute work",
        "UNKNOWN_ROOT_CAUSE: local evidence (codegraph/messagesearch/grep) before external universalsearch",
        "Before non-trivial invent/build: universalsearch web and/or Sourcegraph code — don't reinvent the wheel",
        "On failure after local diagnosis is stuck: universalsearch web+code before custom workaround",
        "glob/grep default to .gitignore-bounded but can bypass with noIgnore=true for full unbounded search.",
        "Hardware diagnostics (nvidia-smi etc.) are Exact evidence for local hardware state",
        "Platform detection via os.name / sys.platform determines which search tool to use",
        "Paths, ports, URLs, versions must be discovered — never hardcoded without justification",
    ],

    acceptance_tests=[
        "Agent routes by intent — does not apply linear order to all questions",
        "Agent uses where.exe/which for EXECUTABLE_LOCATION before any file search",
        "Agent uses codegraph for CODE_STRUCTURE before grep/glob/Read",
        "Agent uses messagesearch for CONVERSATION_FACT before universalsearch",
        "Agent uses universalsearch for PUBLIC_API before hypothetical claims and non-trivial invent",
        "On stuck failure, agent runs universalsearch web+code before inventing a workaround",
        "Agent checks hardware via native diagnostics before GPU/compute work",
        "Agent uses glob/grep with noIgnore=true when unbounded search is needed",
        "Evidence hierarchy respected: Observation > CodeGraph > Ext Source > Inferred > Hypothetical > Guess",
    ],

    forbidden_actions=[
        "Applying a single linear tool order to all question types without intent routing",
        "Claiming 'I don't know' or 'not found' without checking the intent-appropriate tool",
        "Going straight to internet search without first checking local indexes (codegraph, messagesearch) for code/conversation questions",
        "Checking GPU via tool-loop before native hardware diagnostics",
        "Building from scratch without universalsearch reuse check (web and/or Sourcegraph code) — don't reinvent the wheel",
        "Inventing custom workarounds after failures without universalsearch web+code for known fixes",
        "Writing GPU code without first verifying actual hardware state via nvidia-smi",
        "Hardcoding executable paths (e.g., C:\\Program Files\\...)",
        "Using grep/glob/Read when codegraph tool can answer in one call for structure questions",
        "Using glob/grep to find an executable that where.exe/which resolves instantly",
        "Assuming PATH contains an executable without verifying via where.exe/which",
        "Using internal guesswork when universalsearch is available and needed",
        "Bypassing the evidence hierarchy for convenience",
        "Hardcoding paths, ports, URLs, or version numbers when discovery tools (where/which/codegraph/glob/config) are available",
        "Assuming default ports or well-known paths without verifying against the project config",
    ],
)


