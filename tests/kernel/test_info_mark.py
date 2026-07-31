"""Targeted tests for opencode_prompts_kernel (info mark)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    InfoMarkLevel,
    InformationMark,
    classify_claim_status,
    confusion_matrix_validation,
    promote_information_mark,
    reverse_search,
    salience_from_mention_ratio,
    status_after_oracle_pass,
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
