"""Gate add-ons for the current Codex harness.

The shared graph stays in ``source.py``. This registry only binds it to the
host's actual tools: filesystem reads/searches, surgical edits, LSP/AST
refactors, ``hub`` process control, ``eval`` Browser access, and the mounted
CodeGraph device. It deliberately does not claim a repository-local prompt
installation mechanism: that belongs to the external harness.
"""

from __future__ import annotations

from .addons import GateAddon, addon_lines_by_gate, validate_addons

__all__ = ["CODEX_GATE_ADDONS", "validate_addons", "addon_lines_by_gate"]


CODEX_GATE_ADDONS: tuple[GateAddon, ...] = (
    GateAddon(
        "G1",
        "PATH_GROUNDING",
        (
            "first read: plans/*.md, docs/.",
            "durable criteria: no permanent-memory tool is bound here, so a persisted criterion lives in plans/*.md and _progress_log.md — read them at grounding, not only after failing, and write the new criterion back.",
            "never store plans under .opencode/plans/.",
        ),
    ),
    GateAddon(
        "G1",
        "TOOL_GROUNDING",
        (
            "ground code via mounted codegraph_explore when .codegraph/ exists; otherwise Read, Glob, and Grep.",
            "file enumeration: Glob/Grep/Read — never shell ls/dir/find/cat.",
            "static web content: Read a URL; interactive/authenticated pages: Browser through Eval.",
        ),
    ),
    GateAddon(
        "G2",
        "TOOL_DECOMPOSE",
        (
            "track candidates: Todo.",
            "delegate only user-enumerated independent slices via one Task batch; preserve shared contracts in its context.",
        ),
    ),
    GateAddon(
        "G3",
        "PATH_PLANS",
        (
            "plans: plans/[ISO8601]_<description>.md; Smoke Tests before G4.",
            "plan carries the intention: <!-- intention: from_state -> to_state --> rides compaction.",
        ),
    ),
    GateAddon(
        "G4",
        "TOOL_AUTHORIZE",
        (
            "runtime ACL is authoritative; unresolved user decision -> Ask.",
            "network tools and real Browser actions are EXTERNAL_EFFECT; do not exceed the user-authorized effect.",
            "kernel source: prompt_kernel/source.py -> python -m prompt_kernel --install; the installed .txt is generated, never hand-edited.",
        ),
    ),
    GateAddon(
        "G6",
        "TOOL_BINDING",
        (
            "map symbols and ownership: codegraph_explore; use LSP definition, references, and implementation for language-aware impact.",
            "LSP rename/code-action precedes textual cross-file refactors; task grounding is read-only.",
        ),
    ),
    GateAddon(
        "G7",
        "PATH_PROGRESS",
        (
            "one _progress_log.md [TIMESTAMP] entry per bounded task.",
        ),
    ),
    GateAddon(
        "G7",
        "TOOL_IMPLEMENT",
        (
            "mutate existing files with Edit and new files with Write; use AST Edit only for structural codemods.",
            "shell executes binaries or short fact pipelines only; never browse files through shell.",
        ),
    ),
    GateAddon(
        "G7",
        "TOOL_DELEGATE",
        (
            "delegate through Task: hand it the task binding, the falsifier, and the parent intention verbatim, and withhold the answer you expect — a brief that names the conclusion buys confirmation.",
            "a batch runs unattended and reports once: never state a pending result, and re-brief a follow-up slice instead of assuming it kept the earlier context.",
        ),
    ),
    GateAddon(
        "G7",
        "PROCESS_LAUNCH",
        (
            "persistent services, watchers, debuggers, and REPLs start through Hub; do not daemonize them through Bash.",
            "use Hub logs, wait, send, stop, and restart by stable process name; never sleep-retry a process.",
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            "prove via the narrowest instrument; long, interactive, or crash-prone Windows commands use the cmd_runner skill.",
            "rendered web claims require Browser through Eval with an observed page/screenshot; typecheck is not a visual oracle.",
            "read artifacts and logs with Read; shell directory scans are not evidence.",
            "no isolated model call is bound here, and a Task shares this frame: a verdict about your own reasoning has no outside falsifier, so it closes Inferred or Unknown rather than as a stamp.",
        ),
    ),
    GateAddon(
        "G9",
        "PATH_CLOSURE",
        (
            "done -> plans_completed/; scan plans for stale refs.",
            "behavior/paths changed -> update docs/ and repo index.",
            "deprecated -> obsolete/ (reference only).",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_CLOSURE",
        (
            "verify scoped working-tree state before closure; no message-search tool exists.",
            "compact at a closed boundary and treat the fold as lossy: criteria, falsifiers and the open residual go into plans/, docs/ and _progress_log.md first, because nothing here carries them across verbatim.",
            "a smoke-tested MCP contract is Exact; live response shape remains Hypothetical until run live.",
        ),
    ),
)
