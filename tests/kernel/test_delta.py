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
    delta_cos,
    delta_l1,
    delta_star,
)

class TestDeltaFunctions:
    """§III Delta measurement — L1, cosine, star, classification."""

    def test_delta_l1_range(self):
        d = delta_l1({"a": 0.6, "b": 0.4}, {"a": 0.3, "c": 0.7})
        assert 0.0 < d <= 2.0

    def test_delta_l1_identical(self):
        d = delta_l1({"a": 1.0}, {"a": 1.0})
        assert d == 0.0

    def test_delta_l1_disjoint_keys(self):
        d = delta_l1({"a": 1.0}, {"b": 1.0})
        assert d == 2.0

    def test_delta_cos_identical(self):
        d = delta_cos([0.5, 0.5], [0.5, 0.5])
        assert abs(d) < 0.001

    def test_delta_cos_orthogonal(self):
        d = delta_cos([1.0, 0.0], [0.0, 1.0])
        assert abs(d - 1.0) < 0.001

    def test_delta_cos_opposite(self):
        d = delta_cos([1.0, 0.0], [-1.0, 0.0])
        assert abs(d - 2.0) < 0.001

    def test_delta_cos_dim_mismatch(self):
        with pytest.raises(ValueError, match="Dim mismatch"):
            delta_cos([1.0], [0.5, 0.5])

    def test_delta_cos_zero_vector(self):
        d = delta_cos([0.0, 0.0], [1.0, 0.0])
        assert d == 1.0

    def test_delta_star_composite(self):
        d = delta_star(0.5, 0.3, 0.2, alpha=0.4, beta=0.4, gamma=0.2)
        assert abs(d - (0.4*0.5 + 0.4*0.3 + 0.2*0.2)) < 0.01

    def test_delta_constants(self):
        assert DELTA_STABLE == 0.3
        assert DELTA_SHIFT == 0.6

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

