"""Gate addons for the Claude Code CLI host.

Same gate graph as `.addons` (opencode); different tool bindings. Claude Code
exposes Read/Edit/Write/Glob/Grep, a Bash tool (POSIX/git-bash) and a
PowerShell tool side by side, an Agent tool for sub-tasks, AskUserQuestion,
and a Monitor tool (deferred) plus a `run_in_background` flag for long-lived
processes — it has no cmd_runner, applypatch, multiedit, getmode,
messagesearch, logsearch, dbread, or nssm-equivalent tool. Where a CodeGraph
MCP tool / `.codegraph/` index is present, it plays the same role opencode's
`codegraph` tool plays. Project-specific MCP servers (e.g. the
`openrouter-free-mcp` server under this repo, exposing `list_free_models`
and `call_model`) get the same evidence discipline as any other tool: read
calls are free grounding, network calls are EXTERNAL_EFFECT gated behind
explicit authorization, and a sandbox-blocked call is Unknown, not proof of
failure.
"""

from __future__ import annotations

from .addons import GateAddon, addon_lines_by_gate, validate_addons

__all__ = ["CLAUDE_GATE_ADDONS", "validate_addons", "addon_lines_by_gate"]


CLAUDE_GATE_ADDONS: tuple[GateAddon, ...] = (
    GateAddon(
        "G1",
        "PATH_GROUNDING",
        (
            "first read: AGENTS.md, plans/*.md, docs/.",
            "never store plans under .claude/plans/.",
        ),
    ),
    GateAddon(
        "G1",
        "TOOL_GROUNDING",
        (
            "ground via: codegraph_explore (if .codegraph/), Read, Grep/Glob, WebFetch/WebSearch.",
            "file enumeration: Glob/Grep/Read — never shell ls/dir/find/cat (hard-blocked).",
            "platform: Windows = Bash or PowerShell tool; never mix syntaxes.",
            "openrouter-free-mcp: list_free_models is discovery; call_model is a network call, not local evidence.",
        ),
    ),
    GateAddon(
        "G2",
        "TOOL_DECOMPOSE",
        (
            "track candidates: TodoWrite if available, else inline in the plan file.",
        ),
    ),
    GateAddon(
        "G3",
        "PATH_PLANS",
        (
            "plans: plans/[ISO8601]_<description>.md; Smoke Tests before G4.",
        ),
    ),
    GateAddon(
        "G4",
        "TOOL_AUTHORIZE",
        (
            "permission/identity uncertain -> defer to the harness's prompt; unresolved decision -> AskUserQuestion.",
            "network-calling MCP tools (e.g. call_model) are EXTERNAL_EFFECT; stay free-tier unless allow_paid:true is explicit.",
        ),
    ),
    GateAddon(
        "G6",
        "TOOL_BINDING",
        (
            "map symbols/ownership: codegraph_explore (if .codegraph/) else Grep/Glob/Read; read-only.",
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
            "mutate: Edit, Write, one hunk at a time; no bulk patch tool.",
            "shell = process orchestration only; never file browsing — use Glob/Grep/Read.",
        ),
    ),
    GateAddon(
        "G7",
        "PROCESS_LAUNCH",
        (
            "launch long-lived processes only via run_in_background:true; a blocking start stalls the turn.",
            "poll/stream background output via Monitor, never a sleep-retry loop.",
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            "prove via tests; long-running probes: run_in_background:true then Monitor.",
            "read logs/db from the files directly; no logsearch/dbread tool.",
            "rendered-page/visual claims need the Browser tool oracle (screenshot/read_page); typecheck is not proof.",
            "shell ls/dir scans are not evidence — Glob/Grep/Read only.",
            "sandbox egress blocking an MCP call is Unknown, not a failed oracle — retest with real network.",
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
            "verify completion: git status; no message-search tool exists.",
            "a smoke-tested MCP contract (handshake, tools/list, errors) is Exact; live response shape stays Hypothetical until run live.",
        ),
    ),
)
