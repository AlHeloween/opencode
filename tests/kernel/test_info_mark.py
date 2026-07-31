"""Targeted tests for opencode_prompts_kernel (info mark)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    ClaimNode,
    ClaimStatus,
    EpistemicDAG,
    InfoMarkLevel,
    InformationMark,
    classify_claim_status,
    confusion_matrix_validation,
    demote_claim,
    effective_status,
    promote_claim,
    promote_information_mark,
    reverse_search,
    salience_from_mention_ratio,
    status_after_oracle_pass,
    verify_claim,
)


class TestInformationMark:
    """§I.2 Information Mark system — epistemic status, promotion, reverse search."""

    def test_normalization(self):
        im = InformationMark(exact=1.0, inferred=1.0, hypothetical=0.0, guess=0.0, unknown=0.0)
        assert abs(im.exact - 0.5) < 0.01
        assert abs(im.inferred - 0.5) < 0.01
        assert im.dominant_level == InfoMarkLevel.EXACT

    def test_zero_does_not_divide(self):
        im = InformationMark()
        assert im.exact == 0.0
        assert im.dominant_level == InfoMarkLevel.UNKNOWN

    def test_dominant_level_inferred(self):
        im = InformationMark(exact=0.1, inferred=0.8, hypothetical=0.1, guess=0.0, unknown=0.0)
        assert im.dominant_level == InfoMarkLevel.INFERRED

    def test_accuracy_exact(self):
        im = InformationMark(exact=1.0, inferred=0.0, hypothetical=0.0, guess=0.0, unknown=0.0)
        assert im.accuracy == 1.0

    def test_accuracy_mixed(self):
        im = InformationMark(exact=0.0, inferred=1.0, hypothetical=0.0, guess=0.0, unknown=0.0)
        assert abs(im.accuracy - 0.75) < 0.01

    def test_with_label(self):
        im = InformationMark(
            exact=1.0,
            inferred=0.0,
            hypothetical=0.0,
            guess=0.0,
            unknown=0.0,
            label="Exact + Verified by oracle",
        )
        assert im.label == "Exact + Verified by oracle"


class TestConfusionMatrix:
    """§I.2 Promotion mechanics — Hypothetical -> Inferred gates (real TP/FP only)."""

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


class TestSalienceNotPromotion:
    """Mention frequency is salience only — never Exact/Inferred."""

    def test_salience_clamped(self):
        assert salience_from_mention_ratio(0.5) == 0.5
        assert salience_from_mention_ratio(-1.0) == 0.0
        assert salience_from_mention_ratio(2.0) == 1.0

    def test_promote_legacy_never_exact_or_inferred(self):
        # High recurrence used to mint Exact — forbidden under ADID
        assert promote_information_mark(0.99) == InfoMarkLevel.GUESS
        assert promote_information_mark(0.5) == InfoMarkLevel.GUESS
        assert promote_information_mark(0.35) == InfoMarkLevel.GUESS
        assert promote_information_mark(0.01) == InfoMarkLevel.GUESS
        assert promote_information_mark(0.0) == InfoMarkLevel.UNKNOWN
        assert promote_information_mark(0.4) != InfoMarkLevel.EXACT
        assert promote_information_mark(0.4) != InfoMarkLevel.INFERRED


class TestClassifyClaimStatus:
    """Canonical classifier — evidence + freshness, no salience."""

    def test_contradiction_unknown(self):
        assert (
            classify_claim_status(has_unresolved_contradiction=True, has_direct_evidence=True)
            == InfoMarkLevel.UNKNOWN
        )

    def test_stale_unknown(self):
        assert (
            classify_claim_status(has_direct_evidence=True, freshness=0.0) == InfoMarkLevel.UNKNOWN
        )

    def test_direct_evidence_exact(self):
        assert (
            classify_claim_status(has_direct_evidence=True, freshness=1.0) == InfoMarkLevel.EXACT
        )

    def test_derivation_inferred(self):
        assert (
            classify_claim_status(
                all_premises_exact=True,
                derivation_nonempty=True,
                freshness=1.0,
            )
            == InfoMarkLevel.INFERRED
        )

    def test_falsifier_hypothetical(self):
        assert classify_claim_status(falsifier_specified=True) == InfoMarkLevel.HYPOTHETICAL

    def test_parametric_only_guess(self):
        assert classify_claim_status(parametric_confidence=0.99) == InfoMarkLevel.GUESS
        assert classify_claim_status(parametric_confidence=0.99) != InfoMarkLevel.EXACT

    def test_empty_unknown(self):
        assert classify_claim_status() == InfoMarkLevel.UNKNOWN


class TestOraclePass:
    """Oracle PASS → Exact for verified claim only."""

    def test_oracle_pass_exact(self):
        assert status_after_oracle_pass() == InfoMarkLevel.EXACT

    def test_oracle_pass_out_of_scope_unknown(self):
        assert status_after_oracle_pass(claim_scope_ok=False) == InfoMarkLevel.UNKNOWN

    def test_oracle_pass_stale_unknown(self):
        assert status_after_oracle_pass(freshness=0.0) == InfoMarkLevel.UNKNOWN


class TestReverseSearch:
    """§I.2 Reverse search filtering — only Exact + Inferred claims."""

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
    """ClaimNode replaces InformationMark floats with a single status + DAG edges."""

    def test_default_unknown(self):
        node = ClaimNode(text="test claim")
        assert str(node.status) == "Unknown"
        assert node.dependencies == []

    def test_explicit_status(self):
        node = ClaimNode(status=ClaimStatus("Exact"), text="verified claim")
        assert str(node.status) == "Exact"
        assert node.exact == 1.0
        assert node.inferred == 0.0

    def test_backward_compat_floats(self):
        """Legacy .exact/.inferred/... properties return 1.0 or 0.0."""
        node = ClaimNode(status=ClaimStatus("Inferred"))
        assert node.exact == 0.0
        assert node.inferred == 1.0
        assert node.hypothetical == 0.0
        assert node.guess == 0.0
        assert node.unknown == 0.0
        assert node.dominant_level == ClaimStatus("Inferred")
        assert node.accuracy == 3.0 / 4.0

    def test_as_legacy_dict(self):
        node = ClaimNode(status=ClaimStatus("Guess"), label="speculation")
        d = node.as_legacy_dict()
        assert d == {"exact": 0.0, "inferred": 0.0, "hypothetical": 0.0, "guess": 1.0, "unknown": 0.0, "label": "speculation"}


class TestEpistemicDAG:
    """DAG operations: add, dependencies, dependents, roots, derived."""

    def test_add_and_retrieve(self):
        dag = EpistemicDAG()
        node = ClaimNode(id="A", text="claim A", status=ClaimStatus("Exact"))
        dag.add(node)
        assert "A" in dag.nodes
        assert dag.nodes["A"].text == "claim A"

    def test_dependencies_of(self):
        dag = EpistemicDAG()
        a = ClaimNode(id="A", status=ClaimStatus("Exact"))
        b = ClaimNode(id="B", status=ClaimStatus("Inferred"), dependencies=["A"])
        dag.add(a)
        dag.add(b)
        deps = dag.dependencies_of("B")
        assert len(deps) == 1
        assert deps[0].id == "A"

    def test_dependents_of(self):
        dag = EpistemicDAG()
        a = ClaimNode(id="A")
        b = ClaimNode(id="B", dependencies=["A"])
        c = ClaimNode(id="C", dependencies=["A"])
        dag.add(a)
        dag.add(b)
        dag.add(c)
        deps = dag.dependents_of("A")
        assert len(deps) == 2

    def test_roots_and_derived(self):
        dag = EpistemicDAG()
        a = ClaimNode(id="A")           # root
        b = ClaimNode(id="B", dependencies=["A"])  # derived
        dag.add(a)
        dag.add(b)
        assert len(dag.roots()) == 1
        assert dag.roots()[0].id == "A"
        assert len(dag.derived()) == 1
        assert dag.derived()[0].id == "B"


class TestWeakestLinkCeiling:
    """CORE RULE: effective_status ≤ weakest dependency."""

    def test_standalone_unchanged(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=ClaimStatus("Exact"))
        dag.add(node)
        assert str(effective_status(node, dag)) == "Exact"

    def test_exact_from_guess_is_guess(self):
        """Exact claim derived from Guess → at most Guess."""
        dag = EpistemicDAG()
        base = ClaimNode(id="base", status=ClaimStatus("Guess"))
        derived = ClaimNode(id="derived", status=ClaimStatus("Exact"), dependencies=["base"])
        dag.add(base)
        dag.add(derived)
        assert str(effective_status(derived, dag)) == "Guess"

    def test_inferred_from_exact_is_inferred(self):
        """Inferred claim from Exact dep → Inferred (not dragged down)."""
        dag = EpistemicDAG()
        base = ClaimNode(id="base", status=ClaimStatus("Exact"))
        derived = ClaimNode(id="derived", status=ClaimStatus("Inferred"), dependencies=["base"])
        dag.add(base)
        dag.add(derived)
        assert str(effective_status(derived, dag)) == "Inferred"

    def test_chain_exact_inferred_guess(self):
        """A → B → C: Exact → Inferred → Guess. C effective = Guess."""
        dag = EpistemicDAG()
        a = ClaimNode(id="A", status=ClaimStatus("Exact"))
        b = ClaimNode(id="B", status=ClaimStatus("Inferred"), dependencies=["A"])
        c = ClaimNode(id="C", status=ClaimStatus("Guess"), dependencies=["B"])
        dag.add(a)
        dag.add(b)
        dag.add(c)
        assert str(effective_status(c, dag)) == "Guess"

    def test_missing_dependency_is_unknown(self):
        dag = EpistemicDAG()
        derived = ClaimNode(id="derived", status=ClaimStatus("Exact"), dependencies=["missing"])
        dag.add(derived)
        assert str(effective_status(derived, dag)) == "Unknown"

    def test_cycle_detected(self):
        """Circular dependency → Unknown."""
        dag = EpistemicDAG()
        a = ClaimNode(id="A", status=ClaimStatus("Exact"), dependencies=["B"])
        b = ClaimNode(id="B", status=ClaimStatus("Exact"), dependencies=["A"])
        dag.add(a)
        dag.add(b)
        assert str(effective_status(a, dag)) == "Unknown"


class TestPromotionGates:
    """Gated promotion through valid transitions only."""

    def test_unknown_to_guess_valid(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=ClaimStatus("Unknown"))
        dag.add(node)
        result = promote_claim(node, dag, ClaimStatus("Guess"), evidence="web search found match")
        assert str(result.status) == "Guess"

    def test_unknown_to_exact_invalid(self):
        """Direct Unknown → Exact without oracle is forbidden."""
        dag = EpistemicDAG()
        node = ClaimNode(status=ClaimStatus("Unknown"))
        dag.add(node)
        result = promote_claim(node, dag, ClaimStatus("Exact"), evidence="trust me")
        assert str(result.status) == "Unknown"  # unchanged

    def test_guess_to_hypothetical_valid(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=ClaimStatus("Guess"))
        dag.add(node)
        result = promote_claim(node, dag, ClaimStatus("Hypothetical"), evidence="code search verified")
        assert str(result.status) == "Hypothetical"

    def test_inferred_to_exact_via_oracle_pass(self):
        dag = EpistemicDAG()
        node = ClaimNode(status=ClaimStatus("Inferred"))
        dag.add(node)
        result = verify_claim(node, dag, oracle_pass=True, scope="file X")
        assert str(result.status) == "Exact"
        assert result.scope == "file X"

    def test_exact_demoted_on_oracle_fail(self):
        """Oracle FAIL → Exact→Guess."""
        dag = EpistemicDAG()
        node = ClaimNode(status=ClaimStatus("Exact"))
        dag.add(node)
        result = verify_claim(node, dag, oracle_pass=False)
        assert str(result.status) == "Guess"


class TestDemotionCascade:
    """Demotion cascades to dependents via weakest-link."""

    def test_demote_base_cascades(self):
        dag = EpistemicDAG()
        base = ClaimNode(id="base", status=ClaimStatus("Exact"))
        derived = ClaimNode(id="derived", status=ClaimStatus("Exact"), dependencies=["base"])
        dag.add(base)
        dag.add(derived)

        # Demote base
        demote_claim(base, dag, reason="test failure")

        assert str(base.status) == "Guess"
        # derived should be dragged down too
        assert str(effective_status(derived, dag)) == "Guess"


class TestExactGuessCycle:
    """The Exact→Guess→...→Exact cycle."""

    def test_full_cycle(self):
        dag = EpistemicDAG()
        claim = ClaimNode(id="C", status=ClaimStatus("Unknown"))
        dag.add(claim)

        # Unknown → Guess (web search)
        promote_claim(claim, dag, ClaimStatus("Guess"), "web search hit")
        assert str(claim.status) == "Guess"

        # Guess → Hypothetical (code search verified)
        promote_claim(claim, dag, ClaimStatus("Hypothetical"), "sourcegraph match")
        assert str(claim.status) == "Hypothetical"

        # Hypothetical → Inferred (dependency chain)
        promote_claim(claim, dag, ClaimStatus("Inferred"), "derivation complete")
        assert str(claim.status) == "Inferred"

        # Inferred → Exact (oracle PASS)
        verify_claim(claim, dag, oracle_pass=True, scope="test scope")
        assert str(claim.status) == "Exact"

        # Exact → Guess (oracle FAIL)
        verify_claim(claim, dag, oracle_pass=False)
        assert str(claim.status) == "Guess"

        # And back up again
        promote_claim(claim, dag, ClaimStatus("Hypothetical"), "re-verified via code search")
        assert str(claim.status) == "Hypothetical"

        promote_claim(claim, dag, ClaimStatus("Inferred"), "re-derived")
        assert str(claim.status) == "Inferred"

        verify_claim(claim, dag, oracle_pass=True, scope="test scope")
        assert str(claim.status) == "Exact"
