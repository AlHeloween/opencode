from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from prompt_kernel import KERNEL, kernel_digest, render_kernel, render_review, write_artifacts
from prompt_kernel.render import _named_rule_ids


def test_runtime_is_map_first_and_progressively_refined() -> None:
    text = render_kernel(KERNEL)
    sections = (
        "## 0. WORKFLOW",
        "## 1. ABI_AND_VOCABULARY",
        "## 2. SHARED_RULES",
        "## 3. GATE_REFINEMENT",
        "## 4. CROSS_CUTTING_PROTOCOLS",
        "## 5. IDENTITY_CONTRACTS",
    )
    offsets = tuple(text.index(section) for section in sections)
    assert offsets == tuple(sorted(offsets))
    assert text[: offsets[0]].strip() == ""


def test_identity_headings_are_entity_names_not_host_slugs() -> None:
    text = render_kernel(KERNEL)
    block = text[text.index("## 5. IDENTITY_CONTRACTS") :]
    assert "### BUILD_MODE\nkind: primary\n" in block
    assert "### PLAN_MODE\nkind: primary\n" in block
    assert "### REASONING_MODE\nkind: primary\n" in block
    assert "### build_mode\n" not in block
    assert "runtime: " not in block
    assert "Uncertain identity or permission → inspect the host runtime's authorization surface." in block


def test_kernel_does_not_restate_entities_under_three_spellings() -> None:
    text = render_kernel(KERNEL)
    for banned in (
        "sv_state",
        "sv_target:",
        "sv_contract",
        "information_status:",
        "source_routing @",
        "#### @SV_STATE",
        "#### @SV_OUTPUT",
        "#### @SV_EVERY_TURN",
        "Emit @SV_FORMAT",
        "emit: after every response",
        "GATE_1_GROUND / GROUND",
        "GATE_1_GROUND — GROUND",
        "### G1 GATE_1_GROUND",
        "Manhattan_L1",
        "#### @CACHE_STABILITY",
        "#### @SUCCESS_COMPLETED",
    ):
        assert banned not in text, banned
    assert "1.2 @SV_FORMAT:" in text
    assert "```yaml\nKeywords: topic1 0.35" in text
    assert "parent-goal-md5:" in text
    assert "### G1 GROUND" in text
    assert "### G4 AUTHORIZE" in text
    assert "#### @CURRENT_SV" in text
    assert "#### @SV_TARGET" in text
    assert "- Measure only:" in text
    assert "#### @SEMANTIC_CONTROL" in text
    assert "Steering assignment" in text
    assert "Measure only:" in text
    assert "regenerated" in text
    assert "coefficients" in text
    attention = text[text.index("<SEMANTIC_ATTENTION_RULES>") : text.index("</SEMANTIC_ATTENTION_RULES>")]
    # anchor moved 2026-09-12: MULTI_AGENT_SV lost its hand-over clause to G7
    # DELEGATION_BINDING, so the rule now opens "A sub-agent returns...".
    trajectory = attention[attention.index("- Measure only:") : attention.index("- A sub-agent returns")]
    assert "regenerat" not in trajectory
    assert "coefficients" not in trajectory
    target = attention[attention.index("#### @SV_TARGET") : attention.index("- Measure only:")]
    assert "current observed" not in target
    assert "complex action" not in target
    assert "1.3 @SOURCE_ROUTING:" in text
    assert "1.1 @INFOMARK" in text
    assert "promotion: @INFORMATION_STATUS" in text
    assert "simulation never equals reality" in text
    assert "failed proof -> Unknown" in text
    assert "statuses: @INFORMATION_STATUS" in text
    assert "Generic web never becomes Inferred" in text
    assert "Neither simulation is the oracle" in text
    assert "Hallucination-cure priors" in text
    assert "Do not treat simulation error" in text
    assert "#### @SIMULATION_ERROR" in text
    assert "distort the simulation silently, then it collapses" in text
    assert "still a result" in text
    assert "Pass pins Exact medoids" in text
    assert "enough Exact medoids" in text
    assert "renormalize on Exact basis" in text
    assert "non-Exact medoid axes" in text
    assert "don't keep turning" in text
    # Divergence protocol (2026-09-02, Alexander): runtime evidence owns
    # reversible stamps; contradiction demotes, while affect only opens a gap.
    assert "#### @DIVERGENCE_PROTOCOL" in text
    assert "Only eligible runtime evidence" in text
    assert "revoke stamp" in text
    assert "set Unknown" in text
    # 2026-09-24: the PULL half. Divergence only ever arrived as new evidence, so a stamp
    # read back after a fold was trusted however far its artifact had moved — the one
    # "recorded, never re-read" the outside review found. The digest is compared, unlike
    # @SV_FORMAT.md5, which the same kernel forbids computing.
    assert "re-digest before relying on ledger/plan/memory" in text
    assert "unobtainable content_hash" in text
    assert "Digest computed+compared (≠ @SV_FORMAT.md5)" in text
    assert "evidence_ref" in text
    assert "claim digest" in text
    # K-3 (2026-09-12): a negative oracle result had nowhere to live, which made
    # mutation and differential oracles inexpressible — killed mutant is an
    # EXPECTED_FAIL, not a divergence.
    # 2026-09-24: `content_hash?` added. The pin is the three RESULTS, not a frozen field
    # list — a stamp with no digest cannot be revalidated later, so @DIVERGENCE_PROTOCOL's
    # read-back check had nothing to compare against. Optional because evidence that is not
    # an artifact (a live probe) has no stable digest to record.
    assert "ORACLE_STAMP: {claim_id, evidence_ref, layer, result: PASS | FAIL | EXPECTED_FAIL, content_hash?}" in text
    assert "DIVERGENCE_EVENT: {claim_id, evidence_ref}" in text
    assert "Locate Exact medoids" in text
    assert "Affect opens oracle gap" in text
    assert "never reward" in text


