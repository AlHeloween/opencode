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
        "PATH_AGI_WORKOUT",
        (
            "agi_workout/ — the build_mode overlay's journal (/automode): new-tool decisions and the mode's blockers; read it before inventing a tool.",
        ),
    ),
    GateAddon(
        "G1",
        "INSTRUMENT_CHAIN",
        (
            "instrument chain, in order: where/which -> codegraph -> messagesearch -> universalsearch -> glob -> grep; device state via nvidia-smi. Name the rung that answered.",
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
            "findstr: host-allowed, but non-ASCII paths fail to open — the fallback is grep.",
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
        "G3",
        "ACCEPTANCE_FRAME",
        (
            "ACCEPTANCE_FRAME := {(criterionᵢ, surfaceᵢ, instrumentᵢ@rung, falsifierᵢ)} — one per requested outcome, named BEFORE planning; a criterion first named at G8 was improvised, not defined (ISO/IEC 25010: QC criteria and acceptance criteria are requirements-time artefacts; ISO/IEC/IEEE 29119-1 for testing concepts).",
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
        "PATH_AGI_WORKOUT_LOG",
        (
            "build_mode overlay (/automode): every new-tool decision and every blocker gets one entry in agi_workout/ — its memory; product-only, not in the Codex/Claude registries.",
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
            "surface standards (GUI, TUI, ergonomics, project shape): docs/ui-standards.md — read before building or reviewing one.",
        ),
    ),
    GateAddon(
        "G1",
        "SEARCH_OUTPUT_SHAPE",
        (
            "bound the ANSWER, not the search: a result that has to be truncated has not answered — return counts, or the top hits, or the ONE path:line that decides, never a wall of matched lines.",
            "an `include`/path filter is part of the instrument: when it matches nothing, that is a claim about the FILTER until proven otherwise — re-run it with a control that MUST match, then report; without it the answer is a false absence.",
            "`glob` is a locator, not an inventory: a capped listing is a sample, so never conclude «no more» or «absent» from one. Product tools only — shell `ls`/`dir`/`find` are not the fallback for a bad glob.",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_HEALTH",
        (
            "report the TOOLS' working state at closure — which instrument answered, which LIED, which had to be worked around. A tool that hides or reduces its own output without saying so is a delivery, not a footnote.",
            "name the CLASS, not the anecdote: «reports Not found for a path it cannot see», «drops lines from its own report». A named class is what a later cycle can fix; a story is not.",
            "a workaround is not a fix: when the envelope was routed around a broken tool, the route IS the residual — record it, so the next cycle does not pay for the same instrument twice.",
        ),
    ),
    GateAddon(
        "G7",
        "DISAS",
        (
            "DISAS — do it simple and stupid: complexity is the DEFECT, not the price. Ask of every change «can this be dumber and more linear?»; a clever shape must first prove the dumb one fails.",
            "a chain is walked ONCE, LINEARLY, at ONE point (a fill); every later reader is a lookup of ONE source. A reader that decides how full the layer above it is has become a second, competing authority.",
            "a compensation built on top of a defect is the signature: a reader-side parent chain, a hedge between two spellings of one name, a second validity filter. Fix the hole and REMOVE the layer.",
            "one predicate, one axis: «the stored value is well-formed» is not «the provider is connected now» — a gate that borrows its source from another question answers neither.",
        ),
    ),
    GateAddon(
        "G7",
        "ASSERTION_STATUS",
        (
            "ASSERTION_STATUS: every assertion you write — code comments, docs, plans, commits, memory, reports, replies, working notes — carries its status: CONFIRMED (✓, naming the instrument) or REFUTED (✗, naming what contradicts it).",
            "An unmarked claim reads as CONFIRMED to the next reader: without a status it is Guess (@INFOMARK) and its prose cannot be told from a verified one.",
            "The machine counts them as `marks:` in `<compaction-status>`, so the history reads for confidence and not only for content — a confidence indicator, not epistemology.",
        ),
    ),
    GateAddon(
        "G8",
        "RUN_ARTIFACT_FIRST",
        (
            "a cmd_runner run REPORTS ITSELF: read `<run>/state.json` (status, exit_code, bytes_written, bytes_dropped, truncated) and the WHOLE `<run>/stdout_text.log`. Never `tail` — it shows the last lines, so a crash banner hides the entire failure inventory behind it.",
            "measure `bytes_written` before choosing an instrument: one whole read usually costs less than the peeks it replaces, and a reading that will recur is written once into `experiments/` and read as its report.",
            "an oracle that cannot print its own verdict is not an oracle: a suite cut off by crash, kill or timeout yields UNKNOWN, and its failure inventory is a FLOOR, not a total.",
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
        "G8",
        "GUI_ORACLE",
        (
            "GUI claims: E2E for the critical flows (Playwright/Cypress) and visual regression for components (Storybook/Percy).",
        ),
    ),
    GateAddon(
        "G9",
        "PATH_CLOSURE",
        (
            "undone task -> [~] + reason; scan plans for stale refs.",
            "behavior/paths changed -> update docs/ and repo index.",
            "deprecated -> obsolete/ (reference only).",
            "the plan moves by the OUTCOME, and plans/ is legal only while the plan owes work: SUCCESS -> plans_completed/, OUT_OF_SCOPE -> plans_deferred/ (contradicts the architecture), BLOCKED and WAITING_APPROVAL -> plans/postponed/ naming the reason AND the signal that lifts it. plans/futures/ takes evolution candidates only, naming the CONDITION that makes one executable — never a terminated run.",
            "move it with `git mv` in a commit that names the ground — never a tick (the work is not done), never left in plans/ (it returns as open debt).",
        ),
    ),
    GateAddon(
        "G9",
        "ARTIFACT_LANGUAGE",
        (
            "write every ARTIFACT in English — code comments, docs, plan files, folder READMEs, kernel text, memory, commit messages. Russian is for the owner-facing reply and the GUI only; G0 keeps that half.",
            "THE SPLIT IS THE ECONOMY: canon prose -> the folder README, the rule alone -> the kernel.",
        ),
    ),
    GateAddon(
        "G9",
        "ACCEPTANCE_PASS",
        (
            "ACCEPTANCE_PASS := ∀ criterion: covered(evidence_ref) — every criterion PROVEN; PASS may never be declared over an unproven one, read over the artefact and never from memory.",
            "an unproven criterion may escalate ONCE, and only where DELEGATION admits it: aicall gets the whole packet (claim, target, falsifier, instrument tried, result) and may only FALSIFY. It contradicts -> persist the finding, compact, re-enter G0; it agrees -> nothing moved, the criterion stays uncovered and closes as residual.",
            "an uncovered criterion is a residual, not a rounding error; report verification and validation apart; check @QUALITY_VECTOR axes only where the change could move one — acceptance is a measurement, not a ceremony.",
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
