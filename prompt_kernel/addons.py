from __future__ import annotations

from dataclasses import dataclass

GATE_IDS = tuple(f"G{i}" for i in range(1, 10))


@dataclass(frozen=True, slots=True)
class GateAddon:
    gate_id: str
    addon_id: str
    lines: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class IdentityAddon:
    identity_id: str
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
        "G1",
        "VCS_ROLES",
        (
            # Owner, 2026-10-03: «Добавь в аддоны кернела назначение fossil у нас и то что мы используем гит как VCS».
            # Incident 2026-10-02: a delegate without this binding invented a «two VCS» story and the root _FOSSIL_
            # vanished. Source: AGENTS.md § Fossil Snapshot System.
            # Round 1 frameless Sonnet: «delete through it» left a direct file delete open (the incident's shape), «it»
            # had no clear antecedent, recreating the marker was not covered, the cadence list invited misreadings.
            # Round 2: «by hand» let a script through (the incident was a script), «inspection» admitted fossil
            # open/checkout, two named files left the folder and a move open, «defect» invited a repair.
            # Round 3: «root marker» bound to the fossil/ folder, the parenthetical read as a closed list, live-file
            # reads outside fossil were uncovered, «never repair» could halt the task, «NOT a VCS» is factually arguable.
            # Round 4: «them» covered the folder, not the files under it; -R is not read-only; a «copy» could be made by
            # moving the original. Rounds stopped here: the incident-shaped holes are closed, the rest is style.
            "git is the project VCS (commits, branches, history); Fossil serves only as the runtime's own undo/redo store, never as a second VCS. Nothing under {worktree}/.opencode/data/fossil/ nor the worktree-root marker _FOSSIL_ is ever altered by you (delete, move, rename, recreate, overwrite — by command or script); to inspect, COPY snapshot.fsl and run read-only fossil -R commands (timeline, info, ls) on the copy. A missing _FOSSIL_: report it to the user as a defect, do not recreate it, continue the task.",
        ),
    ),
    GateAddon(
        "G1",
        "PROJECT_LAYOUT",
        (
            # Owner, 2026-10-03: the layout belongs in the kernel add-ons «чтобы не гессить в новом проекте»; nothing
            # opencode-specific here. Incident the same day: a robot asked to build read neither the docs nor
            # scripts/ and invented a build. Three frameless-Sonnet rounds (experiments/2026-10-03_kernel-layout/):
            # «read scripts/» was satisfiable by a listing, «→» read as a pipeline, «created at first need» clashed
            # with «never invented», a project's own conventions had no precedence.
            "project layout (paths from the repo root; an item the project's own AGENTS.md places elsewhere is read there instead): AGENTS.md = the rules, read before work; plans/MASTER_PLAN.md = the direction; plans/ = active plans; plans_completed/ = done, plans_deferred/ = out of scope, plans/postponed/ = blocked; _progress_log.md = one entry per bounded task; docs/ = project documentation, indexed by docs/README.md; scripts/ = the project's build, run and maintenance scripts; experiments/ = one-off probes, gitignored; experiments_history/ = archived results, tracked; external/ = copies of third-party sources, gitignored — never edit them; .temp/ = throwaway, gitignored. Before building, running or scripting the project, read docs/README.md and OPEN the scripts in scripts/ that fit the task: an existing procedure is reused, never re-invented; an absent one means nothing to read. A missing item is created only when needed, at exactly its path here.",
        ),
    ),
    GateAddon(
        "G3",
        "ACCEPTANCE_FRAME",
        (
            "ACCEPTANCE_FRAME := {(criterionᵢ, surfaceᵢ, instrumentᵢ@rung, falsifierᵢ)} — one per requested outcome, named BEFORE planning; a criterion first named at G8 was improvised, not defined (ISO/IEC 25010: acceptance criteria are requirements-time artefacts).",
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
            "build_mode overlay (/automode): every new-tool decision and every blocker gets one entry in agi_workout/ — its memory; product-only.",
        ),
    ),
    GateAddon(
        "G7",
        "TOOL_IMPLEMENT",
        (
            "mutate: edit, write; crash-prone shell via cmd_runner.",
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
            "style authority per language: Python PEP-8; JS/TS Google + Prettier/ESLint; Go gofmt + Effective Go; C/C++ clang-format/Google; Rust rustfmt; Delphi Embarcadero; MSVC official docs; 8051 MCS-51 (MIT 6.115). A repo formatter config is the executable form of its guide.",
            "surface standards (GUI, TUI, ergonomics, project shape): docs/ui-standards.md — read before building or reviewing one.",
        ),
    ),
    GateAddon(
        "G1",
        "SEARCH_OUTPUT_SHAPE",
        (
            "bound the ANSWER, not the search: a truncated result has not answered — return counts, the top hits, or the ONE deciding path:line.",
            "an `include`/path filter is part of the instrument: no matches is a claim about the FILTER until proven otherwise — re-run with a control that MUST match; without it the answer is a false absence.",
            "`glob` is a locator, not an inventory: a capped listing is a sample, never «no more» or «absent». Product tools only — shell `ls`/`dir`/`find` are not the fallback for a bad glob.",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_HEALTH",
        (
            "report the TOOLS' state at closure — which answered, which LIED, which needed a workaround; a tool that hides its own output is a delivery, not a footnote.",
            "name the CLASS, not the anecdote («reports Not found for a path it cannot see», «drops lines from its own report») — a named class is what a later cycle can fix; a story is not.",
            "a workaround is not a fix: a route around a broken tool IS the residual — record it, so the next cycle does not pay for that instrument twice.",
        ),
    ),
    GateAddon(
        "G7",
        "DISAS",
        (
            "DISAS — do it simple and stupid: complexity is the DEFECT, not the price; a clever shape must first prove the dumb one fails.",
            "a chain is walked ONCE, LINEARLY, at ONE point (a fill); every later reader looks up ONE source, never re-decides how full the layer above is.",
            "a compensation on top of a defect is the signature — a reader-side parent chain, a hedge between two spellings of one name, a second validity filter; fix the hole and REMOVE the layer.",
            "one predicate, one axis: «well-formed» is not «connected now» — a gate borrowing its source from another question answers neither.",
        ),
    ),
    GateAddon(
        "G7",
        "ASSERTION_STATUS",
        (
            "ASSERTION_STATUS: every assertion — code, docs, plans, commits, memory, reports, replies — carries CONFIRMED (✓, its instrument) or REFUTED (✗, what contradicts it).",
            "Unmarked, a claim reads as CONFIRMED though it is Guess (@INFOMARK): its prose cannot be told from a verified one — that gap is the defect.",
            "`marks:` in `<compaction-status>` counts them: the history reads for confidence, not only for content.",
        ),
    ),
    GateAddon(
        "G8",
        "RUN_ARTIFACT_FIRST",
        (
            "a cmd_runner run reports itself: read `<run>/state.json` (status, exit_code, bytes_written, bytes_dropped, truncated) and the WHOLE stdout_text.log — never a tail, which hides the failure inventory behind a crash banner.",
            "measure `bytes_written` before choosing an instrument: one whole read usually costs less than the peeks it replaces.",
            "an oracle that cannot print its verdict is not an oracle: a suite cut off by crash, kill or timeout yields UNKNOWN — its failure inventory a FLOOR, not a total.",
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            "prove via tests (cmd_runner), jobwait, logsearch, dbread; long probes: cmd_runner start only.",
            "render claims: cmd_runner inbox (send keys, read render) or cua screenshot|verify_state — typecheck is not an instrument.",
            "a shared cmd_runner session has two writers: attribute who drove, and re-read the render after a hand-over.",
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
            "the plan moves by its OUTCOME: SUCCESS -> plans_completed/; OUT_OF_SCOPE -> plans_deferred/; BLOCKED/WAITING_APPROVAL -> plans/postponed/ naming the reason AND the lift signal; plans/futures/ takes evolution candidates only, naming their CONDITION — never a terminated run.",
            "move it with `git mv` in a commit that names the ground — never a tick, never left in plans/ where it returns as open debt.",
        ),
    ),
    GateAddon(
        "G9",
        "ARTIFACT_LANGUAGE",
        (
            "artifacts in English — code, docs, plans, READMEs, kernel, memory, commits; Russian only for the owner-facing reply and the GUI (G0 keeps that half).",
            "THE SPLIT IS THE ECONOMY: canon prose -> the folder README, the rule alone -> the kernel.",
        ),
    ),
    GateAddon(
        "G9",
        "ACCEPTANCE_PASS",
        (
            "ACCEPTANCE_PASS := ∀ criterion: covered(evidence_ref) — every criterion PROVEN; PASS may never be declared over an unproven one, read over the artefact and never from memory.",
            "an unproven criterion may escalate ONCE, only where DELEGATION admits it: aicall gets the whole packet (claim, target, falsifier, instrument tried, result) and may only FALSIFY — contradicts → persist, compact, re-enter G0; agrees → nothing moved, the criterion closes as residual.",
            "an uncovered criterion is a residual, not a rounding error; report verification and validation apart — acceptance is a measurement, not a ceremony.",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_CLOSURE",
        (
            "verify completion: messagesearch; git status.",
            "compact at a boundary: memory first (it rides m* verbatim), then arm the fold — the fill gate folds for room, this one for attention.",
        ),
    ),
)


# Allowed-tool rows for identity contracts (section 5). Product-only by design: the Claude and
# Codex harnesses carry their own tool sets, not ours (owner, 2026-09-28). Filled from the live
# ACL manifest (packages/opencode/script/kernel-tools-manifest.ts, run 2026-09-28 after the
# job_kill / disabled-scoped-open fixes); drift is caught by the TS parity test
# packages/opencode/test/agent/kernel-identity-tools.test.ts. Narrow identities list what they
# may use; wide identities list exclusions ("all except …"). Notes after ";" carry path-scoped
# edit boundaries the ACL enforces at execution; the parity test compares only the id sets.
# MCP tools are host-configured and not enumerated — the rows describe the builtin catalogue.
IDENTITY_ADDONS: tuple[IdentityAddon, ...] = (
    IdentityAddon(
        "BUILD_MODE",
        "BUILD_MODE_TOOLS",
        ("tools: all except planexit, reasoningexit.",),
    ),
    IdentityAddon(
        "PLAN_MODE",
        "PLAN_MODE_TOOLS",
        (
            "tools: all except bash, cmd, jobkill, pipeline, planenter, reasoningenter, reasoningexit, restore, run;"
            " write/edit: plans/ only.",
        ),
    ),
    IdentityAddon(
        "REASONING_MODE",
        "REASONING_MODE_TOOLS",
        ("tools: checkstate, memory, reasoningexit.",),
    ),
    IdentityAddon(
        "ORCHESTRATOR_AGENT",
        "ORCHESTRATOR_AGENT_TOOLS",
        (
            "tools: all except bash, cmd, jobkill, pipeline, planenter, planexit, reasoningenter, reasoningexit, restore, run;"
            " write/edit: plans/, plans_completed/, orchestrator memory only.",
        ),
    ),
    IdentityAddon(
        "EXPLORER_AGENT",
        "EXPLORER_AGENT_TOOLS",
        (
            "tools: all except bash, cmd, compact, edit, jobkill, pipeline,"
            " planenter, planexit, reasoningenter, reasoningexit, restore, run, summaryedit, task, write.",
        ),
    ),
    IdentityAddon(
        "RESEARCHER_AGENT",
        "RESEARCHER_AGENT_TOOLS",
        (
            "tools: checkstate, cua, imagerender, jobreset, memory, planstatus, recall, svm,"
            " tempdisable, tempenable, todowrite, universalsearch, webfetch.",
        ),
    ),
    IdentityAddon(
        "GENERAL_AGENT",
        "GENERAL_AGENT_TOOLS",
        (
            "tools: all except bash, cmd, compact, jobkill, pipeline, planenter, planexit,"
            " reasoningenter, reasoningexit, restore, run, summaryedit, task; write/edit: plans/ only.",
        ),
    ),
    IdentityAddon(
        "CODER_AGENT",
        "CODER_AGENT_TOOLS",
        (
            "tools: all except compact, jobkill, pipeline, planenter, planexit, reasoningenter,"
            " reasoningexit, summaryedit, task; write/edit: not plans/, not plans_completed/.",
        ),
    ),
    IdentityAddon(
        "MEDIA_AGENT",
        "MEDIA_AGENT_TOOLS",
        (
            "tools: all except compact, jobkill, pipeline, planenter, planexit, reasoningenter,"
            " reasoningexit, summaryedit, task.",
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


def validate_identity_addons(
    addons: tuple[IdentityAddon, ...] = IDENTITY_ADDONS,
    identity_ids: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
    addon_ids = [addon.addon_id for addon in addons]
    for addon in addons:
        if identity_ids is not None and addon.identity_id not in identity_ids:
            errors.append(f"identity addon {addon.addon_id} binds to unknown identity {addon.identity_id}")
        if not addon.addon_id or addon.addon_id != addon.addon_id.strip():
            errors.append(f"addon id must be a non-blank symbol: {addon.addon_id!r}")
        if not addon.lines or any(not line.strip() for line in addon.lines):
            errors.append(f"identity addon {addon.addon_id} must declare only non-empty lines")
    for duplicate in sorted({value for value in addon_ids if addon_ids.count(value) > 1}):
        errors.append(f"duplicate identity addon definition: {duplicate}")
    return errors


def addon_lines_by_gate(addons: tuple[GateAddon, ...]) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}
    for addon in addons:
        grouped.setdefault(addon.gate_id, []).extend(addon.lines)
    return {gate_id: tuple(lines) for gate_id, lines in grouped.items()}


def identity_addon_lines_by_identity(
    addons: tuple[IdentityAddon, ...],
) -> dict[str, tuple[str, ...]]:
    grouped: dict[str, list[str]] = {}
    for addon in addons:
        grouped.setdefault(addon.identity_id, []).extend(addon.lines)
    return {identity_id: tuple(lines) for identity_id, lines in grouped.items()}
