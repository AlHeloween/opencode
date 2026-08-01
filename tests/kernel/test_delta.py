"""Targeted tests for opencode_prompts_kernel (delta)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    DELTA_SHIFT,
    DELTA_STABLE,
    DeltaClass,
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
