"""Targeted tests for opencode_prompts_kernel (epistemic)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    ClaimNode,
    EPISTEMIC_NODE_TYPES,
    PROJECTION_LIBRARY,
    QUESTION_TYPES,
    ResearchKernel,
    get_projection_by_name,
    get_projection_names,
    resolve_precedence,
    select_projection,
)

class TestEpistemicProjection:
    """Validate discipline projection system — research kernel, epistemic nodes,
    discipline projections, and precedence rules."""

    def test_research_kernel_defaults(self):
        """ResearchKernel creates with sensible defaults."""
        rk = ResearchKernel()
        assert rk.question_type == "descriptive"
        assert rk.scope["population"] == ""
        assert rk.ontology["entities"] == []
        assert rk.evidence["sources"] == []
        assert rk.uncertainty["unknowns"] == []
        assert rk.invariants == []
        assert rk.falsifiers == []
        assert rk.acceptance_tests == []
        assert rk.forbidden_actions == []

    def test_research_kernel_custom(self):
        """ResearchKernel accepts custom values."""
        rk = ResearchKernel(
            objective="Test effect of X on Y",
            question_type="causal",
            assumptions=["Linear relationship"],
            falsifiers=["No effect detected"],
        )
        assert rk.objective == "Test effect of X on Y"
        assert rk.question_type == "causal"
        assert rk.assumptions == ["Linear relationship"]
        assert rk.falsifiers == ["No effect detected"]

    def test_research_kernel_invalid_question_type(self):
        """ResearchKernel accepts any string for question_type (no enum yet)."""
        rk = ResearchKernel(question_type="invalid_type")
        assert rk.question_type == "invalid_type"

    def test_epistemic_node_types(self):
        """EPISTEMIC_NODE_TYPES must include all core claim types."""
        required = {"definition", "observation", "measurement", "hypothesis",
                     "causal_claim", "normative_claim", "uncertainty_statement"}
        for node in required:
            assert node in EPISTEMIC_NODE_TYPES, f"Missing epistemic node: {node}"

    def test_question_types(self):
        """QUESTION_TYPES must include all core question types."""
        required = {"descriptive", "comparative", "causal", "predictive",
                     "mechanistic", "normative", "interpretive"}
        for qt in required:
            assert qt in QUESTION_TYPES, f"Missing question type: {qt}"

    def test_claim_node_defaults(self):
        """ClaimNode creates with empty defaults."""
        cn = ClaimNode()
        assert cn.claim_type == ""
        assert cn.subject == ""
        assert cn.source == ""

    def test_claim_node_custom(self):
        """ClaimNode accepts structured claim data."""
        cn = ClaimNode(
            claim_type="causal_claim",
            subject="education",
            relation="affects",
            object="income",
            population="urban adults",
            evidence="panel data",
            identification="fixed effects",
        )
        assert cn.claim_type == "causal_claim"
        assert cn.subject == "education"
        assert cn.identification == "fixed effects"

    def test_nine_projections_loaded(self):
        """PROJECTION_LIBRARY must have all 9 expected projections."""
        assert len(PROJECTION_LIBRARY) == 9
        expected = {"natural_science", "physics", "chemistry", "biology",
                     "social_science", "economics", "psychology", "sociology", "history"}
        assert set(PROJECTION_LIBRARY.keys()) == expected

    def test_each_projection_has_name(self):
        """Every projection has a name and version."""
        for name, proj in PROJECTION_LIBRARY.items():
            assert proj.name == name, f"Projection name mismatch: {proj.name} != {name}"
            assert proj.version == "1.0"

    def test_parent_relationships(self):
        """Sub-disciplines have valid parent references."""
        parent_map = {
            "physics": "natural_science",
            "chemistry": "natural_science",
            "biology": "natural_science",
            "economics": "social_science",
            "psychology": "social_science",
            "sociology": "social_science",
            "history": "social_science",
        }
        for child, expected_parent in parent_map.items():
            proj = PROJECTION_LIBRARY[child]
            assert proj.parent == expected_parent, (
                f"{child}.parent should be {expected_parent}, got {proj.parent}"
            )
            assert expected_parent in PROJECTION_LIBRARY, (
                f"Parent projection {expected_parent} not in library"
            )

    def test_disciplines_have_kernel_projections(self):
        """All discipline projections must have kernel_projection with
        at minimum: invariants and forbidden_actions."""
        for name, proj in PROJECTION_LIBRARY.items():
            kp = proj.kernel_projection or {}
            has_invariants = "invariants" in kp and len(kp["invariants"]) > 0
            has_forbidden = "forbidden_actions" in kp and len(kp["forbidden_actions"]) > 0
            assert has_invariants or has_forbidden, (
                f"{name}: missing invariants and forbidden_actions in kernel_projection"
            )

    def test_select_projection_economics(self):
        """select_projection returns Economics with Social Science parent."""
        projections = select_projection("economics")
        assert len(projections) >= 1
        names = [p.name for p in projections]
        assert "social_science" in names, "Economics should inherit social_science"
        assert "economics" in names

    def test_select_projection_physics(self):
        """select_projection returns Physics with Natural Science parent."""
        projections = select_projection("physics")
        names = [p.name for p in projections]
        assert "natural_science" in names
        assert "physics" in names

    def test_select_projection_unknown(self):
        """select_projection returns empty for unknown discipline."""
        projections = select_projection("unknown_discipline")
        assert len(projections) == 0

    def test_get_projection_names(self):
        """get_projection_names returns all 9 names."""
        names = get_projection_names()
        assert len(names) == 9
        assert "economics" in names
        assert "physics" in names

    def test_get_projection_by_name_found(self):
        """get_projection_by_name returns the correct projection."""
        proj = get_projection_by_name("economics")
        assert proj is not None
        assert proj.name == "economics"
        assert proj.parent == "social_science"

    def test_get_projection_by_name_not_found(self):
        """get_projection_by_name returns None for unknown."""
        assert get_projection_by_name("nonexistent") is None

    def test_get_projection_by_natural_science(self):
        """get_projection_by_name returns natural_science."""
        proj = get_projection_by_name("natural_science")
        assert proj is not None
        assert proj.parent == ""

    def test_precedence_safety(self):
        """Safety precedence: universal_wins."""
        result = resolve_precedence("safety", "universal_rule", "local_rule")
        assert result == "universal_rule"

    def test_precedence_local_style(self):
        """Local style precedence: local_source_wins."""
        result = resolve_precedence("local_style", "universal_rule", "local_rule")
        assert result == "local_rule"

    def test_precedence_method_validity(self):
        """Method validity precedence: method_invariants_win."""
        result = resolve_precedence("method_validity", "universal_rule", "local_rule")
        assert result == "local_rule"

    def test_precedence_unknown_type(self):
        """Unknown rule type defaults to local_source_wins."""
        result = resolve_precedence("unknown_type", "universal_rule", "local_rule")
        assert result == "local_rule"

    @pytest.mark.parametrize(("rule_type", "expected"), [
        ("safety", "universal_rule"),
        ("ethics", "universal_rule"),
        ("local_style", "local_rule"),
        ("measurement_definition", "local_rule"),
        ("factual_claim", "universal_rule | local_rule"),
        ("method_validity", "local_rule"),
    ])
    def test_precedence_modes(self, rule_type, expected):
        """Each declared precedence mode resolves deterministically."""
        assert resolve_precedence(rule_type, "universal_rule", "local_rule") == expected

    def test_economics_native_vocabulary(self):
        """Economics has discipline-specific vocabulary."""
        eco = get_projection_by_name("economics")
        assert eco is not None
        vocab = eco.native_vocabulary or {}
        assert "entity_names" in vocab
        assert "market" in vocab["entity_names"]
        assert "method_names" in vocab
        assert "regression" in vocab["method_names"] or "iv" in vocab["method_names"]

    def test_history_has_evidence_hierarchy(self):
        """History has a specific evidence hierarchy (no experiments)."""
        hist = get_projection_by_name("history")
        assert hist is not None
        hierarchy = hist.evidence_hierarchy or []
        assert len(hierarchy) > 0
        assert hierarchy[0] == "authenticated_primary_evidence"

    def test_natural_science_invariants(self):
        """Natural science has units and dimensional analysis invariants."""
        ns = get_projection_by_name("natural_science")
        assert ns is not None
        inv = ns.kernel_projection.get("invariants", [])
        has_units = any("units" in i.lower() for i in inv)
        has_dimensional = any("dimensional" in i.lower() for i in inv)
        assert has_units, "Natural science must have units invariant"
        assert has_dimensional, "Natural science must have dimensional consistency invariant"

