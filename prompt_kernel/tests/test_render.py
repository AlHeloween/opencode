from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from prompt_kernel import KERNEL, kernel_digest, render_kernel, render_review, write_artifacts


def test_runtime_is_map_first_and_progressively_refined() -> None:
    text = render_kernel(KERNEL)
    sections = (
        "## 0. KERNEL_MAP",
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
    assert "Uncertain identity → getmode." in block
    assert "@GETMODE" not in block


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
    assert "#### @SV_TRAJECTORY" in text
    assert "#### @SEMANTIC_CONTROL" in text
    assert "Steering assignment" in text
    assert "Measure only:" in text
    assert "regenerated" in text
    assert "coefficients" in text
    trajectory = text[text.index("#### @SV_TRAJECTORY") : text.index("#### @MULTI_AGENT_SV")]
    assert "regenerat" not in trajectory
    assert "coefficients" not in trajectory
    target = text[text.index("#### @SV_TARGET") : text.index("#### @SV_TRAJECTORY")]
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
    assert "refine local simulation" in text
    assert "not Exact medoids" in text
    assert "known Exact basis" in text
    assert "Unknown, do not keep turning them" in text
    # Divergence protocol (2026-09-02, Alexander): one fused rule — a
    # contradiction demotes the contested claim to Unknown immediately,
    # oracle data is the only reward channel, affect routes to medoids.
    assert "#### @DIVERGENCE_PROTOCOL" in text
    assert "demotes it to Unknown" in text
    assert "Reward is oracle data only" in text
    assert "acquire medoids" in text
    assert "signals an oracle gap" in text
    assert "averaging toward it is treatment" in text


def test_gate_details_follow_numeric_order() -> None:
    text = render_kernel(KERNEL)
    offsets = tuple(text.index(f"### G{i} ") for i in range(1, 10))
    assert offsets == tuple(sorted(offsets))


def test_dictionary_precedes_first_detailed_rule_use() -> None:
    text = render_kernel(KERNEL)
    assert "at-prefixed uppercase identifier" in text
    assert "@NAME" not in text
    assert text.index("## 1. ABI_AND_VOCABULARY") < text.index("1.2 @SV_FORMAT")
    assert text.index("1.2 @SV_FORMAT") < text.index("#### @EVIDENCE_ORDER")
    assert text.index("#### @EVIDENCE_ORDER") < text.index("## 3. GATE_REFINEMENT")


def test_rule_definitions_are_unique_in_rendered_kernel() -> None:
    text = render_kernel(KERNEL)
    rule_ids = [rule.id for rule in KERNEL.shared_rules]
    rule_ids.extend(rule.id for gate in KERNEL.gates for rule in gate.local_rules)
    rule_ids.extend(rule.id for protocol in KERNEL.protocols for rule in protocol.local_rules)
    for rule_id in rule_ids:
        assert text.count(f"#### @{rule_id}\n") == 1


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