def test_gate_details_follow_numeric_order() -> None:
    text = render_kernel(KERNEL)
    offsets = tuple(text.index(f"### G{i} ") for i in range(0, 10))
    assert offsets == tuple(sorted(offsets))
    # G0 UNDERSTAND: language + intention discipline precede all project gates.
    assert "### G0 UNDERSTAND" in text
    assert text.index("### G0 UNDERSTAND") < text.index("### G1 GROUND")
    assert "reasoning included" in text
    assert "Digital Intention" in text


def test_dictionary_precedes_first_detailed_rule_use() -> None:
    text = render_kernel(KERNEL)
    assert "at-prefixed uppercase identifier" in text
    assert "@NAME" not in text
    assert text.index("## 1. ABI_AND_VOCABULARY") < text.index("1.2 @SV_FORMAT")
    assert text.index("1.2 @SV_FORMAT") < text.index("#### @EVIDENCE_ORDER")
    assert text.index("#### @EVIDENCE_ORDER") < text.index("## 3. GATE_REFINEMENT")


def test_rule_definitions_follow_reference_naming() -> None:
    text = render_kernel(KERNEL)
    named = _named_rule_ids(KERNEL)
    rule_ids = [rule.id for rule in KERNEL.shared_rules]
    rule_ids.extend(rule.id for gate in KERNEL.gates for rule in gate.local_rules)
    rule_ids.extend(rule.id for protocol in KERNEL.protocols for rule in protocol.local_rules)
    for rule_id in rule_ids:
        expected_headers = 1 if rule_id in named else 0
        assert text.count(f"#### @{rule_id}\n") == expected_headers, rule_id


def test_runtime_is_followable_without_opening_the_adid_document() -> None:
    """Owner decision 2026-09-28 03:08: ADID citations are provenance, never required reading.

    A role the runtime never defines is not a shortcut, it is a hole — `Analyst2` and `Oracle2`
    name entities with no contract in this kernel, so a rule phrased through them tells the
    reader to go and look them up instead of telling it what to do. The four stop cases and
    both self-trigger conditions must therefore survive as kernel vocabulary, or the cleanup
    would have deleted a decision to buy a shorter line.
    """
    text = render_kernel(KERNEL)
    for undefined in ("Analyst1", "Analyst2", "Oracle2", "Mode 2 Fractal Generation", "Mode 2 for"):
        assert undefined not in text, undefined
    stop = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "BOUNDED_STOP_CONDITIONS")
    for case in (
        "passes every test case",
        "3 failed corrective attempts",
        "immutable external dependency",
        "structurally futile",
    ):
        assert case in stop, case
    assert "NOT SUCCESS" in stop, "a bounded stop must not read as closure"
    # The classification is a GATE between clustering and selection, and an absent classification
    # reads as REJECTED — the project's own rule that a missing indicator means "not working", not
    # "probably fine". The second clause exists because tier 1 says "fully verified", which reads
    # like a finished task; only @ORACLE verifies a task, and no tier may stand in for it.
    lean = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "LEAN_RANKING")
    assert "AFTER clustering and BEFORE selection" in lean
    assert "an unclassified candidate is not selectable" in lean
    assert "reads as rejected and never as acceptable" in lean
    assert "ranks the candidate's INFORMATION QUALITY, never the task's completion" in lean
    for tier in ("(1) Fully Verified", "(2) Minor Inaccuracy", "(3) Major Contradiction", "(4) Unusable"):
        assert tier in lean, tier

    # Independence is per nesting level. Under fractal nesting a parent and its child can share
    # one source, which would satisfy "≥3 medoids with independent sources" with three names for
    # one explanation — the exact degeneracy the rule exists to reject, reachable one level down.
    simplex = next(rule.text for gate in KERNEL.gates for rule in gate.local_rules if rule.id == "MEDOID_SIMPLEX")
    assert "independence is measured WITHIN one nesting level" in simplex
    assert "a parent and its child never count as two sources" in simplex

    triggers = {rule.id: rule.text for protocol in KERNEL.protocols if protocol.id == "EVOLUTION_LOOP" for rule in protocol.local_rules}
    assert "closed or stalled" in triggers["SELF_TRIGGER_A"]
    assert "≥10 message history" in triggers["SELF_TRIGGER_B"]
    # The mechanism is named once. G2's fractal decomposition is the only generator, so a
    # trigger that also says «propose … candidates» is a third statement of it — and that is
    # what made the ADID «Mode 2» layer read as a second, competing mode. Pinned so the
    # duplication cannot grow back with a well-meaning edit.
    candidates = triggers["EVOLUTION_CANDIDATES"]
    assert "cluster @L1_DISTANCE" in candidates
    for rule_id in ("SELF_TRIGGER_A", "SELF_TRIGGER_B", "SELF_TRIGGER"):
        assert "propose" not in triggers[rule_id].lower(), rule_id


