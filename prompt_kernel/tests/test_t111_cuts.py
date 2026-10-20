"""t111 commit 1 — 35 owner-approved cuts (2026-10-20).

RED on HEAD (old spans present), GREEN after cuts (old absent, homes present).
STOPPED (render-only, not in source.py/addons as quoted): #4 H01, #7 H02, #22 DUP-05.
Provenance: owner-approved cut #N, 2026-10-20.
"""
from __future__ import annotations

import pytest

from prompt_kernel import KERNEL, render_kernel
from prompt_kernel.addons import GATE_ADDONS
from prompt_kernel.addons_claude import CLAUDE_GATE_ADDONS
from prompt_kernel.addons_codex import CODEX_GATE_ADDONS
from prompt_kernel.addons_cursor import CURSOR_GATE_ADDONS

VARIANTS = {
    "product": (GATE_ADDONS, None),
    "claude": (CLAUDE_GATE_ADDONS, ()),
    "codex": (CODEX_GATE_ADDONS, ()),
    "cursor": (CURSOR_GATE_ADDONS, ()),
}

# (cut_no, old_span, variants_to_check)
# Old spans are verbatim from DECISIONS.md / VERIFIED.md / DAIS audit edits[].
CUTS = [
    (1, ", on fixtures, under @TOOLCHAIN_QUALIFICATION; a qualified instrument goes STALE on a tool, driver or environment change (@TOOLCHAIN_QUALIFICATION)", ("product", "claude", "codex", "cursor")),
    (2, "A finite run limit persists unfinished task + next action + receipt for resumption, never invents completion. ", ("product", "claude", "codex", "cursor")),
    (3, ", Universal Search hybrid (POST 127.0.0.1:3005/hybrid, then /web/context for content_hash)", ("claude",)),
    (5, "Convert uncovered acceptance gaps \u2192 bounded residual, take declared back move.", ("product", "claude", "codex", "cursor")),
    (6, "; a static copy is not a leg", ("product", "claude", "codex", "cursor")),
    (6, "A doc that is only read is not a leg. ", ("product", "claude", "codex", "cursor")),
    (8, "source_stamp {authority_class, url_provenance, content_hash}", ("product", "claude", "codex", "cursor")),
    (9, "@MEDOID_SIMPLEX's category test still governs the claim as a whole; ", ("product", "claude", "codex", "cursor")),
    (10, " and carries its UNIQUE-DETECTION receipt", ("product", "claude", "codex", "cursor")),
    (11, "Emit DOMAIN_TERMS [{term, definition, source_ref, content_hash}]", ("product", "claude", "codex", "cursor")),
    (11, "a missing source_ref keeps G1 open, and source_ref: Unknown with the search receipt closes it as residual; no plan step rests on that term.", ("product", "claude", "codex", "cursor")),
    (12, ", and already-qualified standard tools (compiler, test runner) are not re-qualified per use", ("product", "claude", "codex", "cursor")),
    (13, "Confine effects to authorized envelope; leave", ("product", "claude", "codex", "cursor")),
    (14, "Count signals not lines: identical diagnostics from one source = ONE signal. ", ("product", "claude", "codex", "cursor")),
    (15, "; uncovered intent = residual. Partial REAL > complete simulated.", ("product", "claude", "codex", "cursor")),
    (16, "; finite run \u2260 task completion.", ("product", "claude", "codex", "cursor")),
    (17, " \u2014 every criterion PROVEN; PASS may never be declared over an unproven one, read", ("product", "claude", "codex", "cursor")),
    (18, "an uncovered criterion is a residual, not a rounding error; report", ("product", "claude", "codex", "cursor")),
    (19, " Finite counters hold; persist unfinished work when the run ends.", ("product", "claude", "codex", "cursor")),
    (20, "Recall and user assertions are testimony", ("product", "claude", "codex", "cursor")),
    (20, "a \u00abdone\u00bb or a closed ticket, the user's included, is testimony about state, not a decision", ("product", "claude", "codex", "cursor")),
    (21, "Filename presence and DONE testimony are insufficient.", ("product", "claude", "codex", "cursor")),
    (23, "Repeating unchanged revision/predicate/inputs/harness with no new discriminating basis = STALL:", ("product", "claude", "codex", "cursor")),
    (24, "A defect is a claim per @STATUS_CLAIM:", ("product", "claude", "codex", "cursor")),
    (25, "Choose the instrument by the layer the problem lives on, not by what is nearest: the adjacent layer returns accurate data about a different process, and right numbers end the search.", ("product", "claude", "codex", "cursor")),
    (26, "without it the answer is a false absence.", ("product", "claude", "codex", "cursor")),
    (26, "so never conclude \u00abno more\u00bb or \u00ababsent\u00bb from one.", ("product", "claude", "codex", "cursor")),
    (27, "plus a new test failing on the missing behavior.", ("product", "claude", "codex", "cursor")),
    (28, "and may specialize the kernel but never weaken its evidence, authority, oracle, intention or closure invariants.", ("product", "claude", "codex", "cursor")),
    (29, "Edits invalidate it;", ("product", "claude")),
    (30, "tiers 1-2 \u2192 the oracle may run; tier 3 \u2192 Unknown, tier 4 \u2192 Unknown + @RISK_LEDGER, neither ever proven", ("product", "claude", "codex", "cursor")),
    (31, "Silence/failed verification \u2192 bounded follow-up/current receipt or permitted executor.", ("product", "claude", "codex", "cursor")),
    (32, "never file browsing \u2014 use Glob/Grep/Read.", ("claude",)),
    (32, "shell ls/dir scans are not evidence \u2014 Glob/Grep/Read only.", ("claude",)),
    (33, "map symbols/ownership: codegraph_explore (if .codegraph/) else Grep/Glob/Read; read-only.", ("claude",)),
    (34, "on task's Exact medoids only", ("product", "claude", "codex", "cursor")),
    (35, "the installed .txt is generated, never hand-edited.", ("product", "claude", "codex", "cursor")),
]

HOMES = [
    "@TOOLCHAIN_QUALIFICATION",
    "@SOURCE_ROUTING",
    "@SOURCE_STAMP",
    "@DOMAIN_TERMS",
    "@RESIDUAL_ROUTING",
    "@STATUS_CLAIM",
    "@ANTI_CHURN",
    "@DIVERGENCE_PROTOCOL",
    "@TEST_INVARIANT",
    "@SAFETY_PRECEDENCE",
    "@LEAN_RANKING",
    "@ORACLE_ROLE",
    "@SV_TARGET",
]


@pytest.mark.parametrize("variant", tuple(VARIANTS))
def test_cuts_absent_and_homes_present(variant) -> None:
    """Owner-approved cut #N, 2026-10-20: each cut span absent, each home present."""
    addons, identity_addons = VARIANTS[variant]
    text = render_kernel(KERNEL, addons, identity_addons) if identity_addons is not None else render_kernel(KERNEL, addons)
    for cut_no, old, variants in CUTS:
        if variant not in variants:
            continue
        assert old not in text, f"cut #{cut_no} still present in {variant}: {old!r}"
    for home in HOMES:
        assert home in text, f"canonical home missing in {variant}: {home}"
