"""Gate addons for the Claude Code CLI host.

Same gate graph as `.addons` (opencode); different tool bindings. Claude Code
exposes Read/Edit/Write/Glob/Grep, a Bash tool (POSIX/git-bash) and a
PowerShell tool side by side, an Agent tool for sub-tasks, AskUserQuestion,
and a Monitor tool (deferred) plus a `run_in_background` flag for long-lived
processes — it has no cmd_runner, applypatch, multiedit, checkstate,
messagesearch, logsearch, dbread, or nssm-equivalent tool. Where a CodeGraph
MCP tool / `.codegraph/` index is present, it plays the same role opencode's
`codegraph` tool plays. Host-level MCP servers (e.g. the user-scope
`openrouter-free` server, exposing `list_free_models` and `call_model`) get
the same evidence discipline as any other tool: read calls are free
grounding, network calls are EXTERNAL_EFFECT gated behind explicit
authorization, and a sandbox-blocked call is Unknown, not proof of failure.
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
            "durable criteria: .opencode/data/memory/reasoning.md — read before non-trivial work.",
            "never store plans under .claude/plans/.",
        ),
    ),
    GateAddon(
        "G1",
        "INSTRUMENT_CHAIN",
        (
            "instrument chain, in order: where/which -> codegraph_explore -> (no history search on this host) -> WebSearch/WebFetch -> Glob -> Grep; device state via the shell. Name the rung that answered.",
        ),
    ),
    GateAddon(
        "G1",
        "NO_WINDOW_ORACLE",
        (
            "window fill, the fold threshold and the burn rate are NOT reported on this host, and the fold arrives as a notice AFTER it happened: treat it as unpredictable and persist the handles at every closed boundary, never at a threshold.",
            "no chain reader runs here either: a prev-md5 break is found by reading, not announced, so recovery across one is Guess and the intention is re-read from the plan comment, the progress log and the ledgers — never from the prose in the window.",
        ),
    ),
    GateAddon(
        "G1",
        "TOOL_GROUNDING",
        (
            "ground via: codegraph_explore (if .codegraph/), Read, Grep/Glob, WebFetch/WebSearch.",
            "file enumeration: Glob/Grep/Read — never shell ls/dir/find/cat (hard-blocked).",
            "platform: Windows = Bash or PowerShell tool; never mix syntaxes.",
            "openrouter-free (user-scope MCP): list_free_models is discovery; call_model is a network call, not local evidence.",
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
            "track candidates: TodoWrite if available, else inline in the plan file.",
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
            "permission/identity uncertain -> defer to the harness's prompt; unresolved decision -> AskUserQuestion.",
            "network-calling MCP tools (e.g. call_model) are EXTERNAL_EFFECT; stay free-tier unless allow_paid:true is explicit.",
            "kernel source: prompt_kernel/source.py -> python -m prompt_kernel --install; the installed .txt is generated, never hand-edited.",
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
        "G6",
        "SURFACE_CONSUMERS",
        (
            "shared surface (renderer, component or route with more than one consumer): impact analysis by import (codegraph_explore, else Grep/Glob) before binding, and name which consumer your change touches.",
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
        "TOOL_DELEGATE",
        (
            "delegate: Agent (subagent_type); SendMessage continues one with its context intact, a fresh Agent call does not.",
            "sub-agents run in the background — never state a pending one's result before its notification arrives.",
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
            "launch long-lived processes only via run_in_background:true; a blocking start stalls the turn.",
            "poll/stream background output via Monitor, never a sleep-retry loop.",
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
            "any path, name or file filter is part of the instrument: when it matches nothing, that is a claim about the FILTER until proven otherwise — re-run it with a control that MUST match, then report; without it the answer is a false absence.",
            "a result capped by its own limit is a SAMPLE, not an inventory: never conclude «no more» or «absent» from one, and never fall back to shell directory enumeration — the host's own search tools are the fallback.",
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
            "a long run REPORTS ITSELF: read the run directory's OWN state file (status, exit code, bytes written, bytes dropped, truncated) and the WHOLE captured output. Never a tail — it shows the last lines, so a crash banner hides the entire failure inventory behind it.",
            "measure the captured output's size before choosing an instrument: the whole log is usually small, and one whole read costs less than the peeks it replaces. Where the same reading will recur, write the reader ONCE into `experiments/<ISO-date>_<name>/` and reason from its OUTPUT as a report.",
            "an oracle that cannot print its own verdict is not an oracle: a suite cut off by crash, kill or timeout yields UNKNOWN, and its failure inventory is a FLOOR, not a total.",
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
            "the isolated call is openrouter-free call_model: EXTERNAL_EFFECT, free tier, no repo access — attach the evidence inline. Inferred at best, never a stamp.",
        ),
    ),
    GateAddon(
        "G8",
        "ORACLE_INSTRUMENT_CHECK",
        (
            "an unvalidated frame is not an oracle: prove the capture shows the WHOLE object unoccluded — the Browser tool is the instrument, a viewport crop is not.",
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
            "the plan moves by the OUTCOME and plans/ is legal only while it owes work: SUCCESS -> plans_completed/, OUT_OF_SCOPE -> plans_deferred/, BLOCKED and WAITING_APPROVAL -> plans/postponed/ naming the reason AND the signal that lifts it; `git mv` in the commit that names the ground. Scan plans for stale refs.",
            "behavior/paths changed -> update docs/ and repo index.",
            "deprecated -> obsolete/ (reference only).",
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
            "an unproven criterion may escalate ONCE, and only where DELEGATION admits it: call_model gets the whole packet (claim, target, falsifier, instrument tried, result) and may only FALSIFY. It contradicts -> persist the finding, compact, re-enter G0; it agrees -> nothing moved, the criterion stays uncovered and closes as residual.",
            "an uncovered criterion is a residual, not a rounding error; report verification and validation apart; check @QUALITY_VECTOR axes only where the change could move one — acceptance is a measurement, not a ceremony.",
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_CLOSURE",
        (
            "verify completion: git status; no message-search tool exists.",
            "compact at a boundary: no compact tool here — /compact is the user's and lossy. Write the handles to plans/, docs/ and _progress_log.md, then ask.",
            "a smoke-tested MCP contract (handshake, tools/list, errors) is Exact; live response shape stays Hypothetical until run live.",
        ),
    ),
)
