from __future__ import annotations

from dataclasses import dataclass

GATE_IDS = tuple(f"G{i}" for i in range(1, 10))


@dataclass(frozen=True, slots=True)
class GateAddon:
    gate_id: str
    addon_id: str
    lines: tuple[str, ...]


GATE_ADDONS: tuple[GateAddon, ...] = (
    GateAddon(
        "G1",
        "PATH_GROUNDING",
        (
            "first read: plans/*.md, docs/.",
            "durable criteria: memory read (.opencode/data/memory/reasoning.md) — every identity may read and write it, and compact folds it into m* inside <memory> verbatim; memory write replaces the file, revisions kept, append adds.",
            "never store plans under .opencode/plans/.",
        ),
    ),
    GateAddon(
        "G1",
        "TOOL_GROUNDING",
        (
            "ground via: codegraph, read, messagesearch, webfetch/universalsearch.",
            "file enumeration: list/glob/grep/read — never shell ls/dir/find/cat (hard-blocked).",
            "platform: Windows = cmd/powershell tools; bash unavailable.",
            "cmd.exe: never dir/type/tree; quote spaced paths; chain &&; pipe 2>&1.",
            "Chrome at 127.0.0.1:9222 is universal-search's existing debug target: only when the user requests visible web debugging, click simulation, or screenshots, exact-bind it through CUA/CDP and use CUA bring_to_front plus typed browser actions/screenshots; otherwise leave it backgrounded — never launch, restart, or alter its debug flags.",
        ),
    ),
    GateAddon(
        "G2",
        "TOOL_DECOMPOSE",
        (
            "track candidates: todowrite.",
        ),
    ),
    GateAddon(
        "G3",
        "PATH_PLANS",
        (
            "plans: plans/[ISO8601]_<description>.md; Smoke Tests before G4.",
            "plan carries the intention: <!-- intention: from_state -> to_state --> rides planState through compact.",
        ),
    ),
    GateAddon(
        "G4",
        "TOOL_AUTHORIZE",
        (
            "identity or permission uncertain -> checkstate; unresolved decision -> question (ASK).",
            "kernel source: prompt_kernel/source.py -> python -m prompt_kernel --install; the installed .txt is generated, never hand-edited.",
        ),
    ),
    GateAddon(
        "G6",
        "TOOL_BINDING",
        (
            "map symbols and ownership: codegraph explore/impact; read-only task grounding.",
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
            "mutate: edit, multiedit, write, applypatch; crash-prone shell via cmd_runner.",
            "shell = process orchestration only; never file browsing (constitution blocks).",
        ),
    ),
    GateAddon(
        "G7",
        "TOOL_DELEGATE",
        (
            "delegate: task (explorer_agent G1/G6, general_agent G2/G3, coder_agent G7/G8, researcher_agent, media_agent); pipeline chains them in declared order.",
            "each identity carries its own sampling — a tight one is for reproducible work, do not ask it for variety.",
        ),
    ),
    GateAddon(
        "G7",
        "PROCESS_LAUNCH",
        (
            "launch via cmd_runner start (non-blocking; jobwait/jobkill) — a bare start hangs the TUI; reuse a live sidecar by lock/pid/port, never rebind a bound port.",
            "permanent services: nssm install, never ad-hoc detach.",
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            "prove via tests (cmd_runner), jobwait, logsearch, dbread; long probes: cmd_runner start only.",
            "render claims need an instrument: TUI via cmd_runner inbox (send keys, read render), windows/web via cua screenshot or verify_state — typecheck is not one.",
            "a shared cmd_runner session has two writers: attribute who drove the state and re-read the render after handing the window over.",
            "shell dir/ls scans are not evidence — product tools only.",
            "the isolated call is aicall: no tools, no repo, free-first model — attach every file it must see, or it answers a question you did not ask. Inferred at best, never a stamp.",
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
            "verify completion: messagesearch; git status.",
            "compact at the boundary: memory write first (it rides m* verbatim), then the compact tool arms the fold for turn end. The window-fill gate already folds for room — this one is for attention.",
        ),
    ),
)


def validate_addons(addons: tuple[GateAddon, ...] = GATE_ADDONS) -> list[str]:
    errors: list[str] = []
    addon_ids = [addon.addon_id for addon in addons]
    for addon in addons:
        if addon.gate_id not in GATE_IDS:
            errors.append(f"addon {addon.addon_id} binds to unknown gate {addon.gate_id}")
        if not addon.addon_id or addon.addon_id != addon.addon_id.strip():
            errors.append(f"addon id must be a non-blank symbol: {addon.addon_id!r}")
        if not addon.lines or any(not line.strip() for line in addon.lines):
            errors.append(f"addon {addon.addon_id} must declare only non-empty lines")
    for duplicate in sorted({value for value in addon_ids if addon_ids.count(value) > 1}):
        errors.append(f"duplicate addon definition: {duplicate}")
    return errors


def addon_lines_by_gate(addons: tuple[GateAddon, ...]) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}
    for addon in addons:
        grouped.setdefault(addon.gate_id, []).extend(addon.lines)
    return {gate_id: tuple(lines) for gate_id, lines in grouped.items()}
