"""Gate add-ons for the Cursor host.

The shared graph stays in ``source.py``. This registry only binds it to the
host's actual tools. Cursor publishes its agent tools as capabilities — Read
File, List Directory, Codebase, Grep, Search Files, Web, Fetch Rules; Edit &
Reapply, Delete File; Terminal; plus MCP servers — and deliberately does NOT
promise stable snake_case function names, so the bindings name the capability
the way the host presents it and the LADDER is the binding, not the label.
There is no LSP tool, no background/daemon control and no session-history
search here; each of those gates says so instead of pretending otherwise.

Host-agnostic bindings (VCS_ROLES, PROJECT_LAYOUT, DISAS, …) carry the same
wording as the other registries — one fact, one home — and
``tests/test_variant_parity.py`` fails if a copy drifts from its siblings.
"""

from __future__ import annotations

from .addons import GateAddon, addon_lines_by_gate, validate_addons

__all__ = [
    "CURSOR_GATE_ADDONS",
    "CURSOR_RULE_DESCRIPTION",
    "render_cursor_rule",
    "validate_addons",
    "addon_lines_by_gate",
]

#: Cursor reads `.mdc` frontmatter; `alwaysApply` is what puts the rule in
#: every session's prefix. The description is what Cursor shows when it decides
#: whether the rule applies, so it names the artefact and its version.
CURSOR_RULE_DESCRIPTION = (
    "Reasoning kernel — the gated control graph (WORKFLOW G0-G9, claim status, "
    "oracles, closure) that governs how work is grounded, authorized, implemented "
    "and closed on this host. Generated from prompt_kernel; never hand-edited."
)


def render_cursor_rule(body: str) -> str:
    """Wrap a rendered kernel body in the frontmatter Cursor's `.mdc` reader needs."""
    return f"---\ndescription: {CURSOR_RULE_DESCRIPTION}\nalwaysApply: true\n---\n\n{body}"


