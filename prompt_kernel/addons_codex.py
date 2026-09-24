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
        "INSTRUMENT_CHAIN",
        (
            "instrument chain, in order: where/which -> codegraph_explore -> (no history search on this host) -> Read a URL or Browser through Eval -> Glob -> Grep; device state via the shell. Name the rung that answered.",
        ),
    ),
    GateAddon(
        "G1",
        "NO_WINDOW_ORACLE",
        (
            "no window accounting and no chain reader are bound on this host: the fold is unpredictable, so persist the handles at every closed boundary rather than at a threshold.",
            "a prev-md5 break is therefore found by reading, not announced — recovery across one is Guess, and the intention is re-read from the plan comment, the progress log and the ledgers.",
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
        "G1",
        "PATH_SURFACE_DOCS",
        (
            "framework surface (TUI/renderables, kernel, storage, provider): read the owning reference first — .opencode/skills/<surface>/references/** are plain files here (no skill tool), and cite file:line for the layout or API you build on.",
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
        "G6",
        "SURFACE_CONSUMERS",
        (
            "shared surface (renderer, component or route with more than one consumer): impact analysis by import — codegraph_explore, plus LSP references/implementation — before binding, and name which consumer your change touches.",
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
            "delegate through Task: hand it the binding, the falsifier and the parent intention verbatim, withholding the answer you expect.",
            "a batch runs unattended and reports once: never state a pending result, and re-brief a follow-up slice instead of assuming it kept the earlier context.",
        ),
    ),
    GateAddon(
        "G7",
        "ASSERTION_STATUS",
        (
            "ASSERTION_STATUS: every assertion you write — code comments, docs, plans, commits, memory, reports, replies, working notes — carries its status: CONFIRMED (✓, naming the instrument) or REFUTED (✗, naming what contradicts it).",
            "An unmarked claim reads as CONFIRMED to the next reader, so without a status it is Guess (@INFOMARK) and its prose cannot be told from a verified one. A confidence indicator, not epistemology.",
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
        "G7",
        "STYLE_AUTHORITY",
        (
            "style authority per language: Python PEP-8; JS/TS Google JS Style Guide + Prettier/ESLint; Go gofmt + Effective Go; C/C++ clang-format + Google C++ Style Guide; Rust rustfmt; Delphi Embarcadero Style Guide; MSVC MSDN; 8051 Intel MCS-51 (MIT 6.115). A repo formatter config is the executable form of its guide.",
            "surface standards (GUI, TUI, ergonomics, project shape) belong to the repo's own docs — read them before building or reviewing a surface.",
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
            "prove via the narrowest instrument; long, interactive, or crash-prone Windows commands use the cmd_runner skill.",
            "rendered web claims require Browser through Eval with an observed page/screenshot; typecheck is not a visual oracle.",
            "read artifacts and logs with Read; shell directory scans are not evidence.",
            "no isolated model call is bound here, and a Task shares this frame: a verdict about your own reasoning has no outside falsifier, so it closes Inferred or Unknown rather than as a stamp.",
        ),
    ),
    GateAddon(
        "G8",
        "ORACLE_INSTRUMENT_CHECK",
        (
            "an unvalidated frame is not an oracle: prove the capture shows the WHOLE object unoccluded — Browser through Eval is the instrument, a viewport crop is not.",
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
            "a terminal always moves the plan and plans/ is never the destination: done -> plans_completed/, otherwise the folder this repo uses for excluded or paused work, naming the reason AND the signal that lifts it. Scan plans for stale refs.",
            "behavior/paths changed -> update docs/ and repo index.",
            "deprecated -> obsolete/ (reference only).",
        ),
    ),
    GateAddon(
        "G9",
        "ACCEPTANCE_PASS",
        (
            "ACCEPTANCE_PASS := ∀ criterion: covered(evidence_ref) — every criterion PROVEN; PASS may never be declared over an unproven one, read over the artefact and never from memory.",
            "an unproven criterion does not escalate on this host — no isolated call is bound: it closes as a named residual carrying the claim, the falsifier and the instrument that failed, so a host that has one can take it.",
            "an uncovered criterion is a residual, not a rounding error; report verification and validation apart; check @QUALITY_VECTOR axes only where the change could move one — acceptance is a measurement, not a ceremony.",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_CLOSURE",
        (
            "verify scoped working-tree state before closure; no message-search tool exists.",
            "compact at a closed boundary and treat the fold as lossy: criteria, falsifiers and the open residual go to plans/, docs/ and _progress_log.md first.",
            "a smoke-tested MCP contract is Exact; live response shape remains Hypothetical until run live.",
        ),
    ),
)
