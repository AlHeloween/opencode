"""Targeted tests for opencode_prompts_kernel (info mark)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    InfoMarkLevel,
    InformationMark,
    confusion_matrix_validation,
    promote_information_mark,
    reverse_search,
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
        im = InformationMark(exact=1.0, inferred=0.0, hypothetical=0.0, guess=0.0, unknown=0.0,
                             label="Exact + Verified by oracle")
        assert im.label == "Exact + Verified by oracle"


class TestConfusionMatrix:
    """§I.2 Promotion mechanics — Hypothetical -> Inferred gates."""

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


class TestPromoteInformationMark:
    """§I.2 Promotion by mention frequency."""

    def test_exact_ratio(self):
        assert promote_information_mark(0.5) == InfoMarkLevel.EXACT

    def test_inferred_ratio(self):
        assert promote_information_mark(0.35) == InfoMarkLevel.INFERRED

    def test_hypothetical_ratio(self):
        assert promote_information_mark(0.25) == InfoMarkLevel.HYPOTHETICAL

    def test_guess_ratio(self):
        assert promote_information_mark(0.15) == InfoMarkLevel.GUESS

    def test_unknown_ratio(self):
        assert promote_information_mark(0.05) == InfoMarkLevel.UNKNOWN

    def test_boundary_values(self):
        assert promote_information_mark(0.4) == InfoMarkLevel.EXACT
        assert promote_information_mark(0.3) == InfoMarkLevel.INFERRED
        assert promote_information_mark(0.2) == InfoMarkLevel.HYPOTHETICAL
        assert promote_information_mark(0.1) == InfoMarkLevel.GUESS


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

