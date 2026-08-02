"""Targeted tests for prompts_kernel (delta)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from prompts_kernel import (  # noqa: E402
    DELTA_SHIFT,
    DELTA_STABLE,
    DeltaClass,
    adaptive_delta_threshold,
    classify_delta,
    delta_l1,
)

class TestDeltaL1:
    """§III Manhattan (L1) distance on keyword-weight vectors."""

    def test_delta_l1_range(self):
        d = delta_l1({"a": 0.6, "b": 0.4}, {"a": 0.3, "c": 0.7})
        assert 0.0 < d <= 2.0

    def test_delta_l1_identical(self):
        d = delta_l1({"a": 1.0}, {"a": 1.0})
        assert d == 0.0

    def test_delta_l1_disjoint_keys(self):
        d = delta_l1({"a": 1.0}, {"b": 1.0})
        assert d == 2.0

    def test_delta_l1_partial_overlap(self):
        d = delta_l1({"a": 0.7, "b": 0.3}, {"a": 0.5, "c": 0.5})
        # |0.7-0.5| + |0.3-0.0| + |0.0-0.5| = 0.2 + 0.3 + 0.5 = 1.0
        assert abs(d - 1.0) < 0.001


class TestDeltaConstants:
    """Thresholds: 0.3 stable, 0.5 shift."""

    def test_delta_constants(self):
        assert DELTA_STABLE == 0.3
        assert DELTA_SHIFT == 0.5


class TestClassifyDelta:
    """Classification boundaries with unified Manhattan thresholds."""

    def test_classify_stable(self):
        assert classify_delta(0.1) == DeltaClass.STABLE

    def test_classify_shift(self):
        assert classify_delta(0.45) == DeltaClass.SHIFT

    def test_classify_divergence(self):
        assert classify_delta(0.8) == DeltaClass.DIVERGENCE

    def test_classify_boundaries(self):
        assert classify_delta(DELTA_STABLE - 0.001) == DeltaClass.STABLE
        assert classify_delta(DELTA_STABLE + 0.001) == DeltaClass.SHIFT
        assert classify_delta(DELTA_SHIFT - 0.001) == DeltaClass.SHIFT
        assert classify_delta(DELTA_SHIFT + 0.001) == DeltaClass.DIVERGENCE


class TestAdaptiveDeltaThreshold:
    """Median-based signal classification threshold."""

    def test_empty_fallback(self):
        assert adaptive_delta_threshold([], fallback=0.3) == 0.3

    def test_small_n_fallback(self):
        """N < min_n (5) → fixed fallback."""
        assert adaptive_delta_threshold([0.1, 0.2, 0.4], fallback=0.3, min_n=5) == 0.3

    def test_tight_cluster(self):
        """Tight deltas → low threshold."""
        deltas = [0.08, 0.10, 0.09, 0.11, 0.12, 0.10, 0.09]
        thresh = adaptive_delta_threshold(deltas, margin=0.1, min_n=5)
        # median ≈ 0.10, threshold ≈ 0.10 + 0.1 = 0.20
        assert abs(thresh - 0.20) < 0.02

    def test_loose_cluster(self):
        """Spread deltas → higher threshold."""
        deltas = [0.25, 0.30, 0.35, 0.28, 0.32, 0.27, 0.33]
        thresh = adaptive_delta_threshold(deltas, margin=0.1, min_n=5)
        # median = 0.30, threshold ≈ 0.40
        assert abs(thresh - 0.40) < 0.03

    def test_spike_exclusion(self):
        """Spike > 2× median excluded from threshold calc."""
        deltas = [0.08, 0.10, 0.12, 0.09, 0.85, 0.11, 0.10]
        thresh = adaptive_delta_threshold(deltas, margin=0.1, min_n=5)
        # median_all = 0.10, spike 0.85 > 2×0.10 → excluded
        # typical = [0.08,0.10,0.12,0.09,0.11,0.10], median_typ = 0.10
        # threshold = 0.10 + 0.1 = 0.20
        assert abs(thresh - 0.20) < 0.02

    def test_clamped(self):
        """Always clamped to [0.1, 0.9]."""
        assert 0.1 <= adaptive_delta_threshold([0.001]*10, margin=0.01, min_n=5) <= 0.9
        assert 0.1 <= adaptive_delta_threshold([0.99]*10, margin=0.5, min_n=5) <= 0.9

    def test_near_zero_median_fallback(self):
        """Near-zero median → fallback."""
        thresh = adaptive_delta_threshold([0.0001]*10, fallback=0.3, min_n=5)
        assert thresh == 0.3