def test_structured_predicates_do_not_shorten_rendered_rule_meaning() -> None:
    """A machine-readable predicate is not a replacement for the owner's rule text."""
    text = render_kernel(KERNEL)
    for gate in KERNEL.gates:
        for rule in gate.local_rules:
            if rule.predicate is not None:
                assert rule.text in text, f"{gate.id}.{rule.id} lost its source clause"


def test_runtime_is_deterministic_lf_and_within_utf8_budget() -> None:
    first = render_kernel(KERNEL)
    second = render_kernel(KERNEL)
    assert first == second
    assert "\r" not in first
    assert first.endswith("\n")
    assert len(first.encode("utf-8")) <= KERNEL.utf8_budget
    assert kernel_digest(KERNEL) == hashlib.sha256(first.encode("utf-8")).hexdigest()


def test_review_wraps_exact_runtime_body() -> None:
    runtime = render_kernel(KERNEL)
    review = render_review(KERNEL)
    assert review.endswith(runtime)
    assert review.count(runtime) == 1


def test_writer_only_publishes_stamped_dist_artifacts(tmp_path: Path) -> None:
    stamp = "2026-09-01_19-27-54"
    paths = write_artifacts(dist=tmp_path, stamp=stamp)
    assert paths == (
        tmp_path / f"{stamp}_reasoning_prompt.mdc",
        tmp_path / f"{stamp}_reasoning_prompt.txt",
    )
    assert paths[0].read_text(encoding="utf-8") == render_review(KERNEL)
    assert paths[1].read_text(encoding="utf-8") == render_kernel(KERNEL)
    assert (tmp_path / f"{stamp}_manifest.json").is_file()
    assert (tmp_path / f"{stamp}_migration_report.json").is_file()
    assert not (tmp_path / "reasoning_prompt.txt").exists()
    package = Path(__file__).resolve().parents[1]
    with pytest.raises(TypeError):
        write_artifacts(package.parent)  # type: ignore[call-arg]


def test_writer_rejects_unreadable_stamp(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="build stamp"):
        write_artifacts(dist=tmp_path, stamp="latest")


def test_next_package_has_no_runtime_import_from_legacy_precompiled_kernel() -> None:
    package = Path(__file__).resolve().parents[1]
    sources = "\n".join(path.read_text(encoding="utf-8") for path in sorted(package.glob("*.py")))
    assert "prompts_kernel._kernel_precompiled" not in sources
    assert "prompt_research_candidate" not in sources


def test_pre_action_section_stays_small() -> None:
    """G0+G1 is what an agent must read and SATISFY before its first instrument call.

    2026-09-24: it had grown 2_840 -> 7_309 B (x2.6) against the battle-tested 09-17 build, and a
    third of G1 was catalogues that help build a surface but never help find one. An imperative
    that is not a call can only be satisfied by PROSE, so mass moved forward in the pass buys
    narration instead of grounding — and one flat total ceiling cannot see that, because the total
    barely moved. This cap is the axis that can.

    Measured after the eviction: 5_365 B. The band is the next one above it.
    """
    from prompt_kernel.addons import GATE_ADDONS

    text = render_kernel(KERNEL, GATE_ADDONS)
    section = 0
    for gate in ("G0", "G1"):
        block = text[text.index(f"<{gate}_RULES>") : text.index(f"</{gate}_RULES>")]
        section += len(block.encode("utf-8"))
    assert section <= 5_600, section
