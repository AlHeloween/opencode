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
        "G1",
        "GUI_STANDARDS",
        (
            "GUI rule set: design per Material Design 3 (web/Android), Apple HIG (iOS/macOS) or the project's UI kit; a11y per WCAG 2.1+ (contrast, screen reader, semantic markup, 100% keyboard); responsive and pixel-accurate at the target resolutions and DPI; feedback states (loading/skeleton), no multi-submit, actionable errors; never block the UI thread on I/O or compute.",
        ),
    ),
    GateAddon(
        "G1",
        "TUI_STANDARDS",
        (
            "TUI rule set: restore the terminal on exit AND on crash (raw mode off, cursor shown, alt screen cleared, colours reset); redraw on resize (SIGWINCH) and survive tiny sizes; 100% keyboard (arrows/hjkl, Tab focus, Esc cancel, Ctrl+C interrupt; mouse optional); degrade TrueColor→256→16→mono and honour NO_COLOR=1; event-driven, never poll; repaint only what changed (no flicker); verify on the target emulators (xterm, Alacritty, Windows Terminal, iTerm2, tmux) with UTF-8, emoji and box-drawing.",
        ),
    ),
    GateAddon(
        "G1",
        "ERGONOMICS_STANDARDS",
        (
            "Ergonomics rule set: ISO 9241 baseline; progressive disclosure over dense screens; Fitts (large, adjacent targets for critical actions; >=44x44 pt/dp for touch) and Hick (fewer options, faster decisions); type ergonomics (50-75 chars per line, adequate leading, F/Z scan patterns); consistent placement and standard shortcuts for muscle memory; poka-yoke error prevention, destructive actions confirmed, Undo that keeps context.",
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
            "report the TOOLS' working state at closure — which instrument answered, which LIED, and which had to be worked around. A tool that reduces or hides its own output without saying so costs more than it saves, and the waste compounds with every use: it is a delivery, not a footnote (owner, 2026-09-21: «нерабочие инструменты = большая бесполезная трата токенов, которая растёт по мере использования глючных тулов»).",
            "name the CLASS, not the anecdote: «reports Not found for a path it cannot see», «drops lines from its own report», «exits on a key that means cancel everywhere else». A named class is what a later cycle can fix; a story is not.",
            "a workaround is not a fix: when the envelope was routed around a broken tool, the route IS the residual — record it, so the next cycle does not pay for the same instrument twice.",
        ),
    ),
    GateAddon(
        "G7",
        "DISAS",
        (
            "DISAS — do it simple and stupid: complexity here is the DEFECT, not the price. Ask of every change «can this be done dumber and more linear?»; if yes, do that — a clever shape must first prove the dumb one fails.",
            "a chain is walked ONCE, LINEARLY, at ONE point (a fill); every later reader is a lookup of ONE source. A reader that decides how full the layer above it is has become a second, competing authority.",
            "a compensation built on top of a defect is the signature: a reader-side parent chain, a hedge between two spellings of one name, a second validity filter. Fix the hole and REMOVE the layer (owner, 2026-09-21: «мы рекурсивно чекали вместо дубового линейного чекапа и на этом погорели»).",
            "one predicate, one axis: «the stored value is well-formed» is not «the provider is connected now» — a gate that borrows its source from another question answers neither.",
        ),
    ),
    GateAddon(
        "G8",
        "RUN_ARTIFACT_FIRST",
        (
            "a cmd_runner run REPORTS ITSELF: read `<run>/state.json` (status, exit_code, bytes_written, bytes_dropped, truncated) and the WHOLE `<run>/stdout_text.log`. Never `tail` — it shows the last lines, so a crash banner hides the entire failure inventory behind it.",
            "measure `bytes_written` before choosing an instrument: the whole log is usually small, and one whole read costs less than the peeks it replaces. Where the same reading will recur, write the reader ONCE into `experiments/<ISO-date>_<name>/` and reason from its OUTPUT as a report.",
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
            "done -> plans_completed/; scan plans for stale refs.",
            "behavior/paths changed -> update docs/ and repo index.",
            "deprecated -> obsolete/ (reference only).",
        ),
    ),
    GateAddon(
        "G9",
        "ACCEPTANCE_PASS",
        (
            "ACCEPTANCE_PASS := ∀ criterion: covered(evidence_ref) — every criterion PROVEN. An unproven criterion is not a PASS-shaped exception, and PASS may never be declared over one; read over the artefact, never from memory.",
            "Unknown is a RECORD, never an argument: it may not be an input to any decision — no closure, no PASS, no acceptance, no risk acceptance may rest on it. An Inferred whose proof did not confirm is a CLEAN Unknown: it drops out of the basis entirely and the decision is made WITHOUT it.",
            "an unproven criterion ESCALATES — it does not close. Call aicall on the cheapest available model with the complete packet: claim, target, falsifier, instrument tried, result. aicall may only falsify; it never stamps, and its agreement is never evidence.",
            "· aicall judges the claim unsound or the attempt misconceived -> G0: write the finding to permanent memory, then compact — the same error must not be re-derived next cycle.",
            "· aicall judges the claim sound -> G1: re-enter grounding and decompose the task into smaller, independently testable pieces.",
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
