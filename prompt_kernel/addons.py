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
            "never store plans under .opencode/plans/.",
        ),
    ),
    GateAddon(
        "G1",
        "TOOL_GROUNDING",
        (
            "ground via: codegraph, read, messagesearch, webfetch/universalsearch.",
        ),
    ),
    GateAddon(
        "G2",
        "PATH_EXPERIMENTS",
        (
            "scratch: experiments/; drafts: futures/; one-offs: [ISO8601]_name.",
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
        ),
    ),
    GateAddon(
        "G4",
        "TOOL_AUTHORIZE",
        (
            "identity or permission uncertain -> getmode; unresolved decision -> question (ASK).",
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
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            "prove via tests (cmd_runner), jobwait, logsearch, dbread.",
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
