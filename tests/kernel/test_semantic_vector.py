"""Targeted tests for opencode_prompts_kernel (semantic vector)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

# Repo root on path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from opencode_prompts_kernel import (  # noqa: E402
    SemanticVector, build_semantic_vector,
)

class TestSemanticVector:
    """§III Semantic Vector — keyword weights, canonical string, hashing."""

    def test_normalization(self):
        sv = build_semantic_vector(keywords=["a","b"], weights=[1.0, 3.0])
        assert abs(sum(sv.weights) - 1.0) < 0.01

    def test_canonical_string_sorted_keys(self):
        sv = build_semantic_vector(
            keywords=["z","a","m"], weights=[1.0, 2.0, 3.0],
            dominant="test",
        )
        canonical = sv.canonical_string()
        parts = canonical.split("|")
        assert parts[0] == "dominant=test"
        # Keys sorted: a, m, z
        assert "a:" in parts[1]
        assert "m:" in parts[2]
        assert "z:" in parts[3]

    def test_sv_roundtrip(self):
        sv = build_semantic_vector(keywords=["key"], weights=[1.0], dominant="dom")
        assert sv.semantic_dominant == "dom"
        assert sv.keywords[0] == "key"
        assert abs(sv.weights[0] - 1.0) < 0.01

    def test_sv_deterministic(self):
        sv1 = build_semantic_vector(keywords=["a"], weights=[1.0], dominant="x")
        sv2 = build_semantic_vector(keywords=["a"], weights=[1.0], dominant="x")
        assert sv1.canonical_string() == sv2.canonical_string()

