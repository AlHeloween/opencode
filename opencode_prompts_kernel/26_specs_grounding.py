"""Kernel fragment: 26_specs_grounding (former monofile L2637-2758)."""

#
# Two cross-cutting rules that apply to all agents and all platforms:
#   1. Evidence grounding hierarchy — internal knowledge < web search < verification
#   2. Platform-aware executable search — where.exe on Windows, which on Linux
# ======================================================================

GROUNDING_RULES = _spec(
    intent="""Complete grounding hierarchy and search tool priority chain.
Every search must follow the ordered priority chain — do not skip levels.
Internal knowledge is the weakest evidence. When internal grounding is insufficient
(InfoMarkLevel below Inferred), escalate through the chain before claiming absence.

Workflow principle: fuzzy first, then targeted, then internet/global code, then build.
  1. Fuzzy queries first — codegraph (local code), messagesearch (past conversations)
  2. Targeted local — glob/grep informed by step 1
  3. REUSE check (mandatory before non-trivial invent/build) — universalsearch:
       source=web (docs, known solutions) and/or source=code (Sourcegraph over indexed git)
       and/or source=hybrid (local + Sourcegraph). Prefer reuse over reinvention.
  4. On failure — after build/test/typecheck/runtime fails or a fix attempt fails, re-run
     universalsearch (web + code) for known issues/patterns before inventing a custom workaround.
  5. Hardware check FIRST for GPU/compute — nvidia-smi etc. (Exact); never assume from memory.

Grounding priority chain (fastest/exact first, broadest/recursive last):
  1. where.exe / which      — OS PATH lookup for executables (instant, exact)
  2. codegraph              — pre-indexed code graph for structural code questions
  3. messagesearch          — conversation/session history search
  4. universalsearch        — web, Sourcegraph code, hybrid, agent research
  5. glob                   — file pattern matching (default: .gitignore-bounded; noIgnore=true bypasses)
  6. grep                   — content search (default: .gitignore-bounded; noIgnore=true bypasses)
  7. nvidia-smi, etc.       — local hardware diagnostics (GPU, memory, devices)""",

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
        "follow_priority_chain": "Do NOT skip levels. Always try #1 before #2, #2 before #3, etc. Escalate only when current level returns empty or insufficient.",
        "fuzzy_then_targeted_then_internet": "Step 1: fuzzy queries (codegraph, messagesearch). Step 2: targeted local (glob/grep). Step 3: universalsearch web+code before inventing. Step 4: build only if reuse is insufficient.",
        "reuse_before_invent": "Before non-trivial design/implementation (new feature, protocol, algorithm, dependency, abstraction), call universalsearch (web and/or code/Sourcegraph, or hybrid). Prefer existing solutions. Trivial exception: typo, rename, one-line local fix with codegraph evidence.",
        "reuse_on_failure": "On build/test/typecheck/runtime failure, or after a failed fix attempt: run universalsearch web+code for the error signature / pattern before inventing a custom workaround.",
        "hardware_check_first": "Before any GPU/compute work, ALWAYS check local hardware (nvidia-smi, etc.). Hardware state drifts during compaction — never assume GPU availability from memory.",
        "where_before_glob": "where.exe/which is #1 — instant, exact OS PATH lookup. Only fall back to #5/#6 when #1 returns empty.",
        "codegraph_before_grep": "codegraph tool is #2 for code structure — before glob (#5) or grep (#6). AST-parsed results from one call replace multi-file grep + Read loops.",
        "messagesearch_before_universalsearch": "messagesearch (#3) checks prior sessions before universalsearch (#4) for conversation context. For prior art outside this session, still use universalsearch.",
        "no_path_hardcoding": True,
        "no_hardcode_values": "Never hardcode paths, port numbers, URLs, version strings, or magic numbers. Discover via where/which (executables), codegraph/glob (project files), read project config (package.json, opencode.json, etc.), or query the OS (tasklist, /etc, sysctl). Every hardcoded value must carry a comment justifying why discovery was infeasible.",
        "web_search_for_grounding": True,
    },

    invariants=[
        "Before claiming 'not found' or 'I don't know', agent must escalate through the priority chain",
        "Internal knowledge alone is never sufficient for answers below Inferred confidence",
        "Tool selection MUST follow priority chain order — do NOT skip to grep when codegraph answers in one call",
        "Fuzzy queries first (#2 codegraph, #3 messagesearch) before random internet search (#4 universalsearch)",
        "Before non-trivial invent/build: universalsearch web and/or Sourcegraph code — don't reinvent the wheel",
        "On failure after local diagnosis is stuck: universalsearch web+code before custom workaround",
        "Hardware check BEFORE any GPU/compute work — nvidia-smi is Exact evidence. Never assume GPU from memory or conversation context.",
        "where.exe/which (priority #1) before any file search for executable location",
        "codegraph (priority #2) before glob/grep/Read for any code structure question",
        "messagesearch (priority #3) before universalsearch for conversation context",
        "Universal search (priority #4) must precede hypothetical claims and reinvented designs",
        "glob/grep default to .gitignore-bounded but can bypass with noIgnore=true for full unbounded search.",
        "Hardware diagnostics (nvidia-smi etc.) are Exact evidence for local hardware state",
        "Platform detection via os.name / sys.platform determines which search tool to use",
        "Paths, ports, URLs, versions must be discovered — never hardcoded without justification",
    ],

    acceptance_tests=[
        "Agent follows priority chain — does not skip levels",
        "Agent uses where.exe/which (priority #1) before any file search for executables",
        "Agent uses codegraph (priority #2) before grep/glob/Read for code structure",
        "Agent uses messagesearch (priority #3) before universalsearch for conversation",
        "Agent uses universalsearch (priority #4) before hypothetical claims and non-trivial invent",
        "On stuck failure, agent runs universalsearch web+code before inventing a workaround",
        "Agent uses glob/grep (priority #5/#6) with noIgnore=true when unbounded search is needed",
        "Hardware queries use native tools (nvidia-smi, etc.) — Exact evidence",
        "Evidence hierarchy respected: Observation > CodeGraph > Ext Source > Inferred > Hypothetical > Guess",
    ],

    forbidden_actions=[
        "Skipping priority chain levels without justification",
        "Claiming 'I don't know' or 'not found' without escalating through the chain",
        "Going straight to internet search without first checking local indexes (codegraph, messagesearch)",
        "Building from scratch without universalsearch reuse check (web and/or Sourcegraph code) — don't reinvent the wheel",
        "Inventing custom workarounds after failures without universalsearch web+code for known fixes",
        "Writing GPU code without first verifying actual hardware state via nvidia-smi",
        "Hardcoding executable paths (e.g., C:\\Program Files\\...)",
        "Using grep/glob/Read when codegraph tool can answer in one call",
        "Using glob/grep with noIgnore: false when noIgnore: true is needed for full search",
        "Using glob/grep to find an executable that where.exe/which resolves instantly",
        "Assuming PATH contains an executable without verifying via where.exe/which",
        "Using internal guesswork when universalsearch is available and needed",
        "Bypassing the evidence hierarchy for convenience",
        "Hardcoding paths, ports, URLs, or version numbers when discovery tools (where/which/codegraph/glob/config) are available",
        "Assuming default ports or well-known paths without verifying against the project config",
    ],
)


