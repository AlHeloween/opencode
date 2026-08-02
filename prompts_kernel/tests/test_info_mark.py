"""Tests for prompts_kernel — Epistemic DAG model."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    ClaimNode,
    EpistemicDAG,
    EpistemicStatus,
    classify_claim_status,
    confusion_matrix_validation,
    demote_claim,
    effective_status,
    promote_claim,
    reverse_search,
    salience_from_mention_ratio,
    status_after_oracle_pass,
    verify_claim,
)


class TestEpistemicStatus:
    """EpistemicStatus enum — single level, no floats."""

    def test_values(self):
        assert str(EpistemicStatus("Unknown")) == "Unknown"
        assert str(EpistemicStatus("Guess")) == "Guess"
        assert str(EpistemicStatus("Hypothetical")) == "Hypothetical"
        assert str(EpistemicStatus("Inferred")) == "Inferred"
        assert str(EpistemicStatus("Exact")) == "Exact"

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            EpistemicStatus("Invalid")

    def test_ordering(self):
        assert EpistemicStatus("Unknown") < EpistemicStatus("Guess")
        assert EpistemicStatus("Guess") < EpistemicStatus("Hypothetical")
        assert EpistemicStatus("Hypothetical") < EpistemicStatus("Inferred")
        assert EpistemicStatus("Inferred") < EpistemicStatus("Exact")

    def test_eq_string(self):
        assert EpistemicStatus("Exact") == "Exact"
        assert EpistemicStatus("Exact") == EpistemicStatus("Exact")
        assert EpistemicStatus("Exact") != "Guess"


class TestSalience:
    """Salience is attention only — never epistemic status."""

    def test_salience_clamped(self):
        assert salience_from_mention_ratio(0.5) == 0.5
        assert salience_from_mention_ratio(-1.0) == 0.0
        assert salience_from_mention_ratio(2.0) == 1.0


class TestConfusionMatrix:
    """Statistical evidence gate — Hypothetical → Inferred."""

    def test_promotion_meets_threshold(self):
        r = confusion_matrix_validation(tp=90, fp=5, tn=80, fn=10)
        assert r["promoted"] is True
        assert r["new_level"] == "Inferred"
        assert r["precision"] >= 0.85
        assert r["f1"] >= 0.8

    def test_no_promotion_below_f1(self):
        r = confusion_matrix_validation(tp=10, fp=20, tn=5, fn=65)
        assert r["promoted"] is False
        assert r["new_level"] == "Hypothetical"

    def test_no_promotion_below_precision(self):
        r = confusion_matrix_validation(tp=30, fp=30, tn=10, fn=10)
        assert r["promoted"] is False
        assert r["precision"] < 0.85

    def test_zero_division_handling(self):
        r = confusion_matrix_validation(tp=0, fp=0, tn=0, fn=0)
        assert r["precision"] == 0.0
        assert r["recall"] == 0.0
        assert r["f1"] == 0.0
        assert r["promoted"] is False


class TestClassifyClaimStatus:
    """Standalone claim classifier — evidence + freshness, no salience."""

    def test_contradiction_unknown(self):
        assert (
            classify_claim_status(has_unresolved_contradiction=True, has_direct_evidence=True)
            == EpistemicStatus("Unknown")
        )

    def test_stale_unknown(self):
        assert classify_claim_status(has_direct_evidence=True, freshness=0.0) == EpistemicStatus("Unknown")

    def test_direct_evidence_exact(self):
        assert classify_claim_status(has_direct_evidence=True, freshness=1.0) == EpistemicStatus("Exact")

    def test_derivation_inferred(self):
        assert (
            classify_claim_status(all_premises_exact=True, derivation_nonempty=True, freshness=1.0)
            == EpistemicStatus("Inferred")
        )

    def test_falsifier_hypothetical(self):
        assert classify_claim_status(falsifier_specified=True) == EpistemicStatus("Hypothetical")

    def test_parametric_only_guess(self):
        assert classify_claim_status(parametric_confidence=0.99) == EpistemicStatus("Guess")
        assert classify_claim_status(parametric_confidence=0.99) != EpistemicStatus("Exact")

    def test_empty_unknown(self):
        assert classify_claim_status() == EpistemicStatus("Unknown")


class TestOraclePass:
    """Oracle PASS → Exact for verified claim only."""

    def test_oracle_pass_exact(self):
        assert status_after_oracle_pass() == EpistemicStatus("Exact")

    def test_oracle_pass_out_of_scope_unknown(self):
        assert status_after_oracle_pass(claim_scope_ok=False) == EpistemicStatus("Unknown")

    def test_oracle_pass_stale_unknown(self):
        assert status_after_oracle_pass(freshness=0.0) == EpistemicStatus("Unknown")


class TestReverseSearch:
    """Reverse search — only Exact + Inferred claims participate."""

    def test_filters_hypothetical_and_below(self):
        claims = [
            {"level": "Exact", "text": "memory leak fixed in v3", "source": "test output"},
            {"level": "Inferred", "text": "similar leak in v2", "source": "code analysis"},
            {"level": "Hypothetical", "text": "maybe another leak in v1", "source": "speculation"},
            {"level": "Guess", "text": "v0 might be related", "source": "wild guess"},
        ]
        results = reverse_search(claims, "leak")
        assert len(results) == 2
        assert all(r["level"] in ("Exact", "Inferred") for r in results)

    def test_empty_claims(self):
        assert reverse_search([], "test") == []

    def test_case_insensitive(self):
        claims = [{"level": "Exact", "text": "MEMORY LEAK", "source": "test"}]
        results = reverse_search(claims, "memory")
        assert len(results) == 1

    def test_no_match(self):
        claims = [{"level": "Exact", "text": "performance improvement", "source": "test"}]
        results = reverse_search(claims, "leak")
        assert len(results) == 0


# =============================================================================
# DAG model tests — ClaimNode, EpistemicDAG, weakest-link, promotion/demotion
# =============================================================================

class TestClaimNode:
    """ClaimNode — a single epistemic node with status + DAG edges."""

    def test_default_unknown(self):
        node = ClaimNode(text="test claim")
        assert str(node.status) == "Unknown"
        assert node.dependencies == []

    def test_explicit_status(self):
        node = ClaimNode(status=EpistemicStatus("Exact"), text="verified claim")
        assert str(node.status) == "Exact"

    def test_auto_id(self):
        node = ClaimNode(text="auto")
        assert len(node.id) == 12

    def test_fields(self):
        node = ClaimNode(
            id="C1",
            text="claim text",
            status=EpistemicStatus("Inferred"),
            scope="file X",
            dependencies=["A", "B"],
            evidence="code inspection",
            falsifier="test failure",
            source="inference",
            label="derived claim",
        )
        assert node.id == "C1"
        assert node.scope == "file X"
        assert node.dependencies == ["A", "B"]
        assert node.evidence == "code inspection"
        assert node.falsifier == "test failure"


class TestEpistemicDAG:
    """DAG operations: add, dependencies, dependents, roots, derived."""

    def test_add_and_retrieve(self):
        dag = EpistemicDAG()
        node = ClaimNode(id="A", text="claim A", status=EpistemicStatus("Exact"))
        dag.add(node)
        assert "A" in dag.nodes

    def test_dependencies_of(self):
        dag = EpistemicDAG()
        a = ClaimNode(id="A", status=EpistemicStatus("Exact"))
        b = ClaimNode(id="B", status=EpistemicStatus("Inferred"), dependencies=["A"])
        dag.add(a); dag.add(b)
        deps = dag.dependencies_of("B")
        assert len(deps) == 1
        assert deps[0].id == "A"

    def test_dependents_of(self):
        dag = EpistemicDAG()
        a = ClaimNode(id="A")
        b = ClaimNode(id="B", dependencies=["A"])
        c = ClaimNode(id="C", dependencies=["A"])
        dag.add(a); dag.add(b); dag.add(c)
        assert len(dag.dependents_of("A")) == 2

    def test_roots_and_derived(self):
        dag = EpistemicDAG()
        dag.add(ClaimNode(id="A"))
        dag.add(ClaimNode(id="B", dependencies=["A"]))
        assert len(dag.roots()) == 1
        assert len(dag.derived()) == 1


class TestWeakestLinkCeiling:
    """CORE RULE: effective_status ≤ weakest dependency."""

    def test_standalone_unchanged(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=EpistemicStatus("Exact"))
        dag.add(node)
        assert str(effective_status(node, dag)) == "Exact"

    def test_exact_from_guess_is_guess(self):
        dag = EpistemicDAG()
        dag.add(ClaimNode(id="base", status=EpistemicStatus("Guess")))
        dag.add(ClaimNode(id="derived", status=EpistemicStatus("Exact"), dependencies=["base"]))
        assert str(effective_status(dag.nodes["derived"], dag)) == "Guess"

    def test_inferred_from_exact_is_inferred(self):
        dag = EpistemicDAG()
        dag.add(ClaimNode(id="base", status=EpistemicStatus("Exact")))
        dag.add(ClaimNode(id="derived", status=EpistemicStatus("Inferred"), dependencies=["base"]))
        assert str(effective_status(dag.nodes["derived"], dag)) == "Inferred"

    def test_chain_exact_inferred_guess(self):
        dag = EpistemicDAG()
        dag.add(ClaimNode(id="A", status=EpistemicStatus("Exact")))
        dag.add(ClaimNode(id="B", status=EpistemicStatus("Inferred"), dependencies=["A"]))
        dag.add(ClaimNode(id="C", status=EpistemicStatus("Guess"), dependencies=["B"]))
        assert str(effective_status(dag.nodes["C"], dag)) == "Guess"

    def test_missing_dependency_is_unknown(self):
        dag = EpistemicDAG()
        dag.add(ClaimNode(id="derived", status=EpistemicStatus("Exact"), dependencies=["missing"]))
        assert str(effective_status(dag.nodes["derived"], dag)) == "Unknown"

    def test_cycle_detected(self):
        dag = EpistemicDAG()
        dag.add(ClaimNode(id="A", status=EpistemicStatus("Exact"), dependencies=["B"]))
        dag.add(ClaimNode(id="B", status=EpistemicStatus("Exact"), dependencies=["A"]))
        assert str(effective_status(dag.nodes["A"], dag)) == "Unknown"


class TestPromotionGates:
    """Gated promotion through valid transitions only."""

    def test_unknown_to_guess_valid(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=EpistemicStatus("Unknown"))
        dag.add(node)
        promote_claim(node, dag, EpistemicStatus("Guess"), "web search hit")
        assert str(node.status) == "Guess"

    def test_unknown_to_exact_invalid(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=EpistemicStatus("Unknown"))
        dag.add(node)
        promote_claim(node, dag, EpistemicStatus("Exact"), "trust me")
        assert str(node.status) == "Unknown"

    def test_guess_to_hypothetical_valid(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=EpistemicStatus("Guess"))
        dag.add(node)
        promote_claim(node, dag, EpistemicStatus("Hypothetical"), "code search verified")
        assert str(node.status) == "Hypothetical"

    def test_inferred_to_exact_via_oracle_pass(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=EpistemicStatus("Inferred"))
        dag.add(node)
        verify_claim(node, dag, oracle_pass=True, scope="file X")
        assert str(node.status) == "Exact"
        assert node.scope == "file X"

    def test_exact_demoted_on_oracle_fail(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=EpistemicStatus("Exact"))
        dag.add(node)
        verify_claim(node, dag, oracle_pass=False)
        assert str(node.status) == "Guess"


class TestDemotionCascade:
    """Demotion cascades to dependents via weakest-link."""

    def test_demote_base_cascades(self):
        dag = EpistemicDAG()
        base = ClaimNode(id="base", status=EpistemicStatus("Exact"))
        derived = ClaimNode(id="derived", status=EpistemicStatus("Exact"), dependencies=["base"])
        dag.add(base); dag.add(derived)
        demote_claim(base, dag, reason="test failure")
        assert str(base.status) == "Guess"
        assert str(effective_status(derived, dag)) == "Guess"


class TestExactGuessCycle:
    """The Exact→Guess→...→Exact cycle."""

    def test_full_cycle(self):
        dag = EpistemicDAG()
        claim = ClaimNode(id="C", status=EpistemicStatus("Unknown"))
        dag.add(claim)

        promote_claim(claim, dag, EpistemicStatus("Guess"), "web search hit")
        assert str(claim.status) == "Guess"

        promote_claim(claim, dag, EpistemicStatus("Hypothetical"), "sourcegraph match")
        assert str(claim.status) == "Hypothetical"

        promote_claim(claim, dag, EpistemicStatus("Inferred"), "derivation complete")
        assert str(claim.status) == "Inferred"

        verify_claim(claim, dag, oracle_pass=True, scope="test scope")
        assert str(claim.status) == "Exact"

        verify_claim(claim, dag, oracle_pass=False)
        assert str(claim.status) == "Guess"

        promote_claim(claim, dag, EpistemicStatus("Hypothetical"), "re-verified")
        assert str(claim.status) == "Hypothetical"

        promote_claim(claim, dag, EpistemicStatus("Inferred"), "re-derived")
        assert str(claim.status) == "Inferred"

        verify_claim(claim, dag, oracle_pass=True, scope="test scope")
        assert str(claim.status) == "Exact"
