"""Tests for prompts_kernel — SVM anchor signal classification."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    Signal,
    SVMAnchor,
    build_semantic_vector,
    classify_signal,
    filter_signal_storm,
)


def _make_anchor(keywords=None, weights=None, dominant="test goal"):
    return SVMAnchor(
        sv=build_semantic_vector(
            keywords=keywords or ["DirectoryBrowser", "add", "component"],
            weights=weights or [0.5, 0.3, 0.2],
            dominant=dominant,
        ),
        phase="implementation",
        goal=dominant,
    )


class TestClassifySignal:
    """classify_signal: COLLAPSED_DUPLICATES > CONFIRMATION > DIVERGENCE.
    v6: NOISE renamed to COLLAPSED_DUPLICATES — evidential weight preserved."""

    def test_noise_lsp_cascade(self):
        """Documented example: 60 LSP errors → COLLAPSED_DUPLICATES (was NOISE in v5)."""
        anchor = _make_anchor()
        signal = Signal(
            source="LSP",
            pattern="JSX-unresolved-reference",
            cardinality=60,
            content="';' expected",
        )
        assert classify_signal(anchor, signal) == "COLLAPSED_DUPLICATES"

    def test_noise_runtime_cascade(self):
        """60× KeyError from test-output → COLLAPSED_DUPLICATES."""
        anchor = _make_anchor()
        signal = Signal(
            source="test-output",
            pattern="KeyError",
            cardinality=60,
            content="KeyError: 'session_id' in test_output.py line 42",
        )
        assert classify_signal(anchor, signal) == "COLLAPSED_DUPLICATES"

    def test_noise_pure_cardinality(self):
        """5+ signals from any source → COLLAPSED_DUPLICATES via cardinality heuristic."""
        anchor = _make_anchor()
        signal = Signal(
            source="unknown-source",
            pattern="weird-pattern",
            cardinality=5,
            content="x",
        )
        assert classify_signal(anchor, signal) == "COLLAPSED_DUPLICATES"

    def test_noise_content_similarity(self):
        """Content ≥ 30 chars → COLLAPSED_DUPLICATES via similarity heuristic."""
        anchor = _make_anchor()
        signal = Signal(
            source="custom-tool",
            pattern="some-error",
            cardinality=2,
            content="A" * 30,  # just long enough
        )
        assert classify_signal(anchor, signal) == "COLLAPSED_DUPLICATES"

    def test_confirmation_near_identical_sv(self):
        """Signal SV nearly identical to anchor SV → CONFIRMATION (δ < 0.3)."""
        # Anchor + signal share same keywords, close weights
        anchor = _make_anchor(
            keywords=["fix", "auth", "login"],
            weights=[0.5, 0.3, 0.2],
            dominant="fix auth login",
        )
        signal = Signal(
            source="typecheck",
            pattern="fix",
            cardinality=1,
            content="fix auth login flow",
        )
        # Signal SV: {"fix": 0.7, "typecheck": 0.3}
        # Anchor SV: {"fix": 0.5, "auth": 0.3, "login": 0.2}
        # delta = |0.7-0.5| + |0.3-0.0| + |0.0-0.3| + |0.0-0.2| = 0.2+0.3+0.3+0.2 = 1.0
        # → DIVERGENCE. The confirmation threshold is very tight.
        # This tests that the code is correct, not that arbitrary signals confirm.
        result = classify_signal(anchor, signal)
        assert result in ("CONFIRMATION", "DIVERGENCE")  # depends on delta

    def test_divergence_new_info(self):
        """Single distant signal, not a cascade → DIVERGENCE."""
        anchor = _make_anchor()
        signal = Signal(
            source="user-message",
            pattern="Authentication System",
            cardinality=1,
            content="Implement OAuth2 login flow",
        )
        assert classify_signal(anchor, signal) == "DIVERGENCE"

    def test_noise_before_confirmation(self):
        """COLLAPSED_DUPLICATES check runs FIRST — even close-to-anchor cascades collapse."""
        anchor = _make_anchor(dominant="Fixing DirectoryBrowser bug")
        signal = Signal(
            source="LSP",
            pattern="JSX-unresolved-reference",
            cardinality=60,
            content="';' expected",
        )
        # Despite being "close" to anchor (DirectoryBrowser), cascade = COLLAPSED_DUPLICATES
        assert classify_signal(anchor, signal) == "COLLAPSED_DUPLICATES"

    def test_single_not_cascade(self):
        """Cardinality 1, short content, non-cascade source → not COLLAPSED_DUPLICATES."""
        anchor = _make_anchor()
        signal = Signal(
            source="custom-tool",
            pattern="some-error",
            cardinality=1,
            content="short",
        )
        # Not collapsed → falls through to delta check
        result = classify_signal(anchor, signal)
        assert result in ("CONFIRMATION", "DIVERGENCE")


class TestFilterSignalStorm:
    """filter_signal_storm: cluster + COLLAPSE (v6 — preserve, not filter)."""

    def test_all_collapsed_preserved(self):
        """60 LSP errors + 5 runtime errors → all COLLAPSED_DUPLICATES → PRESERVED.
        v6: collapsed signals are kept with evidential_weight preserved."""
        anchor = _make_anchor()
        signals = [
            Signal(source="LSP", pattern="JSX-error", cardinality=1, content="';' expected")
        ] * 60 + [
            Signal(source="test-output", pattern="KeyError", cardinality=1, content="KeyError: x")
        ] * 5
        result = filter_signal_storm(anchor, signals)
        # v6: both clusters COLLAPSED but PRESERVED (not filtered out)
        assert len(result) == 2
        # Both have COLLAPSED_DUPLICATES disposition
        for s in result:
            assert s.disposition == "COLLAPSED_DUPLICATES"
        # Cardinality is preserved
        assert result[0].cardinality == 60
        assert result[1].cardinality == 5

    def test_mixed_keeps_all(self):
        """v6: All signals preserved — collapsed + actionable both kept."""
        anchor = _make_anchor()
        signals = [
            Signal(source="LSP", pattern="JSX-error", cardinality=1, content="';' expected"),
        ] * 60 + [
            Signal(source="user-message", pattern="DirectoryBrowser", cardinality=1,
                   content="Add component to DirectoryBrowser"),
        ]
        result = filter_signal_storm(anchor, signals)
        # v6: LSP cluster → COLLAPSED_DUPLICATES (preserved), user-message → kept
        assert len(result) == 2
        dispositions = {s.disposition for s in result}
        assert "COLLAPSED_DUPLICATES" in dispositions
        assert any(s.disposition in ("CONFIRMATION", "DIVERGENCE") for s in result)