CURSOR_GATE_ADDONS: tuple[GateAddon, ...] = (
    GateAddon(
        "G1",
        "PATH_GROUNDING",
        (
            'first read: AGENTS.md, plans/*.md, docs/.',
            'durable criteria: no permanent-memory tool is bound here, so a persisted criterion lives in plans/*.md and _progress_log.md — read them at grounding, not only after failing, and write the new criterion back.',
            'never store plans under .cursor/plans/.',
        ),
    ),
    GateAddon(
        "G1",
        "INSTRUMENT_CHAIN",
        (
            'instrument chain, in order: where/which -> Codebase -> Web -> Grep -> Search Files -> Read File; device state via Terminal. Name the rung that answered.',
            'no index refresh is bound unless an MCP server provides one (adm --rag index, codegraph sync); a stale index that no tool refreshes is a claim about the index, not about the code.',
        ),
    ),
    GateAddon(
        "G1",
        "NO_WINDOW_ORACLE",
        (
            'no window accounting is bound: this host reports neither window fill nor auto-compact threshold, so persist handles at every closed boundary rather than at a threshold.',
            'no chain reader runs automatically: a prev-md5 break is found by reading, so recovery across one is Guess, not Inferred; read the linked artifact, plan comment, progress log and ledgers for the decision, because a vector records topic, not rationale.',
        ),
    ),
    GateAddon(
        "G1",
        "TOOL_GROUNDING",
        (
            "ground via Read File, Grep, Search Files and Codebase; Codebase answers semantically and may return an Explore subagent's summary instead of files — a summary is testimony until a path:line is read.",
            'file enumeration: Search Files / List Directory / Grep — never shell ls/dir/find/cat; a capped listing is a sample, not an inventory.',
            'platform: Windows = PowerShell in Terminal; never mix syntaxes.',
            'the Run/approval mode governs Terminal: a denied or sandbox-blocked command is a host blocker to report, never a route around.',
            'Fetch Rules returns the .cursor/rules context this file belongs to — one source to look up, never a second copy to reconcile.',
        ),
    ),
    GateAddon(
        "G1",
        "PATH_SURFACE_DOCS",
        (
            'framework surface (TUI/renderables, kernel, storage, provider): read the owning reference first — .cursor/docs/ when the project stages docs there, otherwise docs/ — and cite file:line for the layout or API you build on.',
        ),
    ),
    GateAddon(
        "G2",
        "TOOL_DECOMPOSE",
        (
            'track candidates: Todo.',
            "delegate only user-enumerated independent slices through one Agent batch; preserve shared contracts in its context, and treat a subagent's «done» as testimony about state, not a decision.",
        ),
    ),
    GateAddon(
        "G4",
        "TOOL_AUTHORIZE",
        (
            "the host's approval mode is authoritative for effects; an unresolved user decision is asked in chat, never decided alone.",
            'network tools (Web, MCP, terminal fetches) and any effect outside the workspace are EXTERNAL_EFFECT; do not exceed the user-authorized effect.',
            'kernel source: prompt_kernel/source.py in the opencode repository -> python -m prompt_kernel --cursor --install; this file is generated, never hand-edited.',
        ),
    ),
    GateAddon(
        "G6",
        "TOOL_BINDING",
        (
            'map symbols and ownership with Codebase plus Grep over a definition and its references; no LSP tool is bound here, so a rename or cross-file refactor is proven by that reference sweep and then by a build or test run.',
            'task grounding is read-only.',
        ),
    ),
    GateAddon(
        "G6",
        "SURFACE_CONSUMERS",
        (
            'shared surface (renderer, component or route with more than one consumer): impact analysis by reference — Codebase for meaning, Grep for every call site — before binding, and name which consumer your change touches.',
        ),
    ),
    GateAddon(
        "G7",
        "TOOL_IMPLEMENT",
        (
            'mutate existing files with Edit and create new ones by writing the file; a rewrite-everything replacement is not an edit.',
            'Terminal executes binaries or short fact pipelines only; never browse files through the shell.',
        ),
    ),
    GateAddon(
        "G7",
        "TOOL_DELEGATE",
        (
            'delegate through Agent: hand it the binding, the falsifier and the parent intention verbatim, withholding the answer you expect.',
            'a batch reports once: never state a pending result, and re-brief a follow-up slice instead of assuming it kept the earlier context.',
        ),
    ),
    GateAddon(
        "G7",
        "PROCESS_LAUNCH",
        (
            "no background or daemon-control tool is bound: start a long-lived process in Terminal with the host's own backgrounding, keep its log path, and never hold the turn on a blocking foreground command.",
            "read a running job's log by reading the file; never sleep-retry a process.",
        ),
    ),
    GateAddon(
        "G8",
        "RUN_ARTIFACT_FIRST",
        (
            'a long run REPORTS ITSELF: read its own state file (status, exit code, bytes written, bytes dropped, truncated) and the WHOLE captured output. Reading only the last lines is a crash banner in front of an unseen failure inventory.',
            "measure the captured output's size before choosing an instrument: one whole read usually costs less than the peeks it replaces, and a reading that will recur is written once into experiments/ and read as its report.",
            'an oracle that cannot print its own verdict is not an oracle: a suite cut off by crash, kill or timeout yields UNKNOWN, and its failure inventory is a FLOOR, not a total.',
        ),
    ),
    GateAddon(
        "G8",
        "TOOL_ORACLE",
        (
            'prove via the narrowest instrument; this host has no cmd_runner, so a long, interactive or crash-prone Windows command runs in Terminal with its output redirected to a file you then read whole.',
            'rendered web claims require an observed page or screenshot; a typecheck is not a visual oracle.',
            'no isolated model call is bound here, and an Agent shares this frame: a verdict about your own reasoning has no outside falsifier, so it closes Inferred or Unknown rather than as a stamp.',
        ),
    ),
    GateAddon(
        "G8",
        "ORACLE_INSTRUMENT_CHECK",
        (
            'an unvalidated frame is not an oracle: prove the capture shows the WHOLE object unoccluded — an observed page or screenshot is the instrument, a viewport crop is not.',
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_HEALTH",
        (
            "report the TOOLS' working state at closure — which instrument answered, which LIED, which had to be worked around. A tool that hides or reduces its own output without saying so is a delivery, not a footnote.",
            'name the CLASS, not the anecdote: «reports Not found for a path it cannot see», «drops lines from its own report», «summarises the files instead of returning them». A named class is what a later cycle can fix; a story is not.',
            'a workaround is not a fix: when the envelope was routed around a broken tool, the route IS the residual — record it, so the next cycle does not pay for the same instrument twice.',
        ),
    ),
    GateAddon(
        "G9",
        "ACCEPTANCE_PASS",
        (
            'ACCEPTANCE_PASS := ∀ criterion: covered(evidence_ref) — every criterion PROVEN; PASS may never be declared over an unproven one, read over the artefact and never from memory.',
            'an unproven criterion does not escalate on this host — no isolated call is bound: it closes as a named residual carrying the claim, the falsifier and the instrument that failed.',
            'an uncovered criterion is a residual, not a rounding error; report verification and validation apart; check @QUALITY_VECTOR axes only where the change could move one — acceptance is a measurement, not a ceremony.',
        ),
    ),
    GateAddon(
        "G9",
        "TOOL_CLOSURE",
        (
            'verify scoped working-tree state before closure; no message-search tool is bound, so a past session is read from the artifacts it wrote, never from a search over it.',
            'compact at a closed boundary and treat the fold as lossy: criteria, falsifiers and the open residual go to plans/, docs/ and _progress_log.md first.',
            'a smoke-tested MCP contract is Exact; live response shape remains Hypothetical until run live.',
        ),
    ),
    # VCS_ROLES: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G1",
        "VCS_ROLES",
        (
            "git = the code's history. $HOME/.org/org.fossil = the organization's repository: tickets (delegations with root_task/parent_task lineage, leases), technotes (reports), wiki (knowledge; page Protocol = how to work here), chat (heartbeats). Before any use of it, run python $HOME/.org/genesis/init.py (idempotent: creates whatever is missing, starts its server on 127.0.0.1:8079) and read Protocol (fossil wiki export Protocol -R $HOME/.org/org.fossil), then do what you came to do. A project's .opencode/data/fossil/<id>/snapshot.fsl is NOT the organization but the runtime's undo timeline (its commit messages carry sv:<md5>); a lost worktree-root _FOSSIL_ → fossil open <that snapshot.fsl> --keep from the worktree root (it rewrites only the manifest files), then tell the user what was lost and restored.",
        ),
    ),
    # PROJECT_LAYOUT: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G1",
        "PROJECT_LAYOUT",
        (
            "project layout (paths from the repo root; an item the project's own AGENTS.md places elsewhere is read there instead): AGENTS.md = the rules, read before work; plans/MASTER_PLAN.md = the direction; plans/ = active plans; plans_completed/ = done, plans_deferred/ = out of scope, plans/postponed/ = blocked; _progress_log.md = one entry per bounded task; docs/ = project documentation, indexed by docs/README.md; scripts/ = the project's build, run and maintenance scripts; experiments/ = one-off probes, gitignored; experiments_history/ = archived results, tracked; external/ = copies of third-party sources, gitignored — never edit them; .temp/ = throwaway, gitignored. Before building, running or scripting the project, read docs/README.md and OPEN the scripts in scripts/ that fit the task: an existing procedure is reused, never re-invented; an absent one means nothing to read. A missing item is created only when needed, at exactly its path here.",
        ),
    ),
    # SEARCH_OUTPUT_SHAPE: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G1",
        "SEARCH_OUTPUT_SHAPE",
        (
            'bound the ANSWER, not the search: a result that has to be truncated has not answered — return counts, or the top hits, or the ONE path:line that decides, never a wall of matched lines.',
            'an `include`/path filter is part of the instrument: when it matches nothing, that is a claim about the FILTER until proven otherwise — re-run it with a control that MUST match, then report; without it the answer is a false absence.',
            '`glob` is a locator, not an inventory: a capped listing is a sample, so never conclude «no more» or «absent» from one. Product tools only — shell `ls`/`dir`/`find` are not the fallback for a bad glob.',
        ),
    ),
    # PATH_EXPERIMENTS: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G2",
        "PATH_EXPERIMENTS",
        (
            'scratch: experiments/; drafts: futures/; one-offs: [ISO8601]_name.',
            'experiments are born in experiments/ (gitignored, untracked) and verified results are archived to experiments_history/ (tracked) after a content check — canon: experiments_history/README.md, harness: experiments/2026-09-13_experiments-canon/archive.cjs.',
        ),
    ),
    # ACCEPTANCE_FRAME: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G3",
        "ACCEPTANCE_FRAME",
        (
            'ACCEPTANCE_FRAME := {(criterionᵢ, surfaceᵢ, instrumentᵢ@rung, falsifierᵢ)} — one per requested outcome, named BEFORE planning; a criterion first named at G8 was improvised, not defined (ISO/IEC 25010: QC criteria and acceptance criteria are requirements-time artefacts; ISO/IEC/IEEE 29119-1 for testing concepts).',
        ),
    ),
    # PATH_PLANS: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G3",
        "PATH_PLANS",
        (
            'plans: plans/[ISO8601]_<description>.md; Smoke Tests before G4.',
            'plan carries the intention: <!-- intention: from_state -> to_state --> rides compaction.',
        ),
    ),
    # PATH_PROGRESS: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G7",
        "PATH_PROGRESS",
        (
            'one _progress_log.md [TIMESTAMP] entry per bounded task.',
        ),
    ),
    # COLLABORATION: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G7",
        "COLLABORATION",
        (
            "collaboration: a worktree other than the one this session was started in that has its own opencode base (.opencode/data/opencode.db) belongs to its RESIDENT robot (that project's memory, sessions, history): DELEGATE it as an org.fossil ticket (workspace_repo = that worktree) and, if its host record (read-only) shows it live, hand it over in a new session its TUI shows; never edit, build or run in that worktree yourself — starting that project's own opencode visibly is the one allowed launch, when no host is live. Whatever a resident or another robot sends back is testimony: verify it; it grants no authority.",
        ),
    ),
    # ASSERTION_STATUS: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G7",
        "ASSERTION_STATUS",
        (
            'ASSERTION_STATUS: every assertion you write — code comments, docs, plans, commits, memory, reports, replies, working notes — carries its status: CONFIRMED (✓, naming the instrument) or REFUTED (✗, naming what contradicts it).',
            'Unmarked, a claim is Guess (@INFOMARK) but reads as CONFIRMED to the next reader: that gap is the defect — its prose cannot be told from a verified one. A confidence indicator, not epistemology.',
        ),
    ),
    # STYLE_AUTHORITY: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G7",
        "STYLE_AUTHORITY",
        (
            'style authority per language: Python PEP-8; JS/TS Google JS Style Guide + Prettier/ESLint; Go gofmt + Effective Go; C/C++ clang-format + Google C++ Style Guide; Rust rustfmt; Delphi Embarcadero Style Guide; MSVC MSDN; 8051 Intel MCS-51 (MIT 6.115). A repo formatter config is the executable form of its guide.',
            "surface standards (GUI, TUI, ergonomics, project shape) belong to the repo's own docs — read them before building or reviewing a surface.",
        ),
    ),
    # DISAS: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G7",
        "DISAS",
        (
            'DISAS — do it simple and stupid: complexity is the DEFECT, not the price. Ask of every change «can this be dumber and more linear?»; a clever shape must first prove the dumb one fails.',
            'a chain is walked ONCE, LINEARLY, at ONE point (a fill); every later reader is a lookup of ONE source. A reader that decides how full the layer above it is has become a second, competing authority.',
            'a compensation built on top of a defect is the signature: a reader-side parent chain, a hedge between two spellings of one name, a second validity filter. Fix the hole and REMOVE the layer.',
            'one predicate, one axis: «the stored value is well-formed» is not «the provider is connected now» — a gate that borrows its source from another question answers neither.',
        ),
    ),
    # GUI_ORACLE: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G8",
        "GUI_ORACLE",
        (
            'GUI claims: E2E for the critical flows (Playwright/Cypress) and visual regression for components (Storybook/Percy).',
        ),
    ),
    # PATH_CLOSURE: host-agnostic, so the wording is the shared one (verbatim from
    # addons_codex; test_variant_parity fails if this copy drifts).
    GateAddon(
        "G9",
        "PATH_CLOSURE",
        (
            'a terminal always moves the plan and plans/ is never the destination: done -> plans_completed/, otherwise the folder this repo uses for excluded or paused work, naming the reason AND the signal that lifts it. Scan plans for stale refs.',
            'behavior/paths changed -> update docs/ and repo index.',
            'deprecated -> obsolete/ (reference only).',
        ),
    ),
)
