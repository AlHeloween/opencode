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
            "durable criteria store: memory tool over .opencode/data/memory/reasoning.md — read/append/write; write replaces (revisions kept); folds into m* verbatim.",
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
            "Chrome 127.0.0.1:9222 is universal-search's debug target: bind it only for user-requested visible web debugging or screenshots (CUA/CDP + bring_to_front); never launch, restart or alter its flags.",
        ),
    ),
    GateAddon(
        "G1",
        "PATH_SURFACE_DOCS",
        (
            "framework surface (TUI/renderables, kernel, storage, provider): read the owning skill first — .opencode/skills/<surface>/references/**, and cite file:line for the layout or API you build on.",
        ),
    ),
    GateAddon(
        "G1",
        "ACCEPTANCE_FRAME",
        (
            "ACCEPTANCE_FRAME := {(criterionᵢ, surfaceᵢ, instrumentᵢ@rung, falsifierᵢ)} — one per requested outcome, named BEFORE planning; a criterion first named at G8 was improvised, not defined (ISO/IEC 25010: QC criteria and acceptance criteria are requirements-time artefacts; ISO/IEC/IEEE 29119-1 for testing concepts).",
            "V&V: verification = impl ⊨ claim (@ORACLE); validation = impl ⊨ to_state (@INTENTION_INVARIANCE owns the target) — a green oracle on verification alone is a PASS about the wrong object.",
        ),
    ),
    GateAddon(
        "G1",
        "PROJECT_STRUCTURE",
        (
            "project shape, grounded not assumed: root manifests (project.dpr/dpk, pyproject.toml, Cargo.toml, package.json, tsconfig.json) in the root; core = pure testable library, separate from UI (GUI/CLI) and I/O (SoC); src/ + include/ layout; README.md names the modules; ONE canonical dependency file; settings are strict validated models (formal configuration), the config utility lives in-repo.",
        ),
    ),
    GateAddon(
        "G2",
        "PATH_EXPERIMENTS",
        (
            "scratch: experiments/; drafts: futures/; one-offs: [ISO8601]_name.",
            "experiments are born in experiments/ (gitignored, untracked) and verified results are archived to experiments_history/ (tracked) after a content check — canon: experiments_history/README.md, harness: experiments/2026-09-13_experiments-canon/archive.cjs.",
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
            "symbols + ownership: codegraph explore/impact (impact analysis); read-only.",
        ),
    ),
    GateAddon(
        "G6",
        "SURFACE_CONSUMERS",
        (
            "shared surface (renderer, component or route with more than one consumer): impact analysis by import before binding, and name which consumer your change touches.",
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
            "per-identity sampling: tight for reproducible verification, loose for generation.",
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
        "G7",
        "STYLE_AUTHORITY",
        (
            "style authority per language: Python PEP-8; JS/TS Google JS Style Guide + Prettier/ESLint; Go gofmt + Effective Go; C/C++ clang-format + Google C++ Style Guide; Rust rustfmt; Delphi Embarcadero Style Guide; MSVC MSDN; 8051 Intel MCS-51 (MIT 6.115). A repo formatter config is the executable form of its guide.",
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            "prove via tests (cmd_runner), jobwait, logsearch, dbread; long probes: cmd_runner start only.",
            "render claims: cmd_runner inbox (send keys, read render) or cua screenshot|verify_state — typecheck is not an instrument.",
            "a shared cmd_runner session has two writers: attribute who drove the state and re-read the render after handing the window over.",
            "shell dir/ls scans are not evidence — product tools only.",
            "isolated call: aicall (free-first, no tools, no repo) — attach every file it must see; Inferred at best, never a stamp.",
        ),
    ),
    GateAddon(
        "G8",
        "ORACLE_INSTRUMENT_CHECK",
        (
            "an unvalidated frame is not an oracle: prove the capture shows the WHOLE object unoccluded — screenshot crops a wide window, zoom caps one region at 500 px.",
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
        "ACCEPTANCE_PASS",
        (
            "ACCEPTANCE_PASS := ∀ criterion: covered(evidence_ref) ∨ (Unknown ∧ residual named) — read over the artefact, never from memory; an uncovered criterion is a residual, not a rounding error.",
            "report verification and validation apart; check @QUALITY_VECTOR axes only where the change could move one — acceptance is a measurement, not a ceremony.",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_CLOSURE",
        (
            "verify completion: messagesearch; git status.",
            "compact at a boundary: memory write first (it rides m* verbatim), then arm the fold; the fill gate already folds for room — this one is for attention.",
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
